# -*- coding: utf-8 -*-
"""
Excel report writer (openpyxl only - no pandas needed).

Sheets produced:
  Dashboard     KPIs, breakdowns and charts
  Priority_A    the shortlist, ready to work top-down
  Connections   every contact, fully classified, with outreach tracking columns
  Messages      note + full DM + follow-up, Arabic and English, length-checked
  Companies     one row per employer, aggregated
  Data_Quality  exactly what was missing or repaired in the source file
  Reference     how every label and score was produced
"""
from __future__ import annotations

from collections import Counter
from datetime import date, datetime
from typing import Dict, List

from openpyxl import Workbook
from openpyxl.chart import BarChart, PieChart, Reference
from openpyxl.formatting.rule import CellIsRule, ColorScaleRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

# --------------------------------------------------------------------------- #
# style palette
# --------------------------------------------------------------------------- #
NAVY = "1F3864"
SLATE = "2F3B52"
LIGHT = "EEF2F7"
BORDER_CLR = "C9D3E0"

HDR_FILL = PatternFill("solid", fgColor=NAVY)
HDR_FONT = Font(color="FFFFFF", bold=True, size=11)
TITLE_FONT = Font(color=NAVY, bold=True, size=16)
SUB_FONT = Font(color=SLATE, bold=True, size=12)
THIN = Side(style="thin", color=BORDER_CLR)
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
ZEBRA = PatternFill("solid", fgColor="F7F9FC")

BUCKET_FILL = {
    "A": PatternFill("solid", fgColor="C6EFCE"),
    "B": PatternFill("solid", fgColor="FFF2CC"),
    "C": PatternFill("solid", fgColor="FCE4D6"),
    "D": PatternFill("solid", fgColor="EDEDED"),
    "X": PatternFill("solid", fgColor="E0E0E0"),
}

AR = Alignment(horizontal="right", vertical="top", wrap_text=True, readingOrder=2)
WRAP = Alignment(vertical="top", wrap_text=True)
TOP = Alignment(vertical="top")


# --------------------------------------------------------------------------- #
# column definitions
# --------------------------------------------------------------------------- #
CONNECTION_COLUMNS = [
    ("#", "idx", 5),
    ("Priority", "bucket", 9),
    ("Score", "score", 7),
    ("Full Name", "full_name", 24),
    ("First Name", "first_name", 14),
    ("Last Name", "last_name", 14),
    ("LinkedIn Profile", "profile_url", 34),
    ("Email", "email", 26),
    ("Email Valid", "email_valid_txt", 11),
    ("Company", "company_clean", 28),
    ("Company Key", "company_key", 22),
    ("Industry", "industry", 26),
    ("Position (raw)", "position_clean", 36),
    ("Position (primary)", "position_primary", 28),
    ("Seniority", "seniority", 20),
    ("Rank", "seniority_rank", 7),
    ("Function", "function", 24),
    ("Outreach Archetype", "archetype_label", 26),
    ("Recruiter?", "is_recruiter_txt", 11),
    ("Decision Maker?", "is_decision_maker_txt", 15),
    ("Connected On", "connected_date", 13),
    ("Years Connected", "years_connected", 14),
    ("Contacts @ Company", "company_contact_count", 17),
    ("Country (if in URL)", "country", 16),
    ("Score Breakdown", "score_breakdown", 46),
    ("Classification Evidence", "evidence", 40),
    ("Data Issues", "issues_txt", 24),
    ("Contacted Before?", "contacted_before_txt", 15),
    ("Outreach Mode", "mode_label", 24),
    ("Msgs I Sent", "msgs_sent", 11),
    ("Msgs Received", "msgs_received", 13),
    ("They Ever Replied?", "ever_replied_txt", 16),
    ("Last Contact", "last_contact", 13),
    ("Days Since", "days_since_contact", 11),
    ("Last Direction", "last_direction", 14),
    ("Invite Sent?", "invitation_sent_txt", 12),
    ("Channels Used", "channels_txt", 18),
    ("History Matched By", "history_match", 17),
    ("Outreach Advice", "outreach_advice", 54),
    ("Status", "status", 14),
    ("Date Sent", "date_sent", 12),
    ("Replied?", "replied", 10),
    ("Next Step", "next_step", 18),
    ("Notes", "notes", 30),
]

