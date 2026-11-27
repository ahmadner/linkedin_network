# -*- coding: utf-8 -*-
"""
Cleaning and normalisation of the raw export fields.

Real LinkedIn data is messy: emoji in names, "Open to work" banners glued to
titles, credential soup ("Ahmad Nueirat, MSc, PMP, AWS SAA"), the same company
written five different ways. This module makes the data comparable without
losing the original value - every cleaned field keeps its raw twin.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Optional, Tuple

# --------------------------------------------------------------------------- #
# character classes
# --------------------------------------------------------------------------- #
_EMOJI_RE = re.compile(
    "["
    "\U0001F000-\U0001FAFF"
    "\U00002600-\U000027BF"
    "\U0001F1E6-\U0001F1FF"
    "\U00002190-\U000021FF"
    "\U00002B00-\U00002BFF"
    "\U0000FE00-\U0000FE0F"
    "\U0001F900-\U0001F9FF"
    "\U000024C2-\U0001F251"
    "]+",
    flags=re.UNICODE,
)

_ZERO_WIDTH_RE = re.compile(r"[​-‏‪-‮⁦-⁩﻿]")

# credentials / suffixes that are not part of a person's name
_CREDENTIALS = {
    "phd", "ph.d", "ph.d.", "dr", "dr.", "mba", "msc", "m.sc", "bsc", "b.sc",
    "ma", "ba", "md", "pmp", "cpa", "cfa", "cissp", "ccna", "ccnp", "cka",
    "cisa", "cism", "pmi-acp", "csm", "psm", "psm1", "safe", "itil", "six",
    "sigma", "aws", "azure", "gcp", "scrum", "master", "oca", "ocp", "mcse",
    "mct", "mvp", "ceh", "comptia", "sa", "saa", "eit", "pe", "llm", "jd",
}

_PRONOUN_RE = re.compile(
    r"\s*[\(\[]\s*(he|him|his|she|her|hers|they|them|theirs)"
    r"(\s*/\s*\w+){0,2}\s*[\)\]]",
    re.IGNORECASE,
)

_BANNER_RE = re.compile(
    r"(?:#?\s*)(open[\s_-]?to[\s_-]?work|opentowork|hiring|we'?re hiring|"
    r"actively looking|open for opportunities|open to opportunities|"
    r"looking for (?:a )?(?:new )?(?:job|opportunit\w*)|availablefor\w*)",
    re.IGNORECASE,
)

# legal forms stripped from company names for matching purposes
_COMPANY_SUFFIXES = (
    "incorporated", "corporation", "limited", "holdings", "holding",
    "inc", "corp", "co", "llc", "l.l.c", "ltd", "plc", "gmbh", "ag", "sa",
    "s.a", "sas", "sarl", "s.a.r.l", "bv", "b.v", "nv", "n.v", "oy", "ab",
    "as", "aps", "pty", "pvt", "private", "llp", "lp", "pllc", "wll",
    "w.l.l", "fzc", "fze", "fz-llc", "fz llc", "jsc", "ojsc", "pjsc",
    "psc", "spa", "s.p.a", "srl", "s.r.l", "kk", "k.k", "ou", "doo",
    "sp z o o", "sp. z o.o", "ug", "kg", "e.v", "trust", "group",
)

_NOT_A_COMPANY = {
    "", "-", "--", "n/a", "na", "none", "nil", "self", "self employed",
    "self-employed", "selfemployed", "freelance", "freelancer",
    "independent", "independent contractor", "unemployed", "student",
    "looking for a job", "open to work", "retired", "home", "various",
    "confidential", "private", "stealth", "stealth startup", "tbd",
    "no company", "not applicable", ".", "..", "...",
}

_FREELANCE_MARKERS = {
    "self", "self employed", "self-employed", "selfemployed", "freelance",
    "freelancer", "independent", "independent contractor", "own business",
}

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s.]+\.[A-Za-z]{2,}$")

_PROFILE_RE = re.compile(
    r"linkedin\.com/(?:in|pub)/(?P<slug>[A-Za-z0-9\-\._%]+)", re.IGNORECASE
)

# separators that split a headline into "primary title | extra marketing"
_TITLE_SPLIT_RE = re.compile(r"\s*(?:\||•|·|∙|●|–{2,}|//|؍)\s*")


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _strip_junk(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "")
    text = _ZERO_WIDTH_RE.sub("", text)
    text = _EMOJI_RE.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def clean_person_name(first: str, last: str) -> Tuple[str, str, str]:
    """Return (first, last, full) with emoji, banners, pronouns and
    credentials removed. Arabic and Latin letters are both preserved."""
    def one(part: str) -> str:
        p = _strip_junk(part)
        p = _PRONOUN_RE.sub("", p)
        p = _BANNER_RE.sub("", p)
        # drop a trailing credential block after a comma: "Ali, PMP, MSc"
        if "," in p:
            head, _, tail = p.partition(",")
            tail_tokens = [
                t.strip().lower().strip(".")
                for t in re.split(r"[,/|]", tail)
                if t.strip()
            ]
            if tail_tokens and all(
                t in _CREDENTIALS or len(t) <= 4 for t in tail_tokens
            ):
                p = head
        p = re.sub(r'["`~^*_=<>\[\]{}]', "", p)   # keep apostrophes: Zu'bi
        p = re.sub(r"\s*[-–—]\s*$", "", p)
        p = re.sub(r"\s+", " ", p).strip(" .,-")
        return p

    f, l = one(first), one(last)
    full = ("%s %s" % (f, l)).strip()
    return f, l, full


def clean_position(position: str) -> Tuple[str, str]:
    """Return (position_clean, position_primary).

    position_clean keeps the whole headline minus noise.
    position_primary is the first meaningful segment - what you address the
    person by - e.g. "Senior Backend Engineer" out of
    "Senior Backend Engineer | Java | Spring | #OpenToWork".
    """
    p = _strip_junk(position)
    p = _BANNER_RE.sub("", p)
    p = re.sub(r"#\w+", "", p)
    p = re.sub(r"\s{2,}", " ", p).strip(" |-•·,")

    segments = [s.strip() for s in _TITLE_SPLIT_RE.split(p) if s.strip()]
    primary = segments[0] if segments else ""
    # a 1-2 word first segment is usually a tech tag, not a title
    if primary and len(primary.split()) == 1 and len(segments) > 1:
        longer = max(segments, key=lambda s: len(s.split()))
        if len(longer.split()) > 1:
            primary = longer
    # "Engineer at Acme" -> "Engineer"
    primary = re.split(r"\s+(?:at|@|في|عند)\s+", primary, maxsplit=1)[0].strip()
    return p, primary


def clean_company(company: str) -> Tuple[str, str, bool]:
    """Return (company_clean, company_key, is_freelance_or_none).

    company_key is an aggressive match key (lowercase, no legal form,
    no punctuation) so "Acme Co., Ltd." and "ACME" collapse into one row on
    the Companies sheet.
    """
    c = _strip_junk(company)
    c = _BANNER_RE.sub("", c)
    c = re.sub(r"\(\s*(?:formerly|ex|previously)[^)]*\)", "", c, flags=re.I)
    c = re.sub(r"#\w+", "", c)
    c = re.sub(r"\s{2,}", " ", c).strip(" .,-|•")

    probe = re.sub(r"[^a-z؀-ۿ ]", "", c.lower()).strip()
    probe = re.sub(r"\s+", " ", probe)
    if probe in _NOT_A_COMPANY or not probe:
        is_none = True
    else:
        is_none = probe in _FREELANCE_MARKERS

    key = probe
    # strip trailing legal forms, repeatedly ("acme co ltd" -> "acme")
    changed = True
    while changed and key:
        changed = False
        for suf in sorted(_COMPANY_SUFFIXES, key=len, reverse=True):
            if key.endswith(" " + suf):
                key = key[: -(len(suf) + 1)].strip()
                changed = True
    key = re.sub(r"\s+", " ", key).strip()
    if not key:
        key = probe
    return c, key, is_none


def clean_email(email: str) -> Tuple[str, bool]:
    e = _strip_junk(email).lower()
    return (e, True) if _EMAIL_RE.match(e) else (e, False)


def clean_profile_url(url: str) -> Tuple[str, str]:
    """Return (canonical_url, slug). Drops tracking query strings and locale
    sub-paths so the same person is never counted twice."""
    u = _strip_junk(url)
    m = _PROFILE_RE.search(u)
    if not m:
        return u, ""
    slug = m.group("slug").rstrip("/").lower()
    return "https://www.linkedin.com/in/%s" % slug, slug


def first_name_for_greeting(first: str, full: str) -> str:
    """A safe vocative form. Falls back to the first token of the full name,
    and to a neutral greeting when the name is unusable."""
    cand = (first or "").strip()
    if not cand and full:
        cand = full.split()[0]
    cand = re.sub(r"^(mr|mrs|ms|miss|dr|eng|engr|prof)\.?\s+", "", cand, flags=re.I)
    cand = cand.strip(" .,-")
    if len(cand) < 2 or cand.isdigit():
        return ""
    return cand[:1].upper() + cand[1:] if cand[:1].isascii() else cand


def guess_country_from_slug(slug: str) -> Optional[str]:
    """Very conservative: only returns a value when the public slug carries an
    explicit country token. Location is NOT part of the export, so this stays
    empty for most rows rather than inventing data."""
    if not slug:
        return None
    tokens = re.split(r"[-_]", slug)
    hints = {
        "jordan": "Jordan", "jo": None, "amman": "Jordan",
        "ksa": "Saudi Arabia", "saudi": "Saudi Arabia", "riyadh": "Saudi Arabia",
        "uae": "UAE", "dubai": "UAE", "abudhabi": "UAE",
        "qatar": "Qatar", "doha": "Qatar", "kuwait": "Kuwait",
        "egypt": "Egypt", "cairo": "Egypt", "palestine": "Palestine",
        "germany": "Germany", "berlin": "Germany", "uk": "United Kingdom",
        "london": "United Kingdom", "usa": "United States",
        "canada": "Canada", "toronto": "Canada", "turkey": "Turkey",
    }
    for t in tokens:
        if t in hints and hints[t]:
            return hints[t]
    return None
