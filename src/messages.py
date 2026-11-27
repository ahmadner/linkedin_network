# -*- coding: utf-8 -*-
"""
Per-contact outreach copy, generated deterministically (no model calls).

For every contact the generator picks an archetype from the classification
(recruiter, hiring manager, senior leader, founder, peer, academic, generic),
then injects an industry-specific angle so the message is clearly written for
the place that person works at - not a mail merge.

Produces four pieces per contact:
    note_ar / note_en      - connection-request note, hard-capped (200 chars)
    message_ar / message_en- full DM
    followup_ar / followup_en - one polite second touch
Everything is driven by config/my_profile.json.
"""
from __future__ import annotations

import re
from typing import Dict, Tuple

from classify import SENIORITY_RANK

# --------------------------------------------------------------------------- #
# industry angles: the "why I am writing to YOU, at THIS place" line
# --------------------------------------------------------------------------- #
INDUSTRY_ANGLE = {
    "Banking & Finance": (
        "الأنظمة البنكية والمالية بتفرض مستوى عالي من الدقة والأمان والأداء",
        "banking and fintech systems set a high bar for accuracy, security and performance",
    ),
    "Telecom": (
        "قطاع الاتصالات بتعامل مع أحجام بيانات ضخمة وأنظمة real-time",
        "telecom runs on huge data volumes and real-time systems",
    ),
    "Software & IT Services": (
        "بيئة الشركات التقنية وتسليم المنتجات لعملاء مختلفين",
        "product delivery across different clients in a software house",
    ),
    "Healthcare & Pharma": (
        "الأنظمة الصحية بتحتاج موثوقية عالية وحماية لبيانات المرضى",
        "healthcare systems demand high reliability and strict data protection",
    ),
    "Education": (
        "الأنظمة التعليمية والمنصات الرقمية وتأثيرها المباشر على الطلاب",
        "education platforms and the direct impact they have on students",
    ),
    "Government & Public Sector": (
        "مشاريع التحول الرقمي في القطاع العام وحجم المستخدمين الكبير",
        "public-sector digital transformation and its large user base",
    ),
    "NGO & International Orgs": (
        "العمل التنموي والإنساني والأثر الحقيقي للمشاريع على الأرض",
        "development and humanitarian work with measurable impact on the ground",
    ),
    "Consulting & Professional Services": (
        "العمل الاستشاري والتنقل بين قطاعات وعملاء مختلفين",
        "consulting work and the exposure it gives across sectors and clients",
    ),
    "E-commerce & Retail": (
        "التجارة الإلكترونية وتحديات الحجم في أوقات الذروة",
        "e-commerce and the scale challenges that come with peak traffic",
    ),
    "Manufacturing & Industrial": (
        "الأنظمة الصناعية وربط خطوط الإنتاج بالأنظمة الرقمية",
        "industrial systems and connecting production lines to digital tooling",
    ),
    "Construction & Real Estate": (
        "إدارة المشاريع الإنشائية وضبط الجداول والتكاليف",
        "construction project delivery and keeping schedule and cost under control",
    ),
    "Energy & Utilities": (
        "قطاع الطاقة والمرافق وأنظمة المراقبة والتحكم",
        "the energy and utilities sector with its monitoring and control systems",
    ),
    "Logistics & Transport": (
        "اللوجستيك والتتبع وتحسين سلاسل التوريد",
        "logistics, tracking and supply-chain optimisation",
    ),
    "Media & Entertainment": (
        "صناعة المحتوى والإعلام الرقمي وسرعة الإنتاج",
        "digital media and the pace content production demands",
    ),
    "Hospitality & Tourism": (
        "قطاع الضيافة والسياحة وتجربة العميل من أول لمسة",
        "hospitality and the customer experience from the first touchpoint",
    ),
    "Agriculture & Food": (
        "قطاع الأغذية والزراعة وسلاسل التوريد والجودة",
        "the food and agriculture sector, its supply chains and quality controls",
    ),
    "Freelance / Self-employed": (
        "العمل المستقل وبناء شغل خاص من الصفر",
        "independent work and building something from scratch",
    ),
    "Unknown": (
        "الشغل والخبرة الي بنيتها في مجالك",
        "the experience you have built in your field",
    ),
}