MESSAGE_COLUMNS = [
    ("#", "idx", 5),
    ("Priority", "bucket", 9),
    ("Full Name", "full_name", 22),
    ("Company", "company_clean", 24),
    ("Position (primary)", "position_primary", 26),
    ("Archetype", "archetype_label", 24),
    ("Contacted Before?", "contacted_before_txt", 14),
    ("Outreach Mode", "mode_label", 23),
    ("Short DM - AR", "note_ar", 46),
    ("len", "note_ar_len", 6),
    ("Short DM - EN", "note_en", 46),
    ("len", "note_en_len", 6),
    ("Message - AR", "message_ar", 62),
    ("Message - EN", "message_en", 62),
    ("Follow-up - AR", "followup_ar", 40),
    ("Follow-up - EN", "followup_en", 40),
]

COMPANY_COLUMNS = [
    ("Company", "company_clean", 32),
    ("Industry", "industry", 26),
    ("Contacts", "count", 10),
    ("Best Score", "best_score", 11),
    ("Avg Score", "avg_score", 10),
    ("Highest Seniority", "top_seniority", 20),
    ("Best Entry Point", "top_contact", 30),
    ("Their Role", "top_role", 30),
    ("Has Recruiter?", "has_recruiter_txt", 14),
    ("Decision Makers", "decision_makers", 15),
    ("Functions Present", "functions", 42),
    ("Emails on File", "emails", 14),
]

ARABIC_FIELDS = {"note_ar", "message_ar", "followup_ar"}


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _write_header(ws, columns, row=1):
    for ci, (label, _key, width) in enumerate(columns, start=1):
        c = ws.cell(row=row, column=ci, value=label)
        c.fill = HDR_FILL
        c.font = HDR_FONT
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = BOX
        ws.column_dimensions[get_column_letter(ci)].width = width
    ws.row_dimensions[row].height = 30


def _write_rows(ws, columns, records, start_row=2, zebra=True):
    for ri, rec in enumerate(records):
        r = start_row + ri
        for ci, (_label, key, _w) in enumerate(columns, start=1):
            val = rec.get(key, "")
            cell = ws.cell(row=r, column=ci)
            if key == "profile_url" and val:
                cell.value = val
                cell.hyperlink = val
                cell.font = Font(color="0563C1", underline="single")
            elif key == "email" and val and rec.get("email_valid"):
                cell.value = val
                cell.hyperlink = "mailto:%s" % val
                cell.font = Font(color="0563C1", underline="single")
            elif isinstance(val, (date, datetime)):
                cell.value = val
                cell.number_format = "yyyy-mm-dd"
            else:
                cell.value = val
            cell.border = BOX
            cell.alignment = AR if key in ARABIC_FIELDS else (
                WRAP if isinstance(val, str) and len(str(val)) > 40 else TOP)
            if key == "bucket" and val in BUCKET_FILL:
                cell.fill = BUCKET_FILL[val]
                cell.alignment = Alignment(horizontal="center", vertical="center")
                cell.font = Font(bold=True)
            elif zebra and ri % 2 == 1:
                cell.fill = ZEBRA
    return start_row + len(records) - 1


def _finish_table(ws, columns, last_row, freeze="E2"):
    ws.freeze_panes = freeze
    ws.auto_filter.ref = "A1:%s%d" % (get_column_letter(len(columns)),
                                      max(last_row, 1))


def _kpi(ws, row, col, label, value, note=""):
    c = ws.cell(row=row, column=col, value=label)
    c.font = Font(color=SLATE, bold=True, size=10)
    v = ws.cell(row=row + 1, column=col, value=value)
    v.font = Font(color=NAVY, bold=True, size=20)
    if note:
        n = ws.cell(row=row + 2, column=col, value=note)
        n.font = Font(color="7F7F7F", size=9)


