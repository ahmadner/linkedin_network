# -*- coding: utf-8 -*-
"""
Contact history: has this person been messaged before, by whom, and when.

Three sources, merged by profile slug first and normalised name second:

  1. messages.csv     - every LinkedIn DM you ever sent or received (official export)
  2. Invitations.csv  - connection invitations and the note attached to them
  3. outreach_log.csv - your own local log, for outreach done outside LinkedIn
                        (email, WhatsApp, in person) or after the last export

messages.csv can be large, so it is streamed straight out of the zip rather
than loaded into memory. Nothing is inferred: a contact with no trace in any
source is reported as "never contacted", and if messages.csv is absent from
the export that is stated explicitly instead of being read as "never".
"""
from __future__ import annotations

import csv
import io
import itertools
import os
import re
import zipfile
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Dict, Iterable, List, Optional, Tuple

MESSAGE_DATE_FORMATS = (
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%d",
    "%m/%d/%y, %I:%M %p",
    "%m/%d/%Y, %I:%M %p",
    "%m/%d/%Y %H:%M",
    "%d %b %Y",
    "%b %d, %Y, %I:%M %p",
)

_SLUG_RE = re.compile(r"linkedin\.com/(?:in|pub)/([A-Za-z0-9\-\._%]+)", re.IGNORECASE)


@dataclass
class ContactHistory:
    """What we know about past contact with one person."""
    sent_by_me: int = 0
    received: int = 0
    invitation_sent: bool = False
    invitation_received: bool = False
    invitation_note: str = ""
    first_contact: Optional[date] = None
    last_contact: Optional[date] = None
    last_direction: str = ""          # "me -> them" | "them -> me"
    last_sent_by_me: Optional[date] = None
    last_received: Optional[date] = None
    channels: List[str] = field(default_factory=list)
    sources: List[str] = field(default_factory=list)

    # ---- derived ------------------------------------------------------- #
    @property
    def contacted_before(self) -> bool:
        return bool(self.sent_by_me or self.received or self.invitation_sent
                    or self.invitation_received)

    @property
    def ever_replied(self) -> bool:
        return self.received > 0

    def days_since(self, today: date) -> Optional[int]:
        return (today - self.last_contact).days if self.last_contact else None

    def note_new(self, when: Optional[date], outgoing: bool, source: str,
                 channel: str = "LinkedIn DM") -> None:
        if outgoing:
            self.sent_by_me += 1
        else:
            self.received += 1
        if source not in self.sources:
            self.sources.append(source)
        if channel not in self.channels:
            self.channels.append(channel)
        if when:
            if not self.first_contact or when < self.first_contact:
                self.first_contact = when
            if not self.last_contact or when >= self.last_contact:
                self.last_contact = when
                self.last_direction = "me -> them" if outgoing else "them -> me"
            if outgoing:
                if not self.last_sent_by_me or when > self.last_sent_by_me:
                    self.last_sent_by_me = when
            else:
                if not self.last_received or when > self.last_received:
                    self.last_received = when


@dataclass
class HistoryIndex:
    by_slug: Dict[str, ContactHistory] = field(default_factory=dict)
    by_name: Dict[str, ContactHistory] = field(default_factory=dict)
    me_name: str = ""
    me_slug: str = ""
    identity_method: str = "not determined"
    files_found: List[str] = field(default_factory=list)
    files_missing: List[str] = field(default_factory=list)
    messages_total: int = 0
    invitations_total: int = 0
    log_total: int = 0
    warnings: List[str] = field(default_factory=list)

    def lookup(self, slug: str, full_name: str) -> Tuple[ContactHistory, str]:
        """Return (history, how_it_matched). Slug is authoritative."""
        if slug:
            h = self.by_slug.get(slug.lower())
            if h:
                return h, "profile URL"
        key = _name_key(full_name)
        if key:
            h = self.by_name.get(key)
            if h:
                return h, "name match"
        return ContactHistory(), ""

    @property
    def has_message_data(self) -> bool:
        return "messages.csv" in self.files_found


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _name_key(name: str) -> str:
    return re.sub(r"[^a-z؀-ۿ]", "", (name or "").lower())


