# -*- coding: utf-8 -*-
"""
LinkedIn network analyser - pipeline entry point.

    python src/main.py --input data/raw/Basic_LinkedInDataExport.zip

Reads LinkedIn's official data export, cleans and classifies every connection,
scores it against your targets, writes a tailored Arabic + English message for
each person, and produces one Excel workbook plus a flat CSV.

No network calls, no scraping, no model calls - deterministic and repeatable.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import date
from typing import Dict, List, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import classify
import history as history_mod
import loader
import normalize
from messages import MessageBuilder, pick_archetype, validate_profile
from report import build_workbook
from scoring import score_contact

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_PROFILE = os.path.join(ROOT, "config", "my_profile.json")
DEFAULT_OVERRIDES = os.path.join(ROOT, "config", "company_overrides.csv")
DEFAULT_OUTDIR = os.path.join(ROOT, "data", "out")


# --------------------------------------------------------------------------- #
# config
# --------------------------------------------------------------------------- #
def load_profile(path: str) -> Dict:
    if not os.path.exists(path):
        raise FileNotFoundError("Profile config not found: %s" % path)
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def load_overrides(path: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not os.path.exists(path):
        return out
    with open(path, "r", encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            key = (row.get("company") or "").strip().lower()
            ind = (row.get("industry") or "").strip()
            if key and ind:
                out[key] = ind
    return out


# --------------------------------------------------------------------------- #
# dedupe
# --------------------------------------------------------------------------- #
def _completeness(rec: loader.RawConnection) -> int:
    return sum(bool(x) for x in (rec.first_name, rec.last_name, rec.profile_url,
                                 rec.email, rec.company, rec.position,
                                 rec.connected_on))


def dedupe(records: List[loader.RawConnection]) -> Tuple[List[loader.RawConnection], int]:
    """Merge on profile slug first, then on normalised name+company."""
    by_key: Dict[str, loader.RawConnection] = {}
    order: List[str] = []
    removed = 0

    for rec in records:
        _url, slug = normalize.clean_profile_url(rec.profile_url)
        if slug:
            key = "slug:%s" % slug
        else:
            _f, _l, full = normalize.clean_person_name(rec.first_name, rec.last_name)
            _c, ckey, _n = normalize.clean_company(rec.company)
            name_key = re.sub(r"[^a-z؀-ۿ]", "", full.lower())
            key = "name:%s|%s" % (name_key, ckey)
            if not name_key:
                key = "row:%d" % rec.source_row

        if key in by_key:
            removed += 1
            existing = by_key[key]
            # keep the richer row, but backfill empty fields from the other
            keep, drop = ((existing, rec)
                          if _completeness(existing) >= _completeness(rec)
                          else (rec, existing))
            for f in ("first_name", "last_name", "profile_url", "email",
                      "company", "position", "connected_on"):
                if not getattr(keep, f) and getattr(drop, f):
                    setattr(keep, f, getattr(drop, f))
            if keep.connected_date is None and drop.connected_date is not None:
                keep.connected_date = drop.connected_date
            keep.issues = sorted(set(keep.issues) | {"duplicate_merged"})
            by_key[key] = keep
        else:
            by_key[key] = rec
            order.append(key)

    return [by_key[k] for k in order], removed


# --------------------------------------------------------------------------- #
# enrichment pipeline
# --------------------------------------------------------------------------- #
def load_previous_tracking(xlsx_path: str) -> Dict[str, Dict[str, str]]:
    """Read back the outreach columns you filled in a previous report, keyed by
    profile URL, so re-running after a fresh export never loses your work."""
    if not xlsx_path or not os.path.exists(xlsx_path):
        return {}
    try:
        from openpyxl import load_workbook
    except ImportError:
        return {}
    out: Dict[str, Dict[str, str]] = {}
    wb = load_workbook(xlsx_path, read_only=True, data_only=True)
    if "Connections" not in wb.sheetnames:
        return {}
    ws = wb["Connections"]
    rows = ws.iter_rows(values_only=True)
    try:
        header = [str(h or "").strip() for h in next(rows)]
    except StopIteration:
        return {}
    wanted = {"LinkedIn Profile": "url", "Status": "status",
              "Date Sent": "date_sent", "Replied?": "replied",
              "Next Step": "next_step", "Notes": "notes"}
    idx = {wanted[h]: i for i, h in enumerate(header) if h in wanted}
    if "url" not in idx:
        return {}
    for row in rows:
        url = row[idx["url"]] if idx["url"] < len(row) else None
        if not url:
            continue
        _canon, slug = normalize.clean_profile_url(str(url))
        if not slug:
            continue
        vals = {}
        for key in ("status", "date_sent", "replied", "next_step", "notes"):
            if key in idx and idx[key] < len(row):
                v = row[idx[key]]
                if v not in (None, ""):
                    vals[key] = v
        # a row left untouched carries no information worth restoring
        if vals and vals.get("status") not in (None, "", "Not started"):
            out[slug] = vals
        elif len(vals) > 1:
            out[slug] = vals
    wb.close()
    return out


def build_contacts(records: List[loader.RawConnection], profile: Dict,
                   overrides: Dict[str, str], today: date,
                   hist: "history_mod.HistoryIndex" = None,
                   previous: Dict[str, Dict[str, str]] = None) -> List[Dict]:
    targeting = profile.get("targeting") or {}
    builder = MessageBuilder(profile)
    target_functions = targeting.get("target_functions") or []

    # ---- pass 1: clean + classify ------------------------------------------
    staged: List[Dict] = []
    for rec in records:
        first, last, full = normalize.clean_person_name(rec.first_name, rec.last_name)
        pos_clean, pos_primary = normalize.clean_position(rec.position)
        co_clean, co_key, co_is_none = normalize.clean_company(rec.company)
        email, email_valid = normalize.clean_email(rec.email)
        url, slug = normalize.clean_profile_url(rec.profile_url)

        seniority, rank, sen_ev = classify.classify_seniority(pos_clean)
        function, fn_ev, _all_fn = classify.classify_function(pos_clean, co_clean)
        industry, ind_ev = classify.classify_industry(
            co_clean, function, overrides, co_key)
        if co_is_none:
            industry = "Freelance / Self-employed" if co_clean else "Unknown"
            ind_ev = "no real employer in the export"

        recruiter = classify.is_recruiter(pos_clean)
        staged.append({
            "first_name": first, "last_name": last, "full_name": full,
            "greeting_name": normalize.first_name_for_greeting(first, full),
            "profile_url": url, "slug": slug,
            "email": email, "email_valid": email_valid,
            "email_valid_txt": "Yes" if email_valid else "No",
            "company_clean": "" if co_is_none else co_clean,
            "company_raw": rec.company,
            "company_key": "" if co_is_none else co_key,
            "industry": industry,
            "position_clean": pos_clean, "position_primary": pos_primary,
            "seniority": seniority, "seniority_rank": rank,
            "function": function,
            "is_recruiter": recruiter,
            "is_recruiter_txt": "Yes" if recruiter else "No",
            "is_decision_maker": classify.is_decision_maker(rank),
            "is_decision_maker_txt": "Yes" if classify.is_decision_maker(rank) else "No",
            "connected_date": rec.connected_date,
            "years_connected": (round((today - rec.connected_date).days / 365.25, 1)
                                if rec.connected_date else ""),
            "country": normalize.guess_country_from_slug(slug) or "",
            "evidence": "seniority[%s]; function[%s]; industry[%s]" % (
                sen_ev, fn_ev, ind_ev),
            "issues_txt": ", ".join(sorted(set(rec.issues))),
            "status": "Not started", "date_sent": "", "replied": "",
            "next_step": "", "notes": "",
        })

    # ---- pass 2: per-company counts (needed by the score) -------------------
    counts = Counter(c["company_key"] for c in staged if c["company_key"])
    for c in staged:
        c["company_contact_count"] = counts.get(c["company_key"], 0)

    # ---- pass 3: contact history -------------------------------------------
    hist = hist or history_mod.HistoryIndex()
    previous = previous or {}
    has_msgs = hist.has_message_data
    for c in staged:
        h, matched = hist.lookup(c["slug"], c["full_name"])
        mode, advice = history_mod.outreach_mode(h, today, has_msgs)
        days = h.days_since(today)
        c.update({
            "contacted_before": h.contacted_before,
            "contacted_before_txt": ("Yes" if h.contacted_before else
                                     ("No - first contact" if has_msgs
                                      else "Unknown - no message data")),
            "msgs_sent": h.sent_by_me,
            "msgs_received": h.received,
            "ever_replied_txt": "Yes" if h.ever_replied else "No",
            "last_contact": h.last_contact or "",
            "days_since_contact": days if days is not None else "",
            "last_direction": h.last_direction,
            "invitation_sent_txt": "Yes" if h.invitation_sent else "No",
            "channels_txt": ", ".join(h.channels),
            "history_match": matched,
            "outreach_advice": advice,
            "_mode": mode,
            "_days_since": days,
        })
        prev = previous.get(c["slug"])
        if prev:
            c["status"] = prev.get("status") or c["status"]
            c["date_sent"] = prev.get("date_sent") or ""
            c["replied"] = prev.get("replied") or ""
            c["next_step"] = prev.get("next_step") or ""
            c["notes"] = prev.get("notes") or ""
            c["carried_over"] = True

    # ---- pass 4: score + messages ------------------------------------------
    for c in staged:
        score, bucket, breakdown = score_contact(
            seniority=c["seniority"], seniority_rank=c["seniority_rank"],
            function=c["function"], industry=c["industry"],
            company_key=c["company_key"], company_clean=c["company_clean"],
            email_valid=c["email_valid"], connected_date=c["connected_date"],
            company_contact_count=c["company_contact_count"],
            is_recruiter_flag=c["is_recruiter"], targeting=targeting, today=today,
            outreach_mode=c.get("_mode", "cold"),
            days_since_contact=c.get("_days_since"))
        c["score"], c["bucket"], c["score_breakdown"] = score, bucket, breakdown

        archetype = pick_archetype(
            is_recruiter_flag=c["is_recruiter"], seniority=c["seniority"],
            seniority_rank=c["seniority_rank"], function=c["function"],
            target_functions=target_functions)
        c.update(builder.build(
            greeting_name=c["greeting_name"],
            their_role=c["position_primary"] or c["position_clean"],
            company=c["company_clean"], industry=c["industry"],
            function=c["function"], archetype=archetype,
            mode=c.get("_mode", "cold"), days_since=c.get("_days_since")))
        c["note_ar_len"] = len(c["note_ar"])
        c["note_en_len"] = len(c["note_en"])

    staged.sort(key=lambda c: (-c["score"], c["company_clean"] or "zzz",
                               c["full_name"]))
    for i, c in enumerate(staged, start=1):
        c["idx"] = i
    return staged


def aggregate_companies(contacts: List[Dict]) -> List[Dict]:
    groups: Dict[str, List[Dict]] = defaultdict(list)
    for c in contacts:
        if c["company_key"]:
            groups[c["company_key"]].append(c)

    out: List[Dict] = []
    for key, members in groups.items():
        members_sorted = sorted(
            members, key=lambda m: (-m["seniority_rank"], -m["score"]))
        top = members_sorted[0]
        best = max(m["score"] for m in members)
        display = Counter(m["company_clean"] for m in members).most_common(1)[0][0]
        out.append({
            "company_clean": display,
            "industry": Counter(m["industry"] for m in members).most_common(1)[0][0],
            "count": len(members),
            "best_score": best,
            "avg_score": round(sum(m["score"] for m in members) / len(members), 1),
            "top_seniority": top["seniority"],
            "top_contact": top["full_name"],
            "top_role": top["position_primary"] or top["position_clean"],
            "has_recruiter_txt": "Yes" if any(m["is_recruiter"] for m in members) else "No",
            "decision_makers": sum(1 for m in members if m["is_decision_maker"]),
            "functions": ", ".join(
                "%s (%d)" % (f, n) for f, n in
                Counter(m["function"] for m in members).most_common(6)),
            "emails": sum(1 for m in members if m["email_valid"]),
        })
    out.sort(key=lambda r: (-r["best_score"], -r["count"], r["company_clean"]))
    return out


# --------------------------------------------------------------------------- #
# optional: pre-fill my own profile from the same export
# --------------------------------------------------------------------------- #
def suggest_profile_from_export(extra: Dict[str, bytes]) -> Dict:
    """LinkedIn's export also contains YOUR Profile.csv / Positions.csv /
    Skills.csv. Use them to pre-fill config/my_profile.json instead of typing."""
    out: Dict = {}

    def rows(name: str):
        blob = extra.get(name)
        if not blob:
            return []
        text = blob.decode("utf-8-sig", "replace")
        return list(csv.DictReader(io.StringIO(text[loader._find_header_offset(text):])))

    prof = rows("profile.csv")
    if prof:
        p = prof[0]
        first = (p.get("First Name") or "").strip()
        last = (p.get("Last Name") or "").strip()
        out["full_name"] = ("%s %s" % (first, last)).strip()
        out["first_name"] = first
        out["headline"] = (p.get("Headline") or "").strip()
        out["location"] = (p.get("Geo Location") or p.get("Location") or "").strip()

    pos = rows("positions.csv")
    if pos:
        current = pos[0]
        out["current_role"] = (current.get("Title") or "").strip()
        out["current_company"] = (current.get("Company Name") or "").strip()
        years = set()
        for row in pos:
            for field in ("Started On", "Finished On"):
                m = re.search(r"(?:19|20)\d{2}", row.get(field) or "")
                if m:
                    years.add(int(m.group(0)))
        if years:
            out["years_experience"] = max(0, date.today().year - min(years))

    sk = rows("skills.csv")
    if sk:
        names = [(r.get("Name") or "").strip() for r in sk]
        out["top_skills"] = [n for n in names if n][:8]

    edu = rows("education.csv")
    if edu:
        e = edu[0]
        out["education"] = ", ".join(
            x for x in [(e.get("Degree Name") or "").strip(),
                        (e.get("School Name") or "").strip()] if x)
    return out


# --------------------------------------------------------------------------- #
# flat CSV (for pivoting, CRM import, or a second pass later)
# --------------------------------------------------------------------------- #
CSV_FIELDS = [
    "idx", "bucket", "score", "full_name", "first_name", "last_name",
    "profile_url", "email", "email_valid", "company_clean", "company_key",
    "industry", "position_clean", "position_primary", "seniority",
    "seniority_rank", "function", "archetype", "archetype_label",
    "is_recruiter", "is_decision_maker", "connected_date", "years_connected",
    "company_contact_count", "country", "score_breakdown", "evidence",
    "issues_txt", "contacted_before_txt", "mode", "mode_label", "msgs_sent",
    "msgs_received", "ever_replied_txt", "last_contact", "days_since_contact",
    "last_direction", "invitation_sent_txt", "channels_txt", "history_match",
    "outreach_advice", "note_ar", "note_en", "message_ar", "message_en",
    "followup_ar", "followup_en",
]


def write_csv(contacts: List[Dict], path: str) -> str:
    with open(path, "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=CSV_FIELDS, extrasaction="ignore")
        w.writeheader()
        for c in contacts:
            row = dict(c)
            for k in ("connected_date", "last_contact"):
                if hasattr(row.get(k), "isoformat"):
                    row[k] = row[k].isoformat()
            w.writerow(row)
    return path


# --------------------------------------------------------------------------- #
# cli
# --------------------------------------------------------------------------- #
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Analyse a LinkedIn data export into a tailored outreach workbook.")
    ap.add_argument("--input", "-i", required=True,
                    help="path to the export .zip, the extracted folder, or Connections.csv")
    ap.add_argument("--profile", "-p", default=DEFAULT_PROFILE)
    ap.add_argument("--overrides", default=DEFAULT_OVERRIDES)
    ap.add_argument("--outdir", "-o", default=DEFAULT_OUTDIR)
    ap.add_argument("--name", default=None, help="output file stem")
    ap.add_argument("--log", default=os.path.join(ROOT, "data", "outreach_log.csv"),
                    help="your own log of outreach done outside LinkedIn")
    ap.add_argument("--previous", default=None,
                    help="a previous report .xlsx to carry your Status/Notes over from")
    ap.add_argument("--no-history", action="store_true",
                    help="skip messages.csv/Invitations.csv parsing")
    ap.add_argument("--suggest-profile", action="store_true",
                    help="also write config/my_profile.suggested.json from your own export files")
    args = ap.parse_args(argv)

    today = date.today()
    profile = load_profile(args.profile)
    overrides = load_overrides(args.overrides)

    print("Reading %s ..." % args.input)
    res = loader.load(args.input)
    print("  parsed %d data rows (%d empty rows skipped)"
          % (len(res.connections), res.skipped_rows))
    print("  header: %s" % ", ".join(res.header_found))

    records, dup_removed = dedupe(res.connections)
    print("  %d unique contacts (%d duplicates merged)" % (len(records), dup_removed))

    if args.no_history:
        hist = history_mod.HistoryIndex()
        hist.warnings.append("history parsing disabled with --no-history")
    else:
        hist = history_mod.load_history(args.input, args.log)
        print("  contact history: %s" % (", ".join(hist.files_found) or "no sources found"))
        if hist.me_name:
            print("    account owner: %s (via %s)" % (hist.me_name, hist.identity_method))
        print("    %d messages, %d invitations, %d manual log entries"
              % (hist.messages_total, hist.invitations_total, hist.log_total))
        for warn in hist.warnings:
            print("    ! %s" % warn)

    previous = load_previous_tracking(args.previous) if args.previous else {}
    if previous:
        print("  carrying tracking over for %d contacts from %s"
              % (len(previous), os.path.basename(args.previous)))

    ok, gaps = validate_profile(profile)
    if gaps:
        print("\nProfile gaps (messages still generated, placeholders left empty):")
        for g in gaps:
            print("   - %s" % g)
    print("")

    contacts = build_contacts(records, profile, overrides, today, hist, previous)
    companies = aggregate_companies(contacts)

    quality = {
        "source_path": res.source_path,
        "header_found": res.header_found,
        "warnings": res.warnings,
        "rows_in_file": len(res.connections),
        "skipped_rows": res.skipped_rows,
        "duplicates_removed": dup_removed,
        "history_found": hist.files_found,
        "history_missing": hist.files_missing,
        "me_name": hist.me_name,
        "identity_method": hist.identity_method,
        "messages_total": hist.messages_total,
        "invitations_total": hist.invitations_total,
        "log_total": hist.log_total,
        "carried_over": sum(1 for c in contacts if c.get("carried_over")),
    }

    os.makedirs(args.outdir, exist_ok=True)
    stem = args.name or "linkedin_network_%s" % today.isoformat()
    xlsx = os.path.join(args.outdir, stem + ".xlsx")
    csv_path = os.path.join(args.outdir, stem + ".csv")

    build_workbook(contacts, companies, quality, profile, xlsx)
    write_csv(contacts, csv_path)

    if args.suggest_profile and res.extra_files:
        sug = suggest_profile_from_export(res.extra_files)
        if sug:
            sug_path = os.path.join(ROOT, "config", "my_profile.suggested.json")
            with open(sug_path, "w", encoding="utf-8") as fh:
                json.dump({"me": sug}, fh, ensure_ascii=False, indent=2)
            print("Wrote profile suggestion -> %s" % sug_path)

    buckets = Counter(c["bucket"] for c in contacts)
    print("Contacts: %d  |  companies: %d" % (len(contacts), len(companies)))
    print("Priority A/B/C/D: %d / %d / %d / %d"
          % (buckets.get("A", 0), buckets.get("B", 0),
             buckets.get("C", 0), buckets.get("D", 0)))
    modes = Counter(c["mode"] for c in contacts)
    print("Never contacted: %d  |  reconnect: %d  |  awaiting reply: %d"
          % (modes.get("cold", 0), modes.get("reconnect", 0), modes.get("nudge", 0)))
    print("Recruiters: %d  |  decision makers: %d  |  emails: %d"
          % (sum(1 for c in contacts if c["is_recruiter"]),
             sum(1 for c in contacts if c["is_decision_maker"]),
             sum(1 for c in contacts if c["email_valid"])))
    print("\nExcel -> %s\nCSV   -> %s" % (xlsx, csv_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