def _mini_table(ws, top_row, col, title, pairs, width=26):
    t = ws.cell(row=top_row, column=col, value=title)
    t.font = SUB_FONT
    h1 = ws.cell(row=top_row + 1, column=col, value="Value")
    h2 = ws.cell(row=top_row + 1, column=col + 1, value="Count")
    for h in (h1, h2):
        h.fill = HDR_FILL
        h.font = HDR_FONT
        h.border = BOX
    ws.column_dimensions[get_column_letter(col)].width = width
    ws.column_dimensions[get_column_letter(col + 1)].width = 9
    r = top_row + 2
    for name, count in pairs:
        a = ws.cell(row=r, column=col, value=name)
        b = ws.cell(row=r, column=col + 1, value=count)
        a.border = BOX
        b.border = BOX
        a.alignment = TOP
        r += 1
    return top_row + 1, r - 1   # header row, last data row


# --------------------------------------------------------------------------- #
# main entry
# --------------------------------------------------------------------------- #
def build_workbook(
    contacts: List[Dict],
    companies: List[Dict],
    quality: Dict,
    profile: Dict,
    out_path: str,
) -> str:
    wb = Workbook()

    _sheet_dashboard(wb.active, contacts, companies, quality, profile)

    shortlist = [c for c in contacts if c.get("bucket") in ("A",)]
    if not shortlist:
        shortlist = sorted(contacts, key=lambda c: -c.get("score", 0))[:50]
    ws_a = wb.create_sheet("Priority_A")
    _write_header(ws_a, CONNECTION_COLUMNS)
    last = _write_rows(ws_a, CONNECTION_COLUMNS, shortlist)
    _finish_table(ws_a, CONNECTION_COLUMNS, last)
    _add_tracking_validation(ws_a, len(shortlist))
    _highlight_contacted(ws_a, len(shortlist))

    ws_all = wb.create_sheet("Connections")
    _write_header(ws_all, CONNECTION_COLUMNS)
    last = _write_rows(ws_all, CONNECTION_COLUMNS, contacts)
    _finish_table(ws_all, CONNECTION_COLUMNS, last)
    _add_tracking_validation(ws_all, len(contacts))
    _highlight_contacted(ws_all, len(contacts))
    if contacts:
        ws_all.conditional_formatting.add(
            "C2:C%d" % (len(contacts) + 1),
            ColorScaleRule(start_type="num", start_value=0, start_color="FFFFFF",
                           mid_type="num", mid_value=50, mid_color="FFE699",
                           end_type="num", end_value=100, end_color="63BE7B"))

    ws_msg = wb.create_sheet("Messages")
    _write_header(ws_msg, MESSAGE_COLUMNS)
    last = _write_rows(ws_msg, MESSAGE_COLUMNS, contacts, zebra=False)
    _finish_table(ws_msg, MESSAGE_COLUMNS, last, freeze="D2")
    limit = int(((profile.get("messaging") or {}).get("note_char_limit")) or 200)
    len_cols = [get_column_letter(i) for i, (_l, k, _w)
                in enumerate(MESSAGE_COLUMNS, 1) if k.endswith("_len")]
    for col in len_cols:
        if contacts:
            ws_msg.conditional_formatting.add(
                "%s2:%s%d" % (col, col, len(contacts) + 1),
                CellIsRule(operator="greaterThan", formula=[str(limit)],
                           fill=PatternFill("solid", fgColor="FFC7CE"),
                           font=Font(color="9C0006", bold=True)))
    for r in range(2, len(contacts) + 2):
        ws_msg.row_dimensions[r].height = 118

    ws_co = wb.create_sheet("Companies")
    _write_header(ws_co, COMPANY_COLUMNS)
    last = _write_rows(ws_co, COMPANY_COLUMNS, companies)
    _finish_table(ws_co, COMPANY_COLUMNS, last, freeze="B2")

    _sheet_quality(wb.create_sheet("Data_Quality"), contacts, quality)
    _sheet_reference(wb.create_sheet("Reference"), profile)

    wb.save(out_path)
    return out_path


