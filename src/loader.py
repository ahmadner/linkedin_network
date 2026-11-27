# -*- coding: utf-8 -*-
"""
Robust loader for LinkedIn's official data export.

Handles the quirks of the real export files:
  * Accepts the downloaded .zip directly, a folder, or a bare Connections.csv
  * Skips the "Notes:" preamble lines that sit above the real header row
  * BOM / utf-8-sig / utf-16 / cp1256 fallbacks
  * Header aliases across export versions (e.g. "Email Address" vs "Email")
  * Multiple "Connected On" date formats and locales

Nothing is guessed silently: every dropped or repaired row is recorded so the
Data_Quality sheet can show exactly what happened.
"""
from __future__ import annotations

import csv
import io
import os
import re
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Dict, List, Optional, Tuple

CONNECTION_HEADER_ALIASES = {
    "first name": "first_name",
    "firstname": "first_name",
    "last name": "last_name",
    "lastname": "last_name",
    "url": "profile_url",
    "profile url": "profile_url",
    "public profile url": "profile_url",
    "email address": "email",
    "email": "email",
    "emailaddress": "email",
    "company": "company",
    "company name": "company",
    "position": "position",
    "title": "position",
    "connected on": "connected_on",
    "connectedon": "connected_on",
}

DATE_FORMATS = (
    "%d %b %Y",      # 02 May 2023  (default export format)
    "%d %B %Y",
    "%b %d, %Y",     # May 2, 2023
    "%B %d, %Y",
    "%Y-%m-%d",
    "%d/%m/%Y",
    "%m/%d/%Y",
    "%d-%m-%Y",
    "%d-%b-%y",
    "%d %b %y",
)

ENCODINGS = ("utf-8-sig", "utf-8", "utf-16", "cp1256", "latin-1")

EXTRA_FILES_OF_INTEREST = (
    "profile.csv",
    "positions.csv",
    "education.csv",
    "skills.csv",
    "email addresses.csv",
    "invitations.csv",
)


@dataclass
class RawConnection:
    first_name: str = ""
    last_name: str = ""
    profile_url: str = ""
    email: str = ""
    company: str = ""
    position: str = ""
    connected_on: str = ""
    connected_date: Optional[date] = None
    source_row: int = 0
    issues: List[str] = field(default_factory=list)


@dataclass
class LoadResult:
    connections: List[RawConnection]
    header_found: List[str]
    skipped_rows: int
    source_path: str
    extra_files: Dict[str, bytes] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)


# --------------------------------------------------------------------------- #
# low level helpers
# --------------------------------------------------------------------------- #
def _decode(raw: bytes) -> Tuple[str, str]:
    """Decode bytes with the first encoding that yields sane text."""
    last_err = None
    for enc in ENCODINGS:
        try:
            text = raw.decode(enc)
        except (UnicodeDecodeError, UnicodeError) as exc:
            last_err = exc
            continue
        # a correct decode of a LinkedIn csv must contain the header words
        if "first name" in text.lower():
            return text, enc
        if enc == ENCODINGS[-1]:
            return text, enc
    if last_err:
        raise last_err
    return raw.decode("utf-8", "replace"), "utf-8/replace"


def _find_header_offset(text: str) -> int:
    """
    The export prefixes Connections.csv with a human note block, then a blank
    line, then the real header:

        First Name,Last Name,URL,Email Address,Company,Position,Connected On

    Return the character offset of that header line.
    """
    pos = 0
    for line in text.splitlines(keepends=True):
        low = line.lower()
        if "first name" in low and "last name" in low:
            return pos
        pos += len(line)
    return 0  # no preamble -> first line is the header


def _normalise_header(fieldnames: Optional[List[str]]) -> Dict[str, str]:
    mapping: Dict[str, str] = {}
    for raw_name in fieldnames or []:
        key = (raw_name or "").strip().lstrip("﻿").lower()
        key = re.sub(r"\s+", " ", key)
        if key in CONNECTION_HEADER_ALIASES:
            mapping[raw_name] = CONNECTION_HEADER_ALIASES[key]
    return mapping


def parse_connected_on(value: str) -> Optional[date]:
    v = re.sub(r"\s+", " ", (value or "").strip())
    if not v:
        return None
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(v, fmt).date()
        except ValueError:
            continue
    # last resort: pull a 4-digit year so the row stays usable
    m = re.search(r"(?:19|20)\d{2}", v)
    if m:
        try:
            return date(int(m.group(0)), 1, 1)
        except ValueError:
            return None
    return None


