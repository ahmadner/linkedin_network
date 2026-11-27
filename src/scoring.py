# -*- coding: utf-8 -*-
"""
Priority scoring: who is worth a message first, and why.

The score is a transparent sum of weighted signals read from
config/my_profile.json. Every contact carries a human-readable breakdown
("recruiter +28, target industry +12, recent connection +6") so the ranking
can be audited and tuned instead of trusted blindly.
"""
from __future__ import annotations

from datetime import date
from typing import Dict, List, Tuple

from classify import SENIORITY_RANK, is_decision_maker

DEFAULT_WEIGHTS: Dict[str, float] = {
    "recruiter": 28,
    "hiring_manager_in_target_function": 26,
    "decision_maker_max": 18,
    "target_company": 20,
    "target_industry": 12,
    "target_function": 14,
    "same_function_peer": 8,
    "email_available": 6,
    "recency_max": 8,
    "multi_contact_company": 4,
    "penalty_student": -6,
    "penalty_no_company": -4,
    # contact history: someone you already wrote to and who never answered is
    # not a better next move than someone you have never approached.
    "penalty_awaiting_reply": -12,
    "penalty_contacted_recently": -8,
}

DEFAULT_BUCKETS = {"A": 65, "B": 45, "C": 25}


def _norm_set(values) -> set:
    return {str(v).strip().lower() for v in (values or []) if str(v).strip()}


def score_contact(
    *,
    seniority: str,
    seniority_rank: int,
    function: str,
    industry: str,
    company_key: str,
    company_clean: str,
    email_valid: bool,
    connected_date,
    company_contact_count: int,
    is_recruiter_flag: bool,
    targeting: Dict,
    today: date = None,
    outreach_mode: str = "cold",
    days_since_contact=None,
) -> Tuple[int, str, str]:
    """Return (score 0-100, bucket letter, breakdown text)."""
    today = today or date.today()
    w = dict(DEFAULT_WEIGHTS)
    w.update(targeting.get("weights") or {})
    buckets = dict(DEFAULT_BUCKETS)
    buckets.update(targeting.get("buckets") or {})

    target_functions = _norm_set(targeting.get("target_functions"))
    target_industries = _norm_set(targeting.get("target_industries"))
    target_companies = _norm_set(targeting.get("target_companies"))
    excluded_companies = _norm_set(targeting.get("excluded_companies"))

    parts: List[str] = []
    total = 0.0

    ck = (company_key or "").lower()
    cc = (company_clean or "").strip().lower()
    if ck and (ck in excluded_companies or cc in excluded_companies):
        return 0, "X", "excluded company"

    if is_recruiter_flag:
        total += w["recruiter"]
        parts.append("recruiter/HR +%g" % w["recruiter"])

    in_target_function = (function or "").lower() in target_functions
    if in_target_function and is_decision_maker(seniority_rank):
        total += w["hiring_manager_in_target_function"]
        parts.append("decision maker in target function +%g"
                     % w["hiring_manager_in_target_function"])

    if seniority_rank > 0:
        authority = (seniority_rank / 95.0) * w["decision_maker_max"]
        total += authority
        parts.append("seniority %s +%.1f" % (seniority, authority))

    if ck and (ck in target_companies or cc in target_companies):
        total += w["target_company"]
        parts.append("target company +%g" % w["target_company"])

    if (industry or "").lower() in target_industries:
        total += w["target_industry"]
        parts.append("target industry +%g" % w["target_industry"])

    if in_target_function:
        total += w["target_function"]
        parts.append("target function +%g" % w["target_function"])
    elif (function or "").lower() in target_functions:
        total += w["same_function_peer"]
        parts.append("adjacent function +%g" % w["same_function_peer"])

    if email_valid:
        total += w["email_available"]
        parts.append("email on file +%g" % w["email_available"])

    if connected_date:
        years = max(0.0, (today - connected_date).days / 365.25)
        recency = max(0.0, w["recency_max"] * (1.0 - min(years, 5.0) / 5.0))
        if recency >= 0.5:
            total += recency
            parts.append("connected %.1fy ago +%.1f" % (years, recency))

    if company_contact_count >= 3:
        total += w["multi_contact_company"]
        parts.append("%d contacts at this company +%g"
                     % (company_contact_count, w["multi_contact_company"]))

    if outreach_mode == "nudge":
        total += w["penalty_awaiting_reply"]
        parts.append("written to, no reply %g" % w["penalty_awaiting_reply"])
    if days_since_contact is not None and days_since_contact <= 30:
        total += w["penalty_contacted_recently"]
        parts.append("contacted %d days ago %g"
                     % (days_since_contact, w["penalty_contacted_recently"]))

    if seniority in ("Student", "Intern / Trainee"):
        total += w["penalty_student"]
        parts.append("student/intern %g" % w["penalty_student"])
    if not company_clean:
        total += w["penalty_no_company"]
        parts.append("no company %g" % w["penalty_no_company"])

    score = int(round(max(0.0, min(100.0, total))))
    if score >= buckets["A"]:
        bucket = "A"
    elif score >= buckets["B"]:
        bucket = "B"
    elif score >= buckets["C"]:
        bucket = "C"
    else:
        bucket = "D"
    return score, bucket, "; ".join(parts) if parts else "no positive signals"