def _highlight_contacted(ws, n_rows: int):
    """Make "we have written to this person before" impossible to miss."""
    if n_rows <= 0:
        return
    col = get_column_letter(next(i for i, (_l, k, _w)
                                 in enumerate(CONNECTION_COLUMNS, 1)
                                 if k == "contacted_before_txt"))
    rng = "%s2:%s%d" % (col, col, n_rows + 1)
    ws.conditional_formatting.add(rng, CellIsRule(
        operator="equal", formula=['"Yes"'],
        fill=PatternFill("solid", fgColor="FFE699"),
        font=Font(color="7F6000", bold=True)))
    ws.conditional_formatting.add(rng, CellIsRule(
        operator="equal", formula=['"No - first contact"'],
        fill=PatternFill("solid", fgColor="D9EAD3"),
        font=Font(color="38761D", bold=True)))


def _add_tracking_validation(ws, n_rows: int):
    if n_rows <= 0:
        return
    status_col = next(i for i, (_l, k, _w) in enumerate(CONNECTION_COLUMNS, 1)
                      if k == "status")
    replied_col = next(i for i, (_l, k, _w) in enumerate(CONNECTION_COLUMNS, 1)
                       if k == "replied")
    dv_status = DataValidation(
        type="list",
        formula1='"Not started,Note sent,Message sent,Follow-up sent,Replied,Meeting booked,Referred,Closed - no fit"',
        allow_blank=True, showDropDown=False)
    dv_reply = DataValidation(type="list", formula1='"Yes,No,Pending"',
                              allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv_status)
    ws.add_data_validation(dv_reply)
    sc, rc = get_column_letter(status_col), get_column_letter(replied_col)
    dv_status.add("%s2:%s%d" % (sc, sc, n_rows + 1))
    dv_reply.add("%s2:%s%d" % (rc, rc, n_rows + 1))