def _slug_of(url: str) -> str:
    m = _SLUG_RE.search(url or "")
    return m.group(1).rstrip("/").lower() if m else ""


def _parse_dt(value: str) -> Optional[date]:
    v = re.sub(r"\s+", " ", (value or "").strip())
    if not v:
        return None
    v = re.sub(r"\s*(UTC|GMT|Z)$", "", v, flags=re.IGNORECASE).strip()
    for fmt in MESSAGE_DATE_FORMATS:
        try:
            return datetime.strptime(v, fmt).date()
        except ValueError:
            continue
    m = re.search(r"(?:19|20)\d{2}-\d{2}-\d{2}", v)
    if m:
        try:
            return datetime.strptime(m.group(0), "%Y-%m-%d").date()
        except ValueError:
            return None
    return None


def _rows_from_stream(text_lines: Iterable[str], header_tokens: Tuple[str, ...]):
    """csv.DictReader starting at the real header line.

    Works on a line iterator so a 200 MB messages.csv never lands in memory,
    and quoted newlines inside message bodies are still parsed correctly.
    """
    it = iter(text_lines)
    header = None
    for line in it:
        up = line.upper()
        if all(tok in up for tok in header_tokens):
            header = line
            break
    if header is None:
        return
    for row in csv.DictReader(itertools.chain([header], it)):
        yield row


def _open_member(input_path: str, filename: str):
    """Yield text lines of `filename` from a zip, a folder, or the folder that
    holds the given Connections.csv. Returns None when it is not there."""
    target = filename.lower()

    if zipfile.is_zipfile(input_path):
        with zipfile.ZipFile(input_path) as zf:
            for name in zf.namelist():
                if os.path.basename(name).lower() == target:
                    with zf.open(name) as raw:
                        wrapper = io.TextIOWrapper(raw, encoding="utf-8-sig",
                                                   errors="replace", newline="")
                        for line in wrapper:
                            yield line
                    return
        return

    folder = input_path if os.path.isdir(input_path) else os.path.dirname(input_path)
    for name in os.listdir(folder or "."):
        if name.lower() == target:
            with open(os.path.join(folder, name), "r", encoding="utf-8-sig",
                      errors="replace", newline="") as fh:
                for line in fh:
                    yield line
            return


def _member_exists(input_path: str, filename: str) -> bool:
    target = filename.lower()
    if zipfile.is_zipfile(input_path):
        with zipfile.ZipFile(input_path) as zf:
            return any(os.path.basename(n).lower() == target for n in zf.namelist())
    folder = input_path if os.path.isdir(input_path) else os.path.dirname(input_path)
    try:
        return any(n.lower() == target for n in os.listdir(folder or "."))
    except OSError:
        return False


# --------------------------------------------------------------------------- #
# identity: which side of every conversation is me
# --------------------------------------------------------------------------- #
def _resolve_identity(input_path: str) -> Tuple[str, str, str]:
    """Return (my_name, my_slug, method). Profile.csv is authoritative."""
    if _member_exists(input_path, "profile.csv"):
        rows = list(_rows_from_stream(_open_member(input_path, "profile.csv"),
                                      ("FIRST NAME", "LAST NAME")))
        if rows:
            p = rows[0]
            name = ("%s %s" % ((p.get("First Name") or "").strip(),
                               (p.get("Last Name") or "").strip())).strip()
            if name:
                return name, "", "Profile.csv"
    return "", "", "not determined"


def _infer_me_from_senders(senders: Counter) -> Tuple[str, str]:
    """Fallback: the party that appears as sender in the most conversations is
    the account owner."""
    if not senders:
        return "", "no messages"
    name, _count = senders.most_common(1)[0]
    return name, "most frequent sender in messages.csv"


