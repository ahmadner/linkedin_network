# -*- coding: utf-8 -*-
"""
Deterministic classification of job titles and companies.

Three independent axes, each returning a label plus the evidence that produced
it, so nothing in the final Excel is an unexplained guess:

  seniority  -> authority level (Founder ... Intern), with a numeric rank
  function   -> department / discipline (Engineering, Data & AI, HR ...)
  industry   -> sector of the employer (keyword + override file)

Both English and Arabic titles are matched. Ordering matters: the first rule
that fires wins, and known traps ("Product Manager" is not a people manager)
are handled before the generic rules.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple

# --------------------------------------------------------------------------- #
# seniority
# --------------------------------------------------------------------------- #
SENIORITY_ORDER = [
    "Founder / Owner",
    "C-Level",
    "VP",
    "Director",
    "Head",
    "Manager",
    "Team Lead",
    "Senior IC",
    "Mid IC",
    "Junior",
    "Intern / Trainee",
    "Student",
    "Consultant / Freelancer",
    "Unknown",
]

SENIORITY_RANK = {
    "Founder / Owner": 95,
    "C-Level": 90,
    "VP": 80,
    "Director": 70,
    "Head": 65,
    "Manager": 55,
    "Team Lead": 45,
    "Senior IC": 35,
    "Consultant / Freelancer": 30,
    "Mid IC": 25,
    "Junior": 15,
    "Intern / Trainee": 8,
    "Student": 5,
    "Unknown": 0,
}

# titles where the word "manager" / "lead" does NOT imply people authority
_MANAGER_TRAPS = re.compile(
    r"\b(product|project|program|programme|account|community|brand|social"
    r"|content|campaign|category|portfolio|contract|facility|facilities"
    r"|office|store|branch|case|property|partner|channel|category)\s+"
    r"(manager|managers|lead|owner)\b",
    re.IGNORECASE,
)

_SENIORITY_RULES: List[Tuple[str, str]] = [
    ("Founder / Owner",
     r"\b(founder|co[\s\-]?founder|cofounder|owner|co[\s\-]?owner|proprietor"
     r"|entrepreneur|managing\s+partner|business\s+owner)\b"
     r"|مؤسس|شريك\s*مؤسس|صاحب\s*(?:شركة|عمل)"),
    ("C-Level",
     r"\b(c[\.\s]?e[\.\s]?o|c[\.\s]?t[\.\s]?o|c[\.\s]?f[\.\s]?o"
     r"|c[\.\s]?o[\.\s]?o|c[\.\s]?i[\.\s]?o|c[\.\s]?m[\.\s]?o"
     r"|c[\.\s]?p[\.\s]?o|c[\.\s]?h[\.\s]?r[\.\s]?o|c[\.\s]?d[\.\s]?o"
     r"|c[\.\s]?s[\.\s]?o|c[\.\s]?i[\.\s]?s[\.\s]?o)\b"
     r"|\bchief\s+[a-z]+\s+officer\b|\bchief\s+of\s+staff\b"
     r"|\b(president|managing\s+director|general\s+manager|board\s+member"
     r"|chairman|chairperson|vice\s+chancellor)\b"
     r"|مدير\s*عام|الرئيس\s*التنفيذي|نائب\s*الرئيس\s*التنفيذي"),
    ("VP",
     r"\b(vp|v\.p|svp|evp|avp|vice[\s\-]president|deputy\s+director)\b"
     r"|نائب\s*(?:الرئيس|المدير)"),
    ("Director",
     r"\b(director|directeur|associate\s+director|senior\s+director"
     r"|executive\s+director|dean|principal\s+(?:engineer|architect|scientist"
     r"|consultant))\b|مدير\s*(?:تنفيذي|إدارة|دائرة)"),
    ("Head",
     r"\b(head\s+of|head,|global\s+head|group\s+head|department\s+head"
     r"|chef\s+de|superintendent)\b|\bhead$|رئيس\s*(?:قسم|دائرة|وحدة|فريق)"),
    ("Manager",
     r"\b(manager|mgr|engineering\s+manager|development\s+manager"
     r"|senior\s+manager|group\s+manager|people\s+manager|unit\s+manager"
     r"|regional\s+manager|country\s+manager|supervisor|foreman)\b"
     r"|مدير|مشرف"),
    ("Team Lead",
     r"\b(team\s+lead|tech\s+lead|technical\s+lead|squad\s+lead|crew\s+lead"
     r"|lead\s+(?:engineer|developer|designer|analyst|architect|scientist"
     r"|consultant|specialist)|teamlead|tl)\b|\blead$|قائد\s*فريق"),
    ("Senior IC",
     r"\b(senior|sr\.?|snr|staff|principal|expert|specialist\s+iii"
     r"|iii|iv)\b|أول|خبير|كبير"),
    ("Intern / Trainee",
     r"\b(intern|internship|trainee|apprentice|co[\s\-]?op|placement"
     r"|summer\s+(?:intern|analyst))\b|متدرب"),
    ("Student",
     r"\b(student|undergraduate|undergrad|bachelor|master'?s?\s+student"
     r"|phd\s+(?:student|candidate)|fresh\s+graduate|graduate\s+student"
     r"|new\s+grad|seeking\s+opportunit)\b|طالب|حديث\s*التخرج"),
    ("Junior",
     r"\b(junior|jr\.?|entry[\s\-]level|associate\s+(?:engineer|developer"
     r"|analyst|consultant)|graduate\s+(?:engineer|developer|trainee))\b"
     r"|مبتدئ|مساعد"),
    ("Consultant / Freelancer",
     r"\b(freelance|freelancer|consultant|contractor|advisor|adviser"
     r"|self[\s\-]employed|independent)\b|مستقل|مستشار"),
]

_SENIORITY_COMPILED = [(lbl, re.compile(pat, re.IGNORECASE | re.UNICODE))
                       for lbl, pat in _SENIORITY_RULES]

_IC_FALLBACK = re.compile(
    r"\b(engineer|developer|programmer|designer|analyst|scientist|architect"
    r"|administrator|technician|accountant|nurse|doctor|physician|pharmacist"
    r"|teacher|lecturer|researcher|officer|associate|executive|agent"
    r"|representative|coordinator|specialist|consultant|auditor|editor"
    r"|writer|translator|recruiter|tester|qa|operator|assistant)\b"
    r"|مهندس|مطور|محاسب|مصمم|محلل|معلم|باحث|ممرض|طبيب|صيدلاني|موظف|أخصائي",
    re.IGNORECASE | re.UNICODE,
)


def classify_seniority(title: str) -> Tuple[str, int, str]:
    """Return (label, rank, evidence)."""
    t = (title or "").strip()
    if not t:
        return "Unknown", 0, "empty title"

    trap = _MANAGER_TRAPS.search(t)
    senior_prefix = re.search(r"\b(senior|sr\.?|lead|head|principal|staff)\b",
                              t, re.IGNORECASE)
    hard_authority = re.search(
        r"\b(founder|owner|chief|c[\.\s]?e[\.\s]?o|c[\.\s]?t[\.\s]?o|vp"
        r"|vice[\s\-]president|director|head\s+of)\b", t, re.IGNORECASE)

    if trap and not hard_authority:
        label = "Senior IC" if senior_prefix else "Mid IC"
        return label, SENIORITY_RANK[label], "title-trap: %s" % trap.group(0)

    for label, rx in _SENIORITY_COMPILED:
        m = rx.search(t)
        if m:
            return label, SENIORITY_RANK[label], "matched: %s" % m.group(0)

    if _IC_FALLBACK.search(t):
        return "Mid IC", SENIORITY_RANK["Mid IC"], "individual-contributor title"
    return "Unknown", 0, "no rule matched"


# --------------------------------------------------------------------------- #
# function / department
# --------------------------------------------------------------------------- #
_FUNCTION_RULES: List[Tuple[str, str, int]] = [
    ("HR & Recruiting",
     r"\b(recruit\w*|talent\s+(?:acquisition|partner|sourc\w*)|sourcer"
     r"|headhunt\w*|hr\b|human\s+resources?|people\s+(?:ops|operations"
     r"|partner|team)|hrbp|chro|compensation|benefits|l&d|learning\s+and"
     r"\s+development|employer\s+brand|hiring)\b"
     r"|موارد\s*بشرية|توظيف", 3),
    ("Data & AI",
     r"\b(data\s+(?:scientist|science|engineer|analyst|analytics|architect"
     r"|platform)|machine\s+learning|ml\s+engineer|mlops|deep\s+learning"
     r"|ai\b|artificial\s+intelligence|nlp|computer\s+vision|llm"
     r"|business\s+intelligence|bi\s+(?:developer|analyst)|big\s+data"
     r"|etl|data\s+warehouse|analytics\s+engineer|information\s+management)\b"
     r"|علم\s*البيانات|ذكاء\s*اصطناعي", 3),
    ("DevOps & Cloud",
     r"\b(devops|sre|site\s+reliability|platform\s+engineer|cloud\s+(?:engineer"
     r"|architect|consultant)|infrastructure|kubernetes|terraform|aws\s+"
     r"(?:engineer|architect)|azure\s+(?:engineer|architect)|systems?\s+"
     r"engineer|network\s+engineer|sysadmin|system\s+administrator)\b"
     r"|بنية\s*تحتية", 3),
    ("Security",
     r"\b(security|cyber\s*security|infosec|appsec|soc\s+analyst|pentest\w*"
     r"|penetration\s+test\w*|ciso|grc|iam\b|threat|vulnerability"
     r"|ethical\s+hacker|red\s+team|blue\s+team)\b|أمن\s*(?:سيبراني|معلومات)", 3),
    ("QA & Testing",
     r"\b(qa\b|quality\s+assurance|test\s+(?:engineer|automation|analyst|lead)"
     r"|sdet|tester|testing|quality\s+(?:engineer|control|inspector))\b"
     r"|جودة|اختبار", 3),
    ("Engineering & Software",
     r"\b(software|developer|engineer(?:ing|s)?|programmer|full[\s\-]?stack|backend"
     r"|back[\s\-]end|frontend|front[\s\-]end|web\s+developer|mobile"
     r"|android|ios|flutter|react|angular|vue|node|java|python|\.net|dotnet"
     r"|php|laravel|golang|rust|c\+\+|c#|embedded|firmware|technical\s+lead"
     r"|architect|cto|r&d)\b|مهندس\s*(?:برمجيات|حاسوب)|مطور|برمجة", 2),
    ("Product",
     r"\b(product\s+(?:manager|owner|lead|director|designer|analyst)|cpo"
     r"|product\s+management|po\b|scrum\s+master|agile\s+coach"
     r"|business\s+analyst|ba\b|product\s+marketing)\b|مدير\s*منتج", 3),
    ("Design & UX",
     r"\b(ux|ui\b|ui/ux|user\s+(?:experience|interface|research)"
     r"|product\s+design\w*"
     r"|product\s+designer|graphic\s+design\w*|visual\s+design\w*"
     r"|interaction\s+design\w*|motion\s+design\w*|art\s+director"
     r"|creative\s+director|illustrator|brand\s+design\w*)\b"
     r"|تصميم|مصمم", 3),
    ("IT & Support",
     r"\b(it\s+(?:support|specialist|manager|administrator|technician|officer"
     r"|consultant|director|head|lead|operations|infrastructure|analyst)"
     r"|\bcio\b|help\s*desk|service\s+desk|technical\s+support"
     r"|desktop\s+support|erp|sap\s+(?:consultant|basis)|odoo|dynamics"
     r"|information\s+technology)\b|دعم\s*فني|تقنية\s*المعلومات", 2),
    ("Sales & BD",
     r"\b(sales|account\s+(?:executive|manager|director)|business\s+development"
     r"|bd\b|bdm|pre[\s\-]?sales|solution\s+(?:consultant|engineer)"
     r"|key\s+account|channel|partnership|revenue|cro\b|territory)\b"
     r"|مبيعات|تطوير\s*أعمال", 3),
    ("Marketing",
     r"\b(marketing|seo|sem|ppc|growth|digital\s+marketing|content\s+"
     r"(?:marketing|creator|writer)|social\s+media|brand\s+(?:manager"
     r"|strategist)|campaign|communications?|pr\b|public\s+relations"
     r"|copywriter|media\s+buyer|cmo)\b|تسويق|علاقات\s*عامة", 3),
    ("Customer Success",
     r"\b(customer\s+(?:success|support|service|experience|care)|client\s+"
     r"(?:success|services|relations)|account\s+support|csm\b|call\s+cent"
     r"|technical\s+account\s+manager)\b|خدمة\s*(?:العملاء|عملاء)", 3),
    ("Finance & Accounting",
     r"\b(finance|financial|accountant|accounting|audit\w*|controller"
     r"|treasury|tax|cfo|bookkeep\w*|credit\s+analyst|investment"
     r"|banking|actuar\w*|payroll|fp&a)\b|محاسب|مالية|تدقيق|مصرفي", 3),
    ("Operations & Supply Chain",
     r"\b(operations?|ops\s+manager|supply\s+chain|logistics|procurement"
     r"|purchasing|warehouse|inventory|planning\s+engineer|production"
     r"|manufacturing|plant|lean|six\s+sigma|facility|fleet|shipping"
     r"|import|export|customs)\b|عمليات|لوجستي|مشتريات|مستودع", 2),
    ("Legal",
     r"\b(legal|lawyer|attorney|advocate|counsel|paralegal|compliance"
     r"|contracts?\s+(?:manager|specialist)|notary|judge)\b"
     r"|قانون\w*|محام|مستشار\s*قانوني", 3),
    ("Healthcare",
     r"\b(doctor|physician|surgeon|dentist|nurse|nursing|pharmacist"
     r"|pharmacy|medical|clinical|radiolog\w*|lab\s+technician|therapist"
     r"|dietitian|midwife|paramedic|veterinar\w*|md\b)\b"
     r"|طبيب|ممرض|صيدلاني|طبي", 3),
    ("Education & Research",
     r"\b(teacher|lecturer|professor|instructor|tutor|academic|researcher"
     r"|research\s+(?:assistant|fellow|associate)|postdoc|phd\s+candidate"
     r"|dean|school|curriculum|trainer|training\s+(?:specialist|manager))\b"
     r"|معلم|مدرس|أستاذ|باحث|أكاديمي", 2),
    ("Civil & Architecture",
     r"\b(civil\s+engineer|structural|architect(?:ure|ural)?\s+engineer"
     r"|site\s+engineer|construction|surveyor|quantity\s+surveyor|mep"
     r"|hvac|mechanical\s+engineer|electrical\s+engineer|geotechnical"
     r"|urban\s+plan\w*|interior\s+design\w*)\b"
     r"|هندسة\s*(?:مدنية|معمارية|ميكانيكية|كهربائية)|موقع", 3),
    ("Project & Program Mgmt",
     r"\b(project\s+(?:manager|management|engineer|coordinator|lead)|pmo"
     r"|program\s+(?:manager|management)|portfolio\s+manager|pmp"
     r"|delivery\s+(?:manager|lead))\b|إدارة\s*مشاريع|مدير\s*مشروع", 3),
    ("Media & Content",
     r"\b(journalist|editor|reporter|photographer|videographer|video\s+editor"
     r"|producer|broadcast|anchor|podcast|animator|3d\s+artist"
     r"|game\s+(?:developer|designer|artist))\b|صحافي|محرر|مونتاج|إعلام", 2),
    ("Consulting & Strategy",
     r"\b(consultant|consulting|advisory|strategy|strategic|management"
     r"\s+consultant|transformation|change\s+management|process\s+improvement"
     r"|analyst,?\s+strategy)\b|استشار\w*|استراتيج\w*", 1),
]

_FUNCTION_COMPILED = [(lbl, re.compile(pat, re.IGNORECASE | re.UNICODE), w)
                      for lbl, pat, w in _FUNCTION_RULES]


def classify_function(title: str, company: str = "") -> Tuple[str, str, List[str]]:
    """Return (primary_function, evidence, all_matched_functions).

    Scored rather than first-match-wins: "Senior Data Engineer, Cloud" hits
    both Data & AI and DevOps, and the higher-weighted, longer match wins.
    """
    t = (title or "").strip()
    if not t:
        return "Unknown", "empty title", []

    scores: Dict[str, float] = {}
    evidence: Dict[str, str] = {}
    for label, rx, weight in _FUNCTION_COMPILED:
        hits = rx.findall(t)
        if hits:
            m = rx.search(t)
            token = m.group(0) if m else ""
            scores[label] = scores.get(label, 0) + weight + 0.1 * len(hits) + 0.01 * len(token)
            evidence.setdefault(label, token)

    if not scores:
        return "Unknown", "no rule matched", []

    ordered = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    best = ordered[0][0]
    return best, "matched: %s" % evidence.get(best, ""), [k for k, _ in ordered]


# --------------------------------------------------------------------------- #
# industry (from the employer name)
# --------------------------------------------------------------------------- #
_INDUSTRY_RULES: List[Tuple[str, str]] = [
    ("Banking & Finance",
     r"\b(bank|banque|bancorp|capital|invest\w*|finance|financial|insurance"
     r"|assurance|takaful|fintech|microfinance|exchange|securities|fund"
     r"|leasing|payments?|visa|mastercard)\b|بنك|مصرف|تأمين|مالية"),
    ("Telecom",
     r"\b(telecom\w*|telecommunication|mobile\s+network|orange|zain|umniah"
     r"|stc|etisalat|ooredoo|vodafone|du\b|mtn|batelco|cellular|wireless"
     r"|broadband|isp)\b|اتصالات"),
    ("Software & IT Services",
     r"\b(software|technolog\w*|tech\b|it\s+(?:services|solutions|company)"
     r"|systems?|solutions?|digital|informatics|cyber|cloud|data|labs?"
     r"|studio|apps?|interactive|codes?|dev\w*|infotech|consulting\s+group)\b"
     r"|تكنولوجيا|برمجيات|حلول"),
    ("Healthcare & Pharma",
     r"\b(hospital|clinic|medical|health\w*|pharma\w*|pharmacy|drug|dental"
     r"|care\s+cent|diagnostic|laborator\w*|biotech|life\s+science)\b"
     r"|مستشفى|عيادة|طبي|صيدل\w*"),
    ("Education",
     r"\b(universit\w*|college|school|academy|institute|education\w*"
     r"|training\s+cent|edtech|kindergarten|faculty)\b"
     r"|جامعة|كلية|مدرسة|أكاديمية|معهد|تعليم"),
    ("Government & Public Sector",
     r"\b(ministr\w*|government|municipalit\w*|authority|department\s+of"
     r"|public\s+sector|royal|federal|national\s+(?:agency|center|centre)"
     r"|customs|parliament|embassy|council)\b"
     r"|وزارة|حكوم\w*|هيئة|أمانة|بلدية|سلطة"),
    ("NGO & International Orgs",
     r"\b(ngo|non[\s\-]?profit|nonprofit|foundation|charity|relief|unicef"
     r"|undp|unhcr|unrwa|united\s+nations|un\s+\w+|usaid|gi?z\b|red\s+cross"
     r"|crescent|humanitarian|mercy\s+corps|save\s+the\s+children|care\s+int)\b"
     r"|جمعية|مؤسسة\s*خيرية|إغاثة"),
    ("Consulting & Professional Services",
     r"\b(consult\w*|advisory|deloitte|pwc|pricewaterhouse|kpmg|ernst"
     r"|\bey\b|mckinsey|bcg|accenture|bain|audit\w*|law\s+firm|attorneys"
     r"|legal\s+(?:group|services))\b|استشار\w*|محاسبون|مكتب\s*محام"),
    ("E-commerce & Retail",
     r"\b(e[\s\-]?commerce|retail|store|market(?:place|s)?|shop\w*|mall"
     r"|supermarket|amazon|noon|talabat|carrefour|hypermarket|fashion"
     r"|boutique|trading\s+(?:co|company|est))\b|تجار\w*|أسواق|متجر"),
    ("Manufacturing & Industrial",
     r"\b(manufactur\w*|factory|industries|industrial|plant|cement|steel"
     r"|chemical|plastics|textile|packaging|foundry|assembly|mills?)\b"
     r"|مصنع|صناع\w*"),
    ("Construction & Real Estate",
     r"\b(construct\w*|contracting|contractors?|real\s+estate|properties"
     r"|development\s+(?:co|company)|engineering\s+(?:co|company|consult\w*)"
     r"|infrastructure|builders?|architects?)\b|إنشاءات|مقاولات|عقار\w*"),
    ("Energy & Utilities",
     r"\b(energy|power|electric\w*|petrol\w*|oil|gas|solar|renewable"
     r"|water\s+(?:company|authority)|utilit\w*|aramco|adnoc|refiner\w*)\b"
     r"|طاقة|كهرباء|نفط|مياه"),
    ("Logistics & Transport",
     r"\b(logistics|shipping|freight|cargo|transport\w*|courier|express"
     r"|airlines?|airways|aviation|port|maritime|dhl|aramex|fedex|ups\b"
     r"|railway)\b|شحن|نقل|طيران|خدمات\s*لوجستية"),
    ("Media & Entertainment",
     r"\b(media|broadcast\w*|tv\b|television|radio|news|press|publish\w*"
     r"|entertainment|studios?|film|production\s+(?:house|company)"
     r"|advertising|agency|marketing\s+(?:agency|group)|gaming|games?)\b"
     r"|إعلام|إعلان|دعاية|نشر"),
    ("Hospitality & Tourism",
     r"\b(hotel|resort|hospitality|restaurant|cafe|catering|tourism"
     r"|travel|tours?|marriott|hilton|accor|rotana)\b|فندق|مطعم|سياح\w*"),
    ("Agriculture & Food",
     r"\b(agricultur\w*|farms?|food|dairy|beverage|poultry|fisher\w*"
     r"|agri[\s\-]?tech|mills)\b|زراع\w*|أغذية|مواد\s*غذائية"),
    ("Freelance / Self-employed",
     r"\b(freelance|self[\s\-]?employed|independent|own\s+business"
     r"|personal\s+brand)\b|عمل\s*حر|مستقل"),
]

# Specific sectors are tested before generic ones: "Ministry of Digital Economy"
# is government, not a software house, even though "digital" looks techy.
_INDUSTRY_PRIORITY = [
    "Government & Public Sector",
    "NGO & International Orgs",
    "Education",
    "Healthcare & Pharma",
    "Banking & Finance",
    "Telecom",
    "Energy & Utilities",
    "Logistics & Transport",
    "Construction & Real Estate",
    "Manufacturing & Industrial",
    "Agriculture & Food",
    "Hospitality & Tourism",
    "E-commerce & Retail",
    "Media & Entertainment",
    "Consulting & Professional Services",
    "Software & IT Services",
    "Freelance / Self-employed",
]
_INDUSTRY_RULES.sort(
    key=lambda r: _INDUSTRY_PRIORITY.index(r[0])
    if r[0] in _INDUSTRY_PRIORITY else len(_INDUSTRY_PRIORITY))

_INDUSTRY_COMPILED = [(lbl, re.compile(pat, re.IGNORECASE | re.UNICODE))
                      for lbl, pat in _INDUSTRY_RULES]

# well-known employers whose name carries no sector keyword
KNOWN_COMPANY_INDUSTRY = {
    "microsoft": "Software & IT Services",
    "google": "Software & IT Services",
    "amazon": "E-commerce & Retail",
    "amazon web services": "Software & IT Services",
    "aws": "Software & IT Services",
    "meta": "Software & IT Services",
    "facebook": "Software & IT Services",
    "apple": "Software & IT Services",
    "ibm": "Software & IT Services",
    "oracle": "Software & IT Services",
    "sap": "Software & IT Services",
    "cisco": "Software & IT Services",
    "intel": "Software & IT Services",
    "nvidia": "Software & IT Services",
    "dell": "Software & IT Services",
    "hp": "Software & IT Services",
    "hewlett packard": "Software & IT Services",
    "salesforce": "Software & IT Services",
    "adobe": "Software & IT Services",
    "atlassian": "Software & IT Services",
    "shopify": "Software & IT Services",
    "stripe": "Banking & Finance",
    "paypal": "Banking & Finance",
    "uber": "Logistics & Transport",
    "careem": "Logistics & Transport",
    "talabat": "E-commerce & Retail",
    "noon": "E-commerce & Retail",
    "souq": "E-commerce & Retail",
    "netflix": "Media & Entertainment",
    "spotify": "Media & Entertainment",
    "tiktok": "Media & Entertainment",
    "bytedance": "Media & Entertainment",
    "linkedin": "Software & IT Services",
    "booking": "Hospitality & Tourism",
    "expedia": "Hospitality & Tourism",
    "siemens": "Manufacturing & Industrial",
    "schneider electric": "Energy & Utilities",
    "abb": "Manufacturing & Industrial",
    "bosch": "Manufacturing & Industrial",
    "nestle": "Agriculture & Food",
    "unilever": "Agriculture & Food",
    "pepsico": "Agriculture & Food",
    "coca cola": "Agriculture & Food",
    "deloitte": "Consulting & Professional Services",
    "pwc": "Consulting & Professional Services",
    "kpmg": "Consulting & Professional Services",
    "accenture": "Consulting & Professional Services",
    "mckinsey": "Consulting & Professional Services",
    "maersk": "Logistics & Transport",
    "aramex": "Logistics & Transport",
    "dhl": "Logistics & Transport",
    "zain": "Telecom",
    "orange": "Telecom",
    "umniah": "Telecom",
    "stc": "Telecom",
    "etisalat": "Telecom",
    "ooredoo": "Telecom",
    "vodafone": "Telecom",
}

# function -> plausible industry when the company name says nothing
_FUNCTION_INDUSTRY_HINT = {
    "Healthcare": "Healthcare & Pharma",
    "Education & Research": "Education",
    "Legal": "Consulting & Professional Services",
    "Civil & Architecture": "Construction & Real Estate",
}


def classify_industry(company_clean: str,
                      function_label: str = "",
                      overrides: Optional[Dict[str, str]] = None,
                      company_key: str = "") -> Tuple[str, str]:
    """Return (industry, evidence). Overrides (company_key -> industry) always
    win, so you can correct any company once and the whole report follows."""
    if overrides:
        hit = overrides.get((company_key or "").lower()) or \
              overrides.get((company_clean or "").strip().lower())
        if hit:
            return hit, "manual override"

    c = (company_clean or "").strip()
    if not c:
        return "Unknown", "no company"

    ck = (company_key or "").strip().lower()
    if ck in KNOWN_COMPANY_INDUSTRY:
        return KNOWN_COMPANY_INDUSTRY[ck], "known employer"
    # also try the leading word ("Zain Jordan" -> "zain")
    head = ck.split(" ")[0] if ck else ""
    if head and head in KNOWN_COMPANY_INDUSTRY:
        return KNOWN_COMPANY_INDUSTRY[head], "known employer (%s)" % head

    for label, rx in _INDUSTRY_COMPILED:
        m = rx.search(c)
        if m:
            return label, "company keyword: %s" % m.group(0)

    hint = _FUNCTION_INDUSTRY_HINT.get(function_label)
    if hint:
        return hint, "inferred from role (%s)" % function_label
    return "Unknown", "no keyword matched"


# --------------------------------------------------------------------------- #
# convenience flags used by scoring and messaging
# --------------------------------------------------------------------------- #
_RECRUITER_RE = re.compile(
    r"\b(recruit\w*|talent\s+acquisition|talent\s+partner|sourcer|headhunt\w*"
    r"|hiring\s+manager|hr\b|human\s+resources?|hrbp|people\s+(?:ops|partner))\b"
    r"|توظيف|موارد\s*بشرية", re.IGNORECASE | re.UNICODE)

_HIRING_SIGNAL_RE = re.compile(
    r"\b(we'?re\s+hiring|hiring|now\s+hiring|join\s+(?:us|our\s+team)"
    r"|#hiring)\b|نوظف|نبحث\s*عن", re.IGNORECASE | re.UNICODE)


def is_recruiter(title: str) -> bool:
    return bool(_RECRUITER_RE.search(title or ""))


def has_hiring_signal(raw_title: str) -> bool:
    return bool(_HIRING_SIGNAL_RE.search(raw_title or ""))


def is_decision_maker(seniority_rank: int) -> bool:
    return seniority_rank >= SENIORITY_RANK["Manager"]