# --------------------------------------------------------------------------- #
# dashboard
# --------------------------------------------------------------------------- #
def _sheet_dashboard(ws, contacts, companies, quality, profile):
    ws.title = "Dashboard"
    ws.sheet_view.showGridLines = False
    ws["A1"] = "LinkedIn Network Analysis"
    ws["A1"].font = TITLE_FONT
    me = (profile.get("me") or {}).get("full_name") or ""
    ws["A2"] = "Generated %s%s  |  source: official LinkedIn data export" % (
        date.today().isoformat(), ("  |  " + me) if me else "")
    ws["A2"].font = Font(color="7F7F7F", size=10)

    total = len(contacts)
    buckets = Counter(c.get("bucket") for c in contacts)
    recruiters = sum(1 for c in contacts if c.get("is_recruiter"))
    dms = sum(1 for c in contacts if c.get("is_decision_maker"))
    emails = sum(1 for c in contacts if c.get("email_valid"))
    with_company = sum(1 for c in contacts if c.get("company_clean"))

    # "cold" is wider than "never contacted": an invitation with no message
    # still leaves the introduction unsaid, so it belongs in the cold column.
    cold = sum(1 for c in contacts if c.get("mode") == "cold")
    awaiting = sum(1 for c in contacts if c.get("mode") == "nudge")
    spoke = sum(1 for c in contacts if c.get("contacted_before"))

    for i, (label, value, note) in enumerate([
        ("TOTAL CONNECTIONS", total, "rows parsed from the export"),
        ("PRIORITY A", buckets.get("A", 0), "message these first"),
        ("PRIORITY B", buckets.get("B", 0), "second wave"),
        ("NO MESSAGE YET", cold, "no DM exchanged - send the intro"),
        ("CONTACTED BEFORE", spoke, "a DM or invitation is on record"),
        ("AWAITING REPLY", awaiting, "you wrote, no answer yet"),
        ("RECRUITERS / HR", recruiters, "direct hiring channel"),
        ("DECISION MAKERS", dms, "manager level and above"),
        ("COMPANIES", len(companies), "distinct employers"),
        ("EMAILS ON FILE", emails, "reachable off-platform"),
        ("COMPANY KNOWN", with_company, "%d%% coverage" % (
            round(100 * with_company / total) if total else 0)),
    ]):
        _kpi(ws, 4, 1 + i * 2, label, value, note)
    for i in range(22):
        ws.column_dimensions[get_column_letter(1 + i)].width = 17

    def top(key, n=12):
        cnt = Counter((c.get(key) or "Unknown") for c in contacts)
        return cnt.most_common(n)

    h1, l1 = _mini_table(ws, 9, 1, "By Seniority", top("seniority"), 24)
    h2, l2 = _mini_table(ws, 9, 4, "By Function", top("function"), 26)
    h3, l3 = _mini_table(ws, 9, 7, "By Industry", top("industry"), 28)
    comp_pairs = [(c["company_clean"], c["count"]) for c in companies[:12]]
    _mini_table(ws, 9, 10, "Top Companies", comp_pairs, 30)
    years = Counter(
        c["connected_date"].year for c in contacts if c.get("connected_date"))
    _mini_table(ws, 9, 13, "Connected by Year",
                sorted(years.items(), reverse=True)[:12], 18)
    _mini_table(ws, 9, 16, "Contact Status", top("mode_label", 5), 26)

    if l1 > h1:
        ch = BarChart()
        ch.type = "bar"
        ch.title = "Seniority distribution"
        ch.height, ch.width = 9, 14
        ch.add_data(Reference(ws, min_col=2, min_row=h1, max_row=l1), titles_from_data=True)
        ch.set_categories(Reference(ws, min_col=1, min_row=h1 + 1, max_row=l1))
        ch.legend = None
        ws.add_chart(ch, "A26")
    if l2 > h2:
        ch2 = BarChart()
        ch2.type = "bar"
        ch2.title = "Function distribution"
        ch2.height, ch2.width = 9, 14
        ch2.add_data(Reference(ws, min_col=5, min_row=h2, max_row=l2), titles_from_data=True)
        ch2.set_categories(Reference(ws, min_col=4, min_row=h2 + 1, max_row=l2))
        ch2.legend = None
        ws.add_chart(ch2, "H26")
    if l3 > h3:
        pie = PieChart()
        pie.title = "Industry mix"
        pie.height, pie.width = 9, 13
        pie.add_data(Reference(ws, min_col=8, min_row=h3, max_row=l3), titles_from_data=True)
        pie.set_categories(Reference(ws, min_col=7, min_row=h3 + 1, max_row=l3))
        ws.add_chart(pie, "O26")

    ws["A45"] = "How to use this file"
    ws["A45"].font = SUB_FONT
    steps = [
        "1. Priority_A is your working list - it is already sorted best-first.",
        "2. Check the Contacted Before? column: green = never written to, amber = you have.",
        "3. Copy the matching message from the Messages sheet - it is already written for that mode (cold / reconnect / nudge).",
        "4. Log what you did in the Status / Date Sent / Replied columns on Connections.",
        "5. Companies shows the best entry point per employer - one contact per company is enough to start.",
        "6. Data_Quality lists every field the export did not provide, so nothing is silently assumed.",
        "7. Scores and labels are rule-based and fully explained on the Reference sheet - tune them in config/my_profile.json.",
    ]
    for i, s in enumerate(steps):
        ws.cell(row=46 + i, column=1, value=s).font = Font(size=10, color=SLATE)