# --------------------------------------------------------------------------- #
# loaders
# --------------------------------------------------------------------------- #
def _add(index: HistoryIndex, slug: str, name: str) -> ContactHistory:
    """Get or create the history bucket for a counterpart, keyed both ways."""
    slug = (slug or "").lower()
    key = _name_key(name)
    h = None
    if slug and slug in index.by_slug:
        h = index.by_slug[slug]
    elif key and key in index.by_name:
        h = index.by_name[key]
    if h is None:
        h = ContactHistory()
    if slug:
        index.by_slug[slug] = h
    if key:
        index.by_name[key] = h
    return h


def _load_messages(input_path: str, index: HistoryIndex) -> None:
    if not _member_exists(input_path, "messages.csv"):
        index.files_missing.append("messages.csv")
        index.warnings.append(
            "messages.csv was not in the export, so DM history is unknown - "
            "request the full archive (or tick Messages) to fill this in")
        return
    index.files_found.append("messages.csv")

    # pass 1: who am I
    senders: Counter = Counter()
    rows = list(_rows_from_stream(_open_member(input_path, "messages.csv"),
                                  ("FROM", "TO")))
    for r in rows:
        s = (r.get("FROM") or r.get("From") or "").strip()
        if s:
            senders[s] += 1

    if not index.me_name:
        guessed, method = _infer_me_from_senders(senders)
        index.me_name, index.identity_method = guessed, method
    me_key = _name_key(index.me_name)

    # pass 2: attribute every message to the counterpart
    for r in rows:
        sender = (r.get("FROM") or r.get("From") or "").strip()
        recipient = (r.get("TO") or r.get("To") or "").strip()
        sender_url = (r.get("SENDER PROFILE URL") or r.get("Sender Profile URL") or "")
        recipient_url = (r.get("RECIPIENT PROFILE URLS")
                         or r.get("Recipient Profile Urls") or "")
        when = _parse_dt(r.get("DATE") or r.get("Date") or "")

        outgoing = _name_key(sender) == me_key and bool(me_key)
        if outgoing:
            counterpart, counterpart_url = recipient, recipient_url
        else:
            counterpart, counterpart_url = sender, sender_url

        # group conversations have several recipients: count each one
        slugs = [s for s in (_slug_of(u) for u in re.split(r"[;,\s]+", counterpart_url))
                 if s]
        if not slugs and not counterpart:
            continue
        if slugs:
            for s in slugs:
                _add(index, s, counterpart if len(slugs) == 1 else "") \
                    .note_new(when, outgoing, "messages.csv")
        else:
            _add(index, "", counterpart).note_new(when, outgoing, "messages.csv")
        index.messages_total += 1


def _load_invitations(input_path: str, index: HistoryIndex) -> None:
    if not _member_exists(input_path, "invitations.csv"):
        index.files_missing.append("Invitations.csv")
        return
    index.files_found.append("Invitations.csv")

    me_key = _name_key(index.me_name)
    for r in _rows_from_stream(_open_member(input_path, "invitations.csv"),
                               ("FROM", "TO")):
        frm = (r.get("From") or r.get("FROM") or "").strip()
        to = (r.get("To") or r.get("TO") or "").strip()
        direction = (r.get("Direction") or r.get("DIRECTION") or "").strip().upper()
        when = _parse_dt(r.get("Sent At") or r.get("SENT AT") or "")
        note = (r.get("Message") or r.get("MESSAGE") or "").strip()
        url = (r.get("inviterProfileUrl") or r.get("inviteeProfileUrl")
               or r.get("Profile URL") or "")

        if direction in ("OUTGOING", "SENT"):
            outgoing = True
        elif direction in ("INCOMING", "RECEIVED"):
            outgoing = False
        else:
            outgoing = bool(me_key) and _name_key(frm) == me_key

        counterpart = to if outgoing else frm
        if not counterpart:
            continue
        h = _add(index, _slug_of(url), counterpart)
        if outgoing:
            h.invitation_sent = True
        else:
            h.invitation_received = True
        if note and not h.invitation_note:
            h.invitation_note = note[:300]
        if when:
            if not h.first_contact or when < h.first_contact:
                h.first_contact = when
            if not h.last_contact or when >= h.last_contact:
                h.last_contact = when
                h.last_direction = "me -> them" if outgoing else "them -> me"
        if "Invitation" not in h.channels:
            h.channels.append("Invitation")
        if "Invitations.csv" not in h.sources:
            h.sources.append("Invitations.csv")
        index.invitations_total += 1