FUNCTION_ANGLE = {
    "Engineering & Software": ("تطوير البرمجيات", "software engineering"),
    "Data & AI": ("البيانات والذكاء الاصطناعي", "data and AI"),
    "DevOps & Cloud": ("الـ DevOps والكلاود", "DevOps and cloud"),
    "Security": ("الأمن السيبراني", "security"),
    "QA & Testing": ("اختبار البرمجيات والجودة", "QA and testing"),
    "Product": ("إدارة المنتج", "product management"),
    "Design & UX": ("التصميم وتجربة المستخدم", "design and UX"),
    "IT & Support": ("تقنية المعلومات والدعم", "IT and support"),
    "Sales & BD": ("المبيعات وتطوير الأعمال", "sales and business development"),
    "Marketing": ("التسويق", "marketing"),
    "Customer Success": ("خدمة ونجاح العملاء", "customer success"),
    "Finance & Accounting": ("المالية والمحاسبة", "finance and accounting"),
    "Operations & Supply Chain": ("العمليات وسلاسل التوريد", "operations and supply chain"),
    "Legal": ("المجال القانوني", "legal"),
    "Healthcare": ("القطاع الصحي", "healthcare"),
    "Education & Research": ("التعليم والبحث", "education and research"),
    "Civil & Architecture": ("الهندسة المدنية والمعمارية", "civil engineering and architecture"),
    "Project & Program Mgmt": ("إدارة المشاريع", "project management"),
    "Media & Content": ("الإعلام والمحتوى", "media and content"),
    "Consulting & Strategy": ("الاستشارات والاستراتيجية", "consulting and strategy"),
    "HR & Recruiting": ("الموارد البشرية والتوظيف", "HR and recruiting"),
    "Unknown": ("مجالك", "your field"),
}


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _clip(text: str, limit: int) -> str:
    """Hard cap on a word boundary - LinkedIn truncates silently otherwise."""
    t = re.sub(r"[ \t]+", " ", (text or "")).strip()
    if len(t) <= limit:
        return t
    cut = t[: limit - 1]
    if " " in cut:
        cut = cut[: cut.rfind(" ")]
    return cut.rstrip(" ,.،؛-") + "…"


def _tidy(text: str) -> str:
    t = re.sub(r"[ \t]{2,}", " ", text or "")
    t = re.sub(r"\n{3,}", "\n\n", t)
    t = re.sub(r"\s+([,.،؛!?])", r"\1", t)
    return t.strip()


def since_phrase(days, lang: str) -> str:
    """Human wording for 'how long since we last spoke'. Deliberately vague -
    'about a year ago' reads naturally, '383 days ago' reads like a database."""
    if days is None:
        return "قبل فترة" if lang == "ar" else "a while back"
    d = int(days)
    if d <= 14:
        return "قبل أيام" if lang == "ar" else "a few days ago"
    if d <= 45:
        return "قبل أسابيع" if lang == "ar" else "a few weeks ago"
    if d <= 75:
        return "قبل شهر تقريبًا" if lang == "ar" else "about a month ago"
    if d < 330:
        m = max(2, round(d / 30.0))
        if lang == "ar":
            # Arabic has a dual form: "شهرين", not "2 أشهر"
            return "قبل شهرين" if m == 2 else "قبل %d أشهر" % m
        return "about %d months ago" % m
    y = max(1, round(d / 365.25))
    if lang == "ar":
        if y == 1:
            return "قبل سنة تقريبًا"
        return "قبل سنتين تقريبًا" if y == 2 else "قبل %d سنوات" % y
    return "about a year ago" if y == 1 else "about %d years ago" % y


MODE_LABEL = {
    "cold": "Cold - first contact",
    "reconnect": "Reconnect - spoke before",
    "nudge": "Nudge - no reply yet",
}


def pick_archetype(*, is_recruiter_flag: bool, seniority: str, seniority_rank: int,
                   function: str, target_functions) -> str:
    tf = {str(f).strip().lower() for f in (target_functions or [])}
    in_target = (function or "").lower() in tf

    if is_recruiter_flag or function == "HR & Recruiting":
        return "recruiter"
    if seniority == "Founder / Owner":
        return "founder"
    if seniority in ("Student", "Intern / Trainee") or function == "Education & Research":
        return "academic"
    if in_target and seniority_rank >= SENIORITY_RANK["Manager"]:
        return "hiring_manager"
    if seniority_rank >= SENIORITY_RANK["Director"]:
        return "senior_leader"
    if in_target:
        return "peer"
    return "generic"