# --------------------------------------------------------------------------- #
# data quality
# --------------------------------------------------------------------------- #
def _sheet_quality(ws, contacts, quality):
    ws.sheet_view.showGridLines = False
    ws["A1"] = "Data Quality & Provenance"
    ws["A1"].font = TITLE_FONT
    ws["A2"] = ("Everything below comes from the export itself. "
                "Fields LinkedIn does not provide are listed as gaps, never invented.")
    ws["A2"].font = Font(color="7F7F7F", size=10)

    rows = [
        ("Source file", quality.get("source_path", "")),
        ("Header detected", ", ".join(quality.get("header_found") or [])),
        ("Decoding / notes", "; ".join(quality.get("warnings") or [])),
        ("Rows in file (data)", quality.get("rows_in_file", 0)),
        ("Empty rows skipped", quality.get("skipped_rows", 0)),
        ("Duplicates merged", quality.get("duplicates_removed", 0)),
        ("Contacts in report", len(contacts)),
        ("Contact-history files found", ", ".join(quality.get("history_found") or [])
         or "none - history unknown"),
        ("Contact-history files missing", ", ".join(quality.get("history_missing") or [])
         or "none"),
        ("Account owner identified as", "%s (via %s)" % (
            quality.get("me_name") or "unknown",
            quality.get("identity_method") or "not determined")),
        ("Messages parsed", quality.get("messages_total", 0)),
        ("Invitations parsed", quality.get("invitations_total", 0)),
        ("Manual log entries", quality.get("log_total", 0)),
        ("History matched by profile URL",
         sum(1 for c in contacts if c.get("history_match") == "profile URL")),
        ("History matched by name only",
         sum(1 for c in contacts if c.get("history_match") == "name match")),
        ("Tracking carried over from previous report",
         quality.get("carried_over", 0)),
        ("Missing company", sum(1 for c in contacts if not c.get("company_clean"))),
        ("Missing position", sum(1 for c in contacts if not c.get("position_clean"))),
        ("Missing profile URL", sum(1 for c in contacts if not c.get("profile_url"))),
        ("Missing / invalid email", sum(1 for c in contacts if not c.get("email_valid"))),
        ("Unparsable connection date",
         sum(1 for c in contacts if not c.get("connected_date"))),
        ("Seniority unresolved",
         sum(1 for c in contacts if c.get("seniority") == "Unknown")),
        ("Function unresolved",
         sum(1 for c in contacts if c.get("function") == "Unknown")),
        ("Industry unresolved",
         sum(1 for c in contacts if c.get("industry") == "Unknown")),
    ]
    r = 4
    ws.column_dimensions["A"].width = 32
    ws.column_dimensions["B"].width = 90
    for label, value in rows:
        a = ws.cell(row=r, column=1, value=label)
        b = ws.cell(row=r, column=2, value=value)
        a.font = Font(bold=True, color=SLATE)
        a.border = BOX
        b.border = BOX
        b.alignment = WRAP
        r += 1

    r += 2
    ws.cell(row=r, column=1, value="Fields LinkedIn's export does NOT contain").font = SUB_FONT
    r += 1
    for note in [
        "City / country of the contact (only inferable when the public URL slug contains it)",
        "Phone numbers, number of followers, profile summary, skills or endorsements",
        "Employment history or tenure at the current company",
        "Whether the person is currently hiring",
        "Company size, website or sector (sector here is inferred from the company name)",
    ]:
        c = ws.cell(row=r, column=1, value="• " + note)
        c.font = Font(size=10)
        r += 1

    r += 1
    ws.cell(row=r, column=1,
            value=("Rows with issues (field = missing in the export):")).font = SUB_FONT
    r += 1
    hdr = ["Full Name", "Company", "Issues"]
    for i, h in enumerate(hdr, start=1):
        c = ws.cell(row=r, column=i, value=h)
        c.fill = HDR_FILL
        c.font = HDR_FONT
        c.border = BOX
    r += 1
    flagged = [c for c in contacts if c.get("issues_txt")]
    for c in flagged[:2000]:
        ws.cell(row=r, column=1, value=c.get("full_name")).border = BOX
        ws.cell(row=r, column=2, value=c.get("company_clean")).border = BOX
        ws.cell(row=r, column=3, value=c.get("issues_txt")).border = BOX
        r += 1