LOG_HEADER = ["profile_url", "full_name", "channel", "direction", "sent_at", "note"]


def _load_local_log(log_path: str, index: HistoryIndex) -> None:
    """Your own log of outreach done outside LinkedIn, or since the last export.

    outreach_log.csv:
        profile_url,full_name,channel,direction,sent_at,note
        https://www.linkedin.com/in/lina-haddad-jordan/,Lina Haddad,Email,out,2026-11-20,sent CV
    """
    if not log_path or not os.path.exists(log_path):
        return
    index.files_found.append(os.path.basename(log_path))
    with open(log_path, "r", encoding="utf-8-sig", newline="") as fh:
        for r in csv.DictReader(fh):
            name = (r.get("full_name") or "").strip()
            slug = _slug_of(r.get("profile_url") or "")
            if not name and not slug:
                continue
            direction = (r.get("direction") or "out").strip().lower()
            outgoing = not direction.startswith("in")
            when = _parse_dt(r.get("sent_at") or "")
            channel = (r.get("channel") or "Manual log").strip() or "Manual log"
            h = _add(index, slug, name)
            h.note_new(when, outgoing, os.path.basename(log_path), channel)
            index.log_total += 1


def load_history(input_path: str, log_path: str = "") -> HistoryIndex:
    index = HistoryIndex()
    index.me_name, index.me_slug, index.identity_method = _resolve_identity(input_path)
    if index.me_name:
        index.files_found.append("Profile.csv")
    _load_messages(input_path, index)
    _load_invitations(input_path, index)
    _load_local_log(log_path, index)
    return index


# --------------------------------------------------------------------------- #
# what to do about it
# --------------------------------------------------------------------------- #
def outreach_mode(h: ContactHistory, today: date,
                  has_message_data: bool) -> Tuple[str, str]:
    """Return (mode, advice).

    mode drives which message template is used:
        cold      - no trace of previous contact -> full introduction
        reconnect - you spoke before and it went somewhere -> pick the thread up
        nudge     - you wrote and never got an answer -> one short, soft nudge
    """
    if not h.contacted_before:
        if not has_message_data:
            return "cold", ("No history available (messages.csv missing) - "
                            "check the thread on LinkedIn before sending")
        return "cold", "First contact - safe to send the introduction"

    days = h.days_since(today)
    days_txt = "%d days ago" % days if days is not None else "date unknown"

    if h.sent_by_me and not h.received:
        if days is not None and days < 30:
            return "nudge", ("You wrote %s and got no reply - do not write again "
                             "yet, wait at least a month" % days_txt)
        return "nudge", ("You wrote %s and never got a reply - one short nudge "
                         "only, do not repeat the pitch" % days_txt)

    if h.received and not h.sent_by_me:
        return "reconnect", ("They wrote to you (%s) and you did not answer - "
                             "reply to the existing thread" % days_txt)

    # an invitation on its own is not a conversation: no message was ever
    # exchanged, so the introduction is still new to them
    if not (h.sent_by_me or h.received):
        if h.invitation_sent:
            return "cold", ("Only an invitation was sent (%s), never a message - "
                            "the introduction is still new to them" % days_txt)
        return "cold", ("They invited you (%s) but no message was ever exchanged - "
                        "the introduction is still new to them" % days_txt)

    if days is not None and days <= 60:
        return "reconnect", ("You spoke %s - recent conversation, continue it "
                             "instead of pitching from scratch" % days_txt)

    return "reconnect", ("You spoke before (%s) and they replied - reconnect, "
                         "do not introduce yourself again" % days_txt)