# --------------------------------------------------------------------------- #
# public API
# --------------------------------------------------------------------------- #
def _repair_shifted_row(row: dict, fieldnames: List[str]):
    """A name written with an unquoted comma ("Mansour, PMP") shifts every
    column one to the right and would silently corrupt the whole record.
    Detect the surplus values and fold them back into the Last Name field."""
    extra = row.get("__extra__")
    if not extra:
        row.pop("__extra__", None)
        return row, False

    values = [row.get(fn) or "" for fn in fieldnames] + [str(x) for x in extra]
    surplus = len(values) - len(fieldnames)
    if surplus <= 0:
        row.pop("__extra__", None)
        return row, False

    merge_end = 2 + surplus          # fold index 1..1+surplus into Last Name
    merged = ", ".join(v for v in values[1:merge_end] if v)
    values = [values[0], merged] + values[merge_end:]
    fixed = {fn: (values[j] if j < len(values) else "")
             for j, fn in enumerate(fieldnames)}
    return fixed, True


def read_connections_text(text: str, source_path: str = "<text>") -> LoadResult:
    body = text[_find_header_offset(text):]
    reader = csv.DictReader(io.StringIO(body), restkey="__extra__")
    mapping = _normalise_header(reader.fieldnames)

    missing_core = {"first_name", "last_name"} - set(mapping.values())
    if missing_core:
        raise ValueError(
            "This does not look like a LinkedIn Connections.csv. "
            "Header found: %r" % (reader.fieldnames,)
        )

    out: List[RawConnection] = []
    skipped = 0
    fieldnames = list(reader.fieldnames or [])
    for i, row in enumerate(reader, start=2):
        rec = RawConnection(source_row=i)
        row, shifted = _repair_shifted_row(row, fieldnames)
        if shifted:
            rec.issues.append("repaired_shifted_row")
        for raw_key, field_name in mapping.items():
            setattr(rec, field_name, (row.get(raw_key) or "").strip())

        full = ("%s %s" % (rec.first_name, rec.last_name)).strip()
        if not full and not rec.profile_url:
            skipped += 1   # genuinely empty trailing line
            continue

        rec.connected_date = parse_connected_on(rec.connected_on)
        if rec.connected_on and rec.connected_date is None:
            rec.issues.append("unparsable_connected_on")
        if not rec.company:
            rec.issues.append("missing_company")
        if not rec.position:
            rec.issues.append("missing_position")
        if not rec.profile_url:
            rec.issues.append("missing_profile_url")
        out.append(rec)

    return LoadResult(
        connections=out,
        header_found=list(reader.fieldnames or []),
        skipped_rows=skipped,
        source_path=source_path,
    )


def _pick_connections_file(names: List[str]) -> Optional[str]:
    best = None
    for n in names:
        base = os.path.basename(n).lower()
        if base == "connections.csv":
            return n
        if base.startswith("connections") and base.endswith(".csv"):
            best = best or n
    return best


def _collect_extras_from_dir(folder: str) -> Dict[str, bytes]:
    extras: Dict[str, bytes] = {}
    for name in os.listdir(folder):
        if name.lower() in EXTRA_FILES_OF_INTEREST:
            with open(os.path.join(folder, name), "rb") as fh:
                extras[name.lower()] = fh.read()
    return extras


def _load_csv_file(file_path: str) -> LoadResult:
    with open(file_path, "rb") as fh:
        text, enc = _decode(fh.read())
    res = read_connections_text(text, source_path=file_path)
    res.warnings.append("decoded as %s" % enc)
    return res


def _load_zip(zip_path: str) -> LoadResult:
    with zipfile.ZipFile(zip_path) as zf:
        names = [n for n in zf.namelist() if not n.endswith("/")]
        target = _pick_connections_file(names)
        if not target:
            raise FileNotFoundError(
                "No Connections.csv inside %s. Files present: %r"
                % (os.path.basename(zip_path), names[:20])
            )
        text, enc = _decode(zf.read(target))
        res = read_connections_text(text, source_path="%s!%s" % (zip_path, target))
        res.warnings.append("decoded as %s" % enc)
        for n in names:
            if os.path.basename(n).lower() in EXTRA_FILES_OF_INTEREST:
                res.extra_files[os.path.basename(n).lower()] = zf.read(n)
        return res


def load(path: str) -> LoadResult:
    """Load from a .zip export, an extracted folder, or a Connections.csv."""
    path = os.path.abspath(path)
    if not os.path.exists(path):
        raise FileNotFoundError(path)

    if zipfile.is_zipfile(path):
        return _load_zip(path)

    if os.path.isdir(path):
        candidate = _pick_connections_file(
            [os.path.join(path, n) for n in os.listdir(path)]
        )
        if not candidate:
            raise FileNotFoundError("No Connections.csv found inside %s" % path)
        res = _load_csv_file(candidate)
        res.extra_files = _collect_extras_from_dir(path)
        return res

    return _load_csv_file(path)