# --------------------------------------------------------------------------- #
# reference
# --------------------------------------------------------------------------- #
def _sheet_reference(ws, profile):
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 34
    ws.column_dimensions["B"].width = 104
    ws["A1"] = "How every label and score was produced"
    ws["A1"].font = TITLE_FONT

    targeting = profile.get("targeting") or {}
    blocks = [
        ("Source of truth",
         "LinkedIn Settings > Data Privacy > Get a copy of your data > Connections. "
         "This is LinkedIn's own export: names, profile URLs, company, position and "
         "connection date come straight from the platform, so no scraping and no "
         "guesswork is involved."),
        ("Seniority",
         "Rule-based reading of the job title, highest authority first "
         "(Founder/Owner > C-Level > VP > Director > Head > Manager > Team Lead > "
         "Senior IC > Consultant > Mid IC > Junior > Intern > Student). Known traps are "
         "handled: 'Product Manager' / 'Project Manager' / 'Account Manager' are treated "
         "as individual contributors, not people managers. The matched text is shown "
         "in the Classification Evidence column."),
        ("Function",
         "Scored keyword matching over the title in English and Arabic; the strongest "
         "match wins, so 'Senior Cloud Data Engineer' resolves to Data & AI rather than "
         "stopping at the first keyword."),
        ("Industry",
         "Derived from the employer name (keywords such as bank, telecom, hospital, "
         "ministry, logistics...). Anything the keywords cannot settle stays 'Unknown' "
         "instead of being invented. Override any company permanently in "
         "config/company_overrides.csv."),
        ("Priority score",
         "A transparent weighted sum: recruiter/HR, decision maker in a target function, "
         "seniority, target company, target industry, target function, email on file, how "
         "recently you connected, and how many contacts you already have at that company. "
         "Students and missing companies are penalised. Each contact's own breakdown is in "
         "the Score Breakdown column."),
        ("Buckets",
         "A >= %s, B >= %s, C >= %s, otherwise D. X means the company is on your exclusion "
         "list. Thresholds live in config/my_profile.json." % (
             (targeting.get("buckets") or {}).get("A", 65),
             (targeting.get("buckets") or {}).get("B", 45),
             (targeting.get("buckets") or {}).get("C", 25))),
        ("Have we written before?",
         "Read from the export's own messages.csv and Invitations.csv, matched to each "
         "contact by profile URL first and by normalised name second, plus your local "
         "data/outreach_log.csv for anything sent off-platform or after the export. "
         "Columns: Contacted Before?, Msgs I Sent, Msgs Received, They Ever Replied?, "
         "Last Contact, Days Since, Last Direction. If messages.csv is not in the "
         "export, that is stated rather than being reported as 'never contacted'."),
        ("Outreach mode",
         "Cold = no trace of previous contact, so the full introduction is used. "
         "Reconnect = you have spoken before, so the message picks the thread up "
         "instead of introducing you again. Nudge = you wrote and never got a reply, "
         "so only one short, soft follow-up is produced and the pitch is not repeated. "
         "The Outreach Advice column spells out the recommended next step per person."),
        ("Keeping your tracking",
         "Run with --previous <old workbook> and the Status / Date Sent / Replied / "
         "Next Step / Notes you filled in are carried into the new report, matched on "
         "profile URL - so re-running after a fresh export never loses your work."),
        ("Outreach archetype",
         "Decides which message template a person gets: Recruiter/HR, Hiring manager, "
         "Senior leader, Founder, Peer, Student/Academic, or General network."),
        ("Message tailoring",
         "Each message combines the archetype with an industry-specific angle, so a "
         "contact at a bank, at a telecom and at an NGO receive genuinely different "
         "openers. Connection notes are hard-capped at the LinkedIn note limit and the "
         "length is shown next to every note."),
        ("Duplicates",
         "Merged on the canonical profile URL slug first, then on normalised "
         "name + company. The surviving row is the one with the most complete data."),
        ("What is NOT in here",
         "Location, phone, follower counts, tenure and company size are not part of the "
         "export and are therefore absent rather than estimated. See the Data_Quality sheet."),
        ("Tuning it",
         "Edit config/my_profile.json (targets, weights, skills, CV link, signature) and "
         "re-run; the whole workbook including every message regenerates in seconds."),
    ]
    r = 3
    for head, body in blocks:
        a = ws.cell(row=r, column=1, value=head)
        a.font = Font(bold=True, color=NAVY, size=11)
        a.alignment = Alignment(vertical="top", wrap_text=True)
        a.fill = PatternFill("solid", fgColor=LIGHT)
        a.border = BOX
        b = ws.cell(row=r, column=2, value=body)
        b.alignment = WRAP
        b.border = BOX
        ws.row_dimensions[r].height = max(30, 14 * (len(body) // 95 + 1))
        r += 1