ARCHETYPE_LABEL = {
    "recruiter": "Recruiter / HR",
    "hiring_manager": "Hiring manager (target function)",
    "senior_leader": "Senior leader",
    "founder": "Founder / Owner",
    "peer": "Peer in my field",
    "academic": "Student / Academic",
    "generic": "General network",
}


# --------------------------------------------------------------------------- #
# generator
# --------------------------------------------------------------------------- #
class MessageBuilder:
    def __init__(self, profile: Dict):
        self.me = profile.get("me") or {}
        self.msg_cfg = profile.get("messaging") or {}
        self.targeting = profile.get("targeting") or {}
        self.note_limit = int(self.msg_cfg.get("note_char_limit") or 200)
        self.msg_limit = int(self.msg_cfg.get("message_char_limit") or 1600)
        self.goal = (self.targeting.get("goal") or "job_search").lower()

    # ---- fragments ------------------------------------------------------- #
    def _my_role(self, lang: str) -> str:
        role = (self.me.get("current_role") or "").strip()
        targets = self.me.get("target_roles") or []
        if not role and targets:
            role = str(targets[0])
        if role:
            return role
        return "مهتم بمجالك" if lang == "ar" else "working in a related field"

    def _years_phrase(self, lang: str) -> str:
        y = self.me.get("years_experience") or 0
        try:
            y = int(y)
        except (TypeError, ValueError):
            y = 0
        if y <= 0:
            return ""
        if lang == "ar":
            return " وعندي خبرة %d سنوات" % y if y > 2 else " وعندي خبرة %d سنة" % y
        return " with %d+ years of experience" % y

    def _skills(self, lang: str, n: int = 3) -> str:
        sk = [str(s).strip() for s in (self.me.get("top_skills") or []) if str(s).strip()]
        if not sk:
            return ""
        sk = sk[:n]
        if lang == "ar":
            return "، ".join(sk)
        return ", ".join(sk[:-1]) + " and " + sk[-1] if len(sk) > 1 else sk[0]

    def _highlight(self, lang: str) -> str:
        """Prefer the language-specific achievement line. A single `highlight`
        is only reused for the other language when its script matches, so an
        Arabic sentence never leaks into the English message."""
        specific = (self.me.get("highlight_%s" % lang) or "").strip()
        if specific:
            return specific
        generic = (self.me.get("highlight") or "").strip()
        if not generic:
            return ""
        has_arabic = bool(re.search(r"[؀-ۿ]", generic))
        if (lang == "ar") == has_arabic:
            return generic
        return ""

    def _cv_line(self, lang: str) -> str:
        cv = (self.me.get("cv_link") or "").strip()
        pf = (self.me.get("portfolio_link") or "").strip()
        bits = []
        if cv:
            bits.append(("سيرتي الذاتية: %s" if lang == "ar" else "CV: %s") % cv)
        if pf:
            bits.append(("أعمالي: %s" if lang == "ar" else "Portfolio: %s") % pf)
        return "\n".join(bits)

    def _signature(self, lang: str) -> str:
        sig = (self.msg_cfg.get("signature_ar") if lang == "ar"
               else self.msg_cfg.get("signature_en")) or ""
        sig = sig.strip()
        if sig:
            return sig
        return (self.me.get("first_name") or self.me.get("full_name") or "").strip()

    def _greeting(self, name: str, lang: str) -> str:
        if lang == "ar":
            return ("مرحبًا %s،" % name) if name else "مرحبًا،"
        return ("Hi %s," % name) if name else "Hello,"

    def _at_company(self, company: str, lang: str) -> str:
        if not company:
            return ""
        return (" في %s" % company) if lang == "ar" else " at %s" % company

    def _their_role_phrase(self, role: str, company: str, lang: str) -> str:
        if role and company:
            return ("دورك كـ %s في %s" % (role, company)) if lang == "ar" \
                else "your work as %s at %s" % (role, company)
        if role:
            return ("دورك كـ %s" % role) if lang == "ar" else "your work as %s" % role
        if company:
            return ("شغلك في %s" % company) if lang == "ar" else "your work at %s" % company
        return "شغلك" if lang == "ar" else "your work"

    def _ask(self, archetype: str, lang: str) -> str:
        if self.goal == "job_search":
            table = {
                "recruiter": (
                    "إذا في عندكم شاغر مناسب حاليًا أو مستقبلًا، بكون ممتن لو تاخذ سيرتي بعين الاعتبار.",
                    "If you have a suitable opening now or later, I would be grateful if you kept my CV in mind."),
                "hiring_manager": (
                    "إذا فريقك بيتوسع، بحب أعرف إذا في مجال نحكي عن دور مناسب.",
                    "If your team is growing, I would love to know whether there is room to talk about a fit."),
                "senior_leader": (
                    "بحب أضيفك لشبكتي وأتابع شغلكم، وإذا في فرصة مناسبة بكون سعيد أعرف عنها.",
                    "I would like to stay connected and follow your work, and I would be glad to hear of any suitable opportunity."),
                "founder": (
                    "إذا بتبنوا الفريق حاليًا، بحب أسمع عن الاحتياج وكيف أقدر أساعد.",
                    "If you are building the team right now, I would love to hear what you need and how I could help."),
                "peer": (
                    "بحب نبقى على تواصل ونتبادل الخبرات، وإذا سمعت عن فرصة مناسبة بكون ممتن لو تدلني.",
                    "Happy to stay in touch and swap notes, and grateful for any pointer to a suitable opening."),
                "academic": (
                    "بحب نبقى على تواصل ونتعاون إذا طرأ شي مشترك.",
                    "Happy to stay connected and collaborate if something overlaps."),
                "generic": (
                    "بحب نبقى على تواصل، وإذا في شي أقدر أساعد فيه خبرني.",
                    "Happy to stay connected - and let me know if there is anything I can help with."),
            }
        else:
            table = {k: ("بحب نبقى على تواصل ونشوف إذا في مجال نتعاون فيه.",
                         "I would like to stay connected and explore whether there is room to collaborate.")
                     for k in ARCHETYPE_LABEL}
        ar, en = table.get(archetype, table["generic"])
        return ar if lang == "ar" else en

    # ---- public ---------------------------------------------------------- #
    def build(self, *, greeting_name: str, their_role: str, company: str,
              industry: str, function: str, archetype: str,
              mode: str = "cold", days_since=None) -> Dict[str, str]:
        out: Dict[str, str] = {}
        for lang in ("ar", "en"):
            if mode == "nudge":
                out["note_%s" % lang] = self._nudge_short(lang, greeting_name, days_since)
                out["message_%s" % lang] = self._nudge(lang, greeting_name, days_since)
            elif mode == "reconnect":
                out["note_%s" % lang] = self._reconnect_short(
                    lang, greeting_name, their_role, company, days_since)
                out["message_%s" % lang] = self._reconnect(
                    lang, greeting_name, their_role, company, industry,
                    function, archetype, days_since)
            else:
                out["note_%s" % lang] = self._note(
                    lang, greeting_name, their_role, company, archetype)
                out["message_%s" % lang] = self._message(
                    lang, greeting_name, their_role, company, industry,
                    function, archetype)
            out["followup_%s" % lang] = self._followup(lang, greeting_name, company)
        out["archetype"] = archetype
        out["archetype_label"] = ARCHETYPE_LABEL.get(archetype, archetype)
        out["mode"] = mode
        out["mode_label"] = MODE_LABEL.get(mode, mode)
        return out

    # ---- previously contacted: pick the thread up ------------------------ #
    def _reconnect(self, lang, name, their_role, company, industry, function,
                   archetype, days_since) -> str:
        g = self._greeting(name, lang)
        since = since_phrase(days_since, lang)
        role_phrase = self._their_role_phrase(their_role, company, lang)
        ask = self._ask(archetype, lang)
        cv = self._cv_line(lang)
        sig = self._signature(lang)
        highlight = self._highlight(lang)
        my_role = self._my_role(lang)

        if lang == "ar":
            body = [g, "",
                    "آخر تواصل بينا كان %s، وحبيت أرجع أطل عليك." % since,
                    "", "شفت إن %s، وبشكل جدي بتابع شغلكم." % role_phrase,
                    "", "من جهتي، أنا هلأ %s%s." % (my_role, self._years_phrase(lang))]
            if highlight:
                body.append(highlight if highlight.endswith((".", "!", "؟")) else highlight + ".")
            body += ["", ask]
            if cv:
                body += ["", cv]
            body += ["", "شكرًا لوقتك،", sig or ""]
        else:
            body = [g, "",
                    "We last spoke %s, so I wanted to reconnect." % since,
                    "", "I saw %s and I follow your work with real interest." % role_phrase,
                    "", "On my side, I am now %s%s." % (my_role, self._years_phrase(lang))]
            if highlight:
                body.append(highlight if highlight.endswith((".", "!", "?")) else highlight + ".")
            body += ["", ask]
            if cv:
                body += ["", cv]
            body += ["", "Thanks for your time,", sig or ""]
        return _clip(_tidy("\n".join(body)), self.msg_limit)

    def _reconnect_short(self, lang, name, their_role, company, days_since) -> str:
        g = self._greeting(name, lang)
        since = since_phrase(days_since, lang)
        at_co = self._at_company(company, lang)
        if lang == "ar":
            core = ("آخر تواصل بينا كان %s - حبيت أطل عليك وأشوف كيف ماشي "
                    "الشغل%s." % (since, at_co))
        else:
            core = ("We last spoke %s - just checking in to see how things are "
                    "going%s." % (since, at_co))
        return _clip("%s %s" % (g, core), self.note_limit)

    # ---- written to before, no answer: one soft nudge only --------------- #
    def _nudge(self, lang, name, days_since) -> str:
        g = self._greeting(name, lang)
        since = since_phrase(days_since, lang)
        sig = self._signature(lang)
        if lang == "ar":
            body = [g, "",
                    "كنت بعتتلك رسالة %s وما بعرف إذا وصلتك وسط الزحمة." % since,
                    "",
                    "إذا الوقت مش مناسب بتفهم تمامًا وما بدي أثقل عليك. "
                    "وإذا في مجال، رد بسطر واحد بكفي.",
                    "", "شكرًا على أي حال،", sig or ""]
        else:
            body = [g, "",
                    "I sent you a message %s and I am not sure it reached you." % since,
                    "",
                    "If the timing is not right I completely understand and will not "
                    "keep pushing. If there is room, even a one-line reply is plenty.",
                    "", "Thanks either way,", sig or ""]
        return _clip(_tidy("\n".join(body)), self.msg_limit)

    def _nudge_short(self, lang, name, days_since) -> str:
        g = self._greeting(name, lang)
        since = since_phrase(days_since, lang)
        if lang == "ar":
            core = ("بس برجع أذكّرك برسالتي %s - إذا الوقت مش مناسب بتفهم "
                    "تمامًا." % since)
        else:
            core = ("Just following up on my message from %s - if the timing is "
                    "off, no problem at all." % since)
        return _clip("%s %s" % (g, core), self.note_limit)

    def _note(self, lang, name, their_role, company, archetype) -> str:
        g = self._greeting(name, lang)
        my_role = self._my_role(lang)
        at_co = self._at_company(company, lang)
        if lang == "ar":
            core = {
                "recruiter": "أنا %s وبتابع الشواغر%s. حبيت أتواصل معك ويكون اسمي بين يديك." % (my_role, at_co),
                "hiring_manager": "أنا %s ومهتم بشغل فريقك%s. حبيت أضيفك لشبكتي." % (my_role, at_co),
                "senior_leader": "أنا %s ومتابع لشغلكم%s. بشرف لي أضيفك لشبكتي." % (my_role, at_co),
                "founder": "أنا %s ومعجب بالي بتبنوه%s. حبيت أتواصل معك." % (my_role, at_co),
                "peer": "أنا %s وشغلك قريب من مجالي. حبيت نبقى على تواصل." % my_role,
                "academic": "أنا %s ومهتم بالمجال الي بتشتغل فيه. حبيت نبقى على تواصل." % my_role,
                "generic": "أنا %s وحبيت أضيفك لشبكتي المهنية%s." % (my_role, at_co),
            }[archetype]
        else:
            core = {
                "recruiter": "I am %s, currently exploring openings%s - would like to connect and be on your radar." % (my_role, at_co),
                "hiring_manager": "I am %s and I follow the work your team does%s. Would be glad to connect." % (my_role, at_co),
                "senior_leader": "I am %s and have been following your work%s. It would be a pleasure to connect." % (my_role, at_co),
                "founder": "I am %s and I like what you are building%s. Would love to connect." % (my_role, at_co),
                "peer": "I am %s - your work is close to my field, so I would like to stay connected." % my_role,
                "academic": "I am %s and interested in the field you work in. Would like to stay connected." % my_role,
                "generic": "I am %s and would like to add you to my professional network%s." % (my_role, at_co),
            }[archetype]
        return _clip("%s %s" % (g, core), self.note_limit)

    def _message(self, lang, name, their_role, company, industry, function,
                 archetype) -> str:
        g = self._greeting(name, lang)
        role_phrase = self._their_role_phrase(their_role, company, lang)
        ind_ar, ind_en = INDUSTRY_ANGLE.get(industry, INDUSTRY_ANGLE["Unknown"])
        fn_ar, fn_en = FUNCTION_ANGLE.get(function, FUNCTION_ANGLE["Unknown"])
        angle = ind_ar if lang == "ar" else ind_en
        fn = fn_ar if lang == "ar" else fn_en
        my_role = self._my_role(lang)
        years = self._years_phrase(lang)
        skills = self._skills(lang)
        highlight = self._highlight(lang)
        ask = self._ask(archetype, lang)
        cv = self._cv_line(lang)
        sig = self._signature(lang)

        if lang == "ar":
            opener = {
                "recruiter": "لاحظت %s، والتوظيف في مجال %s تحديدًا الي بدور عليه." % (role_phrase, fn),
                "hiring_manager": "تابعت %s، و%s." % (role_phrase, angle),
                "senior_leader": "تابعت %s، و%s." % (role_phrase, angle),
                "founder": "شدني %s، و%s." % (role_phrase, angle),
                "peer": "شفت %s، واشتغالنا في نفس المجال (%s) خلاني أحب أتواصل معك." % (role_phrase, fn),
                "academic": "شفت %s، والمجال مشترك بيننا." % role_phrase,
                "generic": "شفت %s، و%s." % (role_phrase, angle),
            }[archetype]
            about = "أنا %s%s" % (my_role, years)
            if skills:
                about += "، وأقرب مهاراتي: %s" % skills
            about += "."
            body = [g, "", opener, "", about]
            if highlight:
                body.append(highlight if highlight.endswith((".", "!", "؟")) else highlight + ".")
            body += ["", ask]
            if cv:
                body += ["", cv]
            body += ["", "شكرًا لوقتك،", sig or ""]
        else:
            opener = {
                "recruiter": "I came across %s, and %s is exactly the space I am targeting." % (role_phrase, fn),
                "hiring_manager": "I have been following %s - %s." % (role_phrase, angle),
                "senior_leader": "I have been following %s - %s." % (role_phrase, angle),
                "founder": "%s caught my attention - %s." % (role_phrase.capitalize(), angle),
                "peer": "I saw %s, and since we both work in %s I wanted to reach out." % (role_phrase, fn),
                "academic": "I saw %s and we share the same field of interest." % role_phrase,
                "generic": "I saw %s - %s." % (role_phrase, angle),
            }[archetype]
            about = "I am %s%s" % (my_role, years)
            if skills:
                about += ", and my strongest skills are %s" % skills
            about += "."
            body = [g, "", opener, "", about]
            if highlight:
                body.append(highlight if highlight.endswith((".", "!", "?")) else highlight + ".")
            body += ["", ask]
            if cv:
                body += ["", cv]
            body += ["", "Thanks for your time,", sig or ""]

        return _clip(_tidy("\n".join(body)), self.msg_limit)

    def _followup(self, lang, name, company) -> str:
        g = self._greeting(name, lang)
        if lang == "ar":
            txt = ("%s\n\nبس بذكرك برسالتي السابقة - بتفهم إذا الوقت مش مناسب. "
                   "إذا في أي شي أقدر أساعد فيه من طرفي، أنا جاهز. شكرًا!" % g)
        else:
            txt = ("%s\n\nJust a gentle nudge on my earlier message - I completely "
                   "understand if the timing is off. If there is anything I can help "
                   "with on my side, happy to. Thank you!" % g)
        return _tidy(txt)


def validate_profile(profile: Dict) -> Tuple[bool, list]:
    """Report which profile fields are still empty. Messages are generated
    either way, but the gaps are surfaced loudly rather than hidden."""
    me = profile.get("me") or {}
    required = {
        "full_name": "your name",
        "current_role": "your current/target role",
        "top_skills": "top skills",
    }
    recommended = {
        "years_experience": "years of experience",
        "highlight_ar": "one-line achievement (Arabic)",
        "highlight_en": "one-line achievement (English)",
        "cv_link": "CV link",
        "target_roles": "target roles",
    }
    missing = []
    for key, label in required.items():
        if not me.get(key):
            missing.append("REQUIRED: %s (me.%s)" % (label, key))
    for key, label in recommended.items():
        if not me.get(key):
            missing.append("recommended: %s (me.%s)" % (label, key))
    ok = not any(m.startswith("REQUIRED") for m in missing)
    return ok, missing
