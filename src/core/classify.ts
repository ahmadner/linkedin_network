export const SENIORITY_RANK = {
  "Founder / Owner": 95,
  "C-Level": 90,
  VP: 80,
  Director: 70,
  Head: 65,
  Manager: 55,
  "Team Lead": 45,
  "Senior IC": 35,
  "Consultant / Freelancer": 30,
  "Mid IC": 25,
  Junior: 15,
  "Intern / Trainee": 8,
  Student: 5,
  Unknown: 0,
} as const;

export type Seniority = keyof typeof SENIORITY_RANK;

export const SENIORITY_LABELS = Object.keys(SENIORITY_RANK) as Seniority[];

export interface Classification<T extends string = string> {
  label: T;
  evidence: string;
}

const MANAGER_TRAPS =
  /\b(product|project|program|programme|account|community|brand|social|content|campaign|category|portfolio|contract|facility|facilities|office|store|branch|case|property|partner|channel)\s+(manager|managers|lead|owner)\b/i;

const SENIOR_PREFIX = /\b(senior|sr\.?|lead|head|principal|staff)\b/i;

const HARD_AUTHORITY =
  /\b(founder|owner|chief|c[.\s]?e[.\s]?o|c[.\s]?t[.\s]?o|vp|vice[\s-]president|director|head\s+of)\b/i;

const SENIORITY_RULES: Array<[Seniority, RegExp]> = [
  ["Founder / Owner", /\b(founder|co[\s-]?founder|cofounder|owner|co[\s-]?owner|proprietor|entrepreneur|managing\s+partner|business\s+owner)\b|مؤسس|شريك\s*مؤسس|صاحب\s*(?:شركة|عمل)/i],
  ["C-Level", /\b(c[.\s]?e[.\s]?o|c[.\s]?t[.\s]?o|c[.\s]?f[.\s]?o|c[.\s]?o[.\s]?o|c[.\s]?i[.\s]?o|c[.\s]?m[.\s]?o|c[.\s]?p[.\s]?o|c[.\s]?h[.\s]?r[.\s]?o|c[.\s]?d[.\s]?o|c[.\s]?s[.\s]?o|c[.\s]?i[.\s]?s[.\s]?o)\b|\bchief\s+[a-z]+\s+officer\b|\bchief\s+of\s+staff\b|\b(president|managing\s+director|general\s+manager|board\s+member|chairman|chairperson|vice\s+chancellor)\b|مدير\s*عام|الرئيس\s*التنفيذي|نائب\s*الرئيس\s*التنفيذي/i],
  ["VP", /\b(vp|v\.p|svp|evp|avp|vice[\s-]president|deputy\s+director)\b|نائب\s*(?:الرئيس|المدير)/i],
  ["Director", /\b(director|directeur|associate\s+director|senior\s+director|executive\s+director|dean|principal\s+(?:engineer|architect|scientist|consultant))\b|مدير\s*(?:تنفيذي|إدارة|دائرة)/i],
  ["Head", /\b(head\s+of|head,|global\s+head|group\s+head|department\s+head|chef\s+de|superintendent)\b|\bhead$|رئيس\s*(?:قسم|دائرة|وحدة|فريق)/i],
  ["Manager", /\b(manager|mgr|engineering\s+manager|development\s+manager|senior\s+manager|group\s+manager|people\s+manager|unit\s+manager|regional\s+manager|country\s+manager|supervisor|foreman)\b|مدير|مشرف/i],
  ["Team Lead", /\b(team\s+lead|tech\s+lead|technical\s+lead|squad\s+lead|crew\s+lead|lead\s+(?:engineer|developer|designer|analyst|architect|scientist|consultant|specialist)|teamlead|tl)\b|\blead$|قائد\s*فريق/i],
  ["Senior IC", /\b(senior|sr\.?|snr|staff|principal|expert|specialist\s+iii|iii|iv)\b|أول|خبير|كبير/i],
  ["Intern / Trainee", /\b(intern|internship|trainee|apprentice|co[\s-]?op|placement|summer\s+(?:intern|analyst))\b|متدرب/i],
  ["Student", /\b(student|undergraduate|undergrad|bachelor|master'?s?\s+student|phd\s+(?:student|candidate)|fresh\s+graduate|graduate\s+student|new\s+grad|seeking\s+opportunit)\b|طالب|حديث\s*التخرج/i],
  ["Junior", /\b(junior|jr\.?|entry[\s-]level|associate\s+(?:engineer|developer|analyst|consultant)|graduate\s+(?:engineer|developer|trainee))\b|مبتدئ|مساعد/i],
  ["Consultant / Freelancer", /\b(freelance|freelancer|consultant|contractor|advisor|adviser|self[\s-]employed|independent)\b|مستقل|مستشار/i],
];

const IC_FALLBACK =
  /\b(engineer|developer|programmer|designer|analyst|scientist|architect|administrator|technician|accountant|nurse|doctor|physician|pharmacist|teacher|lecturer|researcher|officer|associate|executive|agent|representative|coordinator|specialist|consultant|auditor|editor|writer|translator|recruiter|tester|qa|operator|assistant)\b|مهندس|مطور|محاسب|مصمم|محلل|معلم|باحث|ممرض|طبيب|صيدلاني|موظف|أخصائي/i;

export function classifySeniority(title: string): Classification<Seniority> & { rank: number } {
  const t = (title || "").trim();
  if (!t) return { label: "Unknown", rank: 0, evidence: "empty title" };

  const trap = MANAGER_TRAPS.exec(t);
  if (trap && !HARD_AUTHORITY.test(t)) {
    const label: Seniority = SENIOR_PREFIX.test(t) ? "Senior IC" : "Mid IC";
    return { label, rank: SENIORITY_RANK[label], evidence: `title-trap: ${trap[0]}` };
  }
  for (const [label, rx] of SENIORITY_RULES) {
    const m = rx.exec(t);
    if (m) return { label, rank: SENIORITY_RANK[label], evidence: `matched: ${m[0]}` };
  }
  if (IC_FALLBACK.test(t)) return { label: "Mid IC", rank: SENIORITY_RANK["Mid IC"], evidence: "individual-contributor title" };
  return { label: "Unknown", rank: 0, evidence: "no rule matched" };
}

const FUNCTION_RULES: Array<[string, RegExp, number]> = [
  ["HR & Recruiting", /\b(recruit\w*|talent\s+(?:acquisition|partner|sourc\w*)|sourcer|headhunt\w*|hr\b|human\s+resources?|people\s+(?:ops|operations|partner|team)|hrbp|chro|compensation|benefits|l&d|learning\s+and\s+development|employer\s+brand|hiring)\b|موارد\s*بشرية|توظيف/gi, 3],
  ["Data & AI", /\b(data\s+(?:scientist|science|engineer|analyst|analytics|architect|platform)|machine\s+learning|ml\s+engineer|mlops|deep\s+learning|ai\b|artificial\s+intelligence|nlp|computer\s+vision|llm|business\s+intelligence|bi\s+(?:developer|analyst)|big\s+data|etl|data\s+warehouse|analytics\s+engineer|information\s+management)\b|علم\s*البيانات|ذكاء\s*اصطناعي/gi, 3],
  ["DevOps & Cloud", /\b(devops|sre|site\s+reliability|platform\s+engineer|cloud\s+(?:engineer|architect|consultant)|infrastructure|kubernetes|terraform|aws\s+(?:engineer|architect)|azure\s+(?:engineer|architect)|systems?\s+engineer|network\s+engineer|sysadmin|system\s+administrator)\b|بنية\s*تحتية/gi, 3],
  ["Security", /\b(security|cyber\s*security|infosec|appsec|soc\s+analyst|pentest\w*|penetration\s+test\w*|ciso|grc|iam\b|threat|vulnerability|ethical\s+hacker|red\s+team|blue\s+team)\b|أمن\s*(?:سيبراني|معلومات)/gi, 3],
  ["QA & Testing", /\b(qa\b|quality\s+assurance|test\s+(?:engineer|automation|analyst|lead)|sdet|tester|testing|quality\s+(?:engineer|control|inspector))\b|جودة|اختبار/gi, 3],
  ["Engineering & Software", /\b(software|developer|engineer(?:ing|s)?|programmer|full[\s-]?stack|backend|back[\s-]end|frontend|front[\s-]end|web\s+developer|mobile|android|ios|flutter|react|angular|vue|node|java|python|\.net|dotnet|php|laravel|golang|rust|c\+\+|c#|embedded|firmware|technical\s+lead|architect|cto|r&d)\b|مهندس\s*(?:برمجيات|حاسوب)|مطور|برمجة/gi, 2],
  ["Product", /\b(product\s+(?:manager|owner|lead|director|designer|analyst)|cpo|product\s+management|po\b|scrum\s+master|agile\s+coach|business\s+analyst|ba\b|product\s+marketing)\b|مدير\s*منتج/gi, 3],
  ["Design & UX", /\b(ux|ui\b|ui\/ux|user\s+(?:experience|interface|research)|product\s+design\w*|product\s+designer|graphic\s+design\w*|visual\s+design\w*|interaction\s+design\w*|motion\s+design\w*|art\s+director|creative\s+director|illustrator|brand\s+design\w*)\b|تصميم|مصمم/gi, 3],
  ["IT & Support", /\b(it\s+(?:support|specialist|manager|administrator|technician|officer|consultant|director|head|lead|operations|infrastructure|analyst)|\bcio\b|help\s*desk|service\s+desk|technical\s+support|desktop\s+support|erp|sap\s+(?:consultant|basis)|odoo|dynamics|information\s+technology)\b|دعم\s*فني|تقنية\s*المعلومات/gi, 2],
  ["Sales & BD", /\b(sales|account\s+(?:executive|manager|director)|business\s+development|bd\b|bdm|pre[\s-]?sales|solution\s+(?:consultant|engineer)|key\s+account|channel|partnership|revenue|cro\b|territory)\b|مبيعات|تطوير\s*أعمال/gi, 3],
  ["Marketing", /\b(marketing|seo|sem|ppc|growth|digital\s+marketing|content\s+(?:marketing|creator|writer)|social\s+media|brand\s+(?:manager|strategist)|campaign|communications?|pr\b|public\s+relations|copywriter|media\s+buyer|cmo)\b|تسويق|علاقات\s*عامة/gi, 3],
  ["Customer Success", /\b(customer\s+(?:success|support|service|experience|care)|client\s+(?:success|services|relations)|account\s+support|csm\b|call\s+cent|technical\s+account\s+manager)\b|خدمة\s*(?:العملاء|عملاء)/gi, 3],
  ["Finance & Accounting", /\b(finance|financial|accountant|accounting|audit\w*|controller|treasury|tax|cfo|bookkeep\w*|credit\s+analyst|investment|banking|actuar\w*|payroll|fp&a)\b|محاسب|مالية|تدقيق|مصرفي/gi, 3],
  ["Operations & Supply Chain", /\b(operations?|ops\s+manager|supply\s+chain|logistics|procurement|purchasing|warehouse|inventory|planning\s+engineer|production|manufacturing|plant|lean|six\s+sigma|facility|fleet|shipping|import|export|customs)\b|عمليات|لوجستي|مشتريات|مستودع/gi, 2],
  ["Legal", /\b(legal|lawyer|attorney|advocate|counsel|paralegal|compliance|contracts?\s+(?:manager|specialist)|notary|judge)\b|قانون[؀-ۿ]*|محام|مستشار\s*قانوني/gi, 3],
  ["Healthcare", /\b(doctor|physician|surgeon|dentist|nurse|nursing|pharmacist|pharmacy|medical|clinical|radiolog\w*|lab\s+technician|therapist|dietitian|midwife|paramedic|veterinar\w*|md\b)\b|طبيب|ممرض|صيدلاني|طبي/gi, 3],
  ["Education & Research", /\b(teacher|lecturer|professor|instructor|tutor|academic|researcher|research\s+(?:assistant|fellow|associate)|postdoc|phd\s+candidate|dean|school|curriculum|trainer|training\s+(?:specialist|manager))\b|معلم|مدرس|أستاذ|باحث|أكاديمي/gi, 2],
  ["Civil & Architecture", /\b(civil\s+engineer|structural|architect(?:ure|ural)?\s+engineer|site\s+engineer|construction|surveyor|quantity\s+surveyor|mep|hvac|mechanical\s+engineer|electrical\s+engineer|geotechnical|urban\s+plan\w*|interior\s+design\w*)\b|هندسة\s*(?:مدنية|معمارية|ميكانيكية|كهربائية)|موقع/gi, 3],
  ["Project & Program Mgmt", /\b(project\s+(?:manager|management|engineer|coordinator|lead)|pmo|program\s+(?:manager|management)|portfolio\s+manager|pmp|delivery\s+(?:manager|lead))\b|إدارة\s*مشاريع|مدير\s*مشروع/gi, 3],
  ["Media & Content", /\b(journalist|editor|reporter|photographer|videographer|video\s+editor|producer|broadcast|anchor|podcast|animator|3d\s+artist|game\s+(?:developer|designer|artist))\b|صحافي|محرر|مونتاج|إعلام/gi, 2],
  ["Consulting & Strategy", /\b(consultant|consulting|advisory|strategy|strategic|management\s+consultant|transformation|change\s+management|process\s+improvement|analyst,?\s+strategy)\b|استشار[؀-ۿ]*|استراتيج[؀-ۿ]*/gi, 1],
];

export const FUNCTION_LABELS: string[] = [...FUNCTION_RULES.map(([label]) => label), "Unknown"];

export function classifyFunction(title: string): Classification & { all: string[] } {
  const t = (title || "").trim();
  if (!t) return { label: "Unknown", evidence: "empty title", all: [] };

  const scores = new Map<string, number>();
  const evidence = new Map<string, string>();
  for (const [label, rx, weight] of FUNCTION_RULES) {
    const hits = t.match(rx);
    if (!hits || hits.length === 0) continue;
    const token = hits[0] ?? "";
    scores.set(label, (scores.get(label) ?? 0) + weight + 0.1 * hits.length + 0.01 * token.length);
    if (!evidence.has(label)) evidence.set(label, token);
  }
  if (scores.size === 0) return { label: "Unknown", evidence: "no rule matched", all: [] };

  const ordered = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label);
  const best = ordered[0] ?? "Unknown";
  return { label: best, evidence: `matched: ${evidence.get(best) ?? ""}`, all: ordered };
}

const INDUSTRY_RULES: Array<[string, RegExp]> = [
  ["Government & Public Sector", /\b(ministr\w*|government|municipalit\w*|authority|department\s+of|public\s+sector|royal|federal|national\s+(?:agency|center|centre)|customs|parliament|embassy|council)\b|وزارة|حكوم[؀-ۿ]*|هيئة|أمانة|بلدية|سلطة/i],
  ["NGO & International Orgs", /\b(ngo|non[\s-]?profit|nonprofit|foundation|charity|relief|unicef|undp|unhcr|unrwa|united\s+nations|un\s+\w+|usaid|gi?z|red\s+cross|crescent|humanitarian|mercy\s+corps|save\s+the\s+children|care\s+int)\b|جمعية|مؤسسة\s*خيرية|إغاثة/i],
  ["Education", /\b(universit\w*|college|school|academy|institute|education\w*|training\s+cent|edtech|kindergarten|faculty)\b|جامعة|كلية|مدرسة|أكاديمية|معهد|تعليم/i],
  ["Healthcare & Pharma", /\b(hospital|clinic|medical|health\w*|pharma\w*|pharmacy|drug|dental|care\s+cent|cancer\s+cent\w*|diagnostic|laborator\w*|biotech|life\s+science)\b|مستشفى|عيادة|طبي|صيدل[؀-ۿ]*/i],
  ["Banking & Finance", /\b(bank|banque|bancorp|capital|invest\w*|finance|financial|insurance|assurance|takaful|fintech|microfinance|exchange|securities|fund|leasing|payments?|visa|mastercard)\b|بنك|مصرف|تأمين|مالية/i],
  ["Telecom", /\b(telecom\w*|telecommunication|mobile\s+network|orange|zain|umniah|stc|etisalat|ooredoo|vodafone|du|mtn|batelco|cellular|wireless|broadband|isp)\b|اتصالات/i],
  ["Energy & Utilities", /\b(energy|power|electric\w*|petrol\w*|oil|gas|solar|renewable|water\s+(?:company|authority)|utilit\w*|aramco|adnoc|refiner\w*)\b|طاقة|كهرباء|نفط|مياه/i],
  ["Logistics & Transport", /\b(logistics|shipping|freight|cargo|transport\w*|courier|express|airlines?|airways|aviation|port|maritime|dhl|aramex|fedex|ups|railway)\b|شحن|نقل|طيران|خدمات\s*لوجستية/i],
  ["Construction & Real Estate", /\b(construct\w*|contracting|contractors?|real\s+estate|properties|development\s+(?:co|company)|engineering\s+(?:co|company|consult\w*)|infrastructure|builders?|architects?)\b|إنشاءات|مقاولات|عقار[؀-ۿ]*/i],
  ["Manufacturing & Industrial", /\b(manufactur\w*|factory|industries|industrial|plant|cement|steel|chemical|plastics|textile|packaging|foundry|assembly|mills?)\b|مصنع|صناع[؀-ۿ]*/i],
  ["Agriculture & Food", /\b(agricultur\w*|farms?|food|dairy|beverage|poultry|fisher\w*|agri[\s-]?tech|mills)\b|زراع[؀-ۿ]*|أغذية|مواد\s*غذائية/i],
  ["Hospitality & Tourism", /\b(hotel|resort|hospitality|restaurant|cafe|catering|tourism|travel|tours?|marriott|hilton|accor|rotana)\b|فندق|مطعم|سياح[؀-ۿ]*/i],
  ["E-commerce & Retail", /\b(e[\s-]?commerce|retail|store|market(?:place|s)?|shop\w*|mall|supermarket|amazon|noon|talabat|carrefour|hypermarket|fashion|boutique|trading\s+(?:co|company|est))\b|تجار[؀-ۿ]*|أسواق|متجر/i],
  ["Media & Entertainment", /\b(media|broadcast\w*|tv|television|radio|news|press|publish\w*|entertainment|studios?|film|production\s+(?:house|company)|advertising|agency|marketing\s+(?:agency|group)|gaming|games?)\b|إعلام|إعلان|دعاية|نشر/i],
  ["Consulting & Professional Services", /\b(consult\w*|advisory|deloitte|pwc|pricewaterhouse|kpmg|ernst|ey|mckinsey|bcg|accenture|bain|audit\w*|law\s+firm|attorneys|legal\s+(?:group|services))\b|استشار[؀-ۿ]*|محاسبون|مكتب\s*محام/i],
  ["Software & IT Services", /\b(software|technolog\w*|tech|it\s+(?:services|solutions|company)|systems?|solutions?|digital|informatics|cyber|cloud|data|labs?|studio|apps?|interactive|codes?|dev\w*|infotech|consulting\s+group)\b|تكنولوجيا|برمجيات|حلول/i],
  ["Freelance / Self-employed", /\b(freelance|self[\s-]?employed|independent|own\s+business|personal\s+brand)\b|عمل\s*حر|مستقل/i],
];

export const INDUSTRY_LABELS: string[] = [...INDUSTRY_RULES.map(([label]) => label), "Unknown"];

const KNOWN_COMPANY_INDUSTRY: Record<string, string> = {
  microsoft: "Software & IT Services", google: "Software & IT Services",
  amazon: "E-commerce & Retail", "amazon web services": "Software & IT Services",
  aws: "Software & IT Services", meta: "Software & IT Services", facebook: "Software & IT Services",
  apple: "Software & IT Services", ibm: "Software & IT Services", oracle: "Software & IT Services",
  sap: "Software & IT Services", cisco: "Software & IT Services", intel: "Software & IT Services",
  nvidia: "Software & IT Services", dell: "Software & IT Services", hp: "Software & IT Services",
  "hewlett packard": "Software & IT Services", salesforce: "Software & IT Services",
  adobe: "Software & IT Services", atlassian: "Software & IT Services", shopify: "Software & IT Services",
  stripe: "Banking & Finance", paypal: "Banking & Finance", uber: "Logistics & Transport",
  careem: "Logistics & Transport", talabat: "E-commerce & Retail", noon: "E-commerce & Retail",
  souq: "E-commerce & Retail", netflix: "Media & Entertainment", spotify: "Media & Entertainment",
  tiktok: "Media & Entertainment", bytedance: "Media & Entertainment", linkedin: "Software & IT Services",
  booking: "Hospitality & Tourism", expedia: "Hospitality & Tourism", siemens: "Manufacturing & Industrial",
  "schneider electric": "Energy & Utilities", abb: "Manufacturing & Industrial", bosch: "Manufacturing & Industrial",
  nestle: "Agriculture & Food", unilever: "Agriculture & Food", pepsico: "Agriculture & Food",
  "coca cola": "Agriculture & Food", deloitte: "Consulting & Professional Services",
  pwc: "Consulting & Professional Services", kpmg: "Consulting & Professional Services",
  accenture: "Consulting & Professional Services", mckinsey: "Consulting & Professional Services",
  maersk: "Logistics & Transport", aramex: "Logistics & Transport", dhl: "Logistics & Transport",
  zain: "Telecom", orange: "Telecom", umniah: "Telecom", stc: "Telecom", etisalat: "Telecom",
  ooredoo: "Telecom", vodafone: "Telecom",
};

const FUNCTION_INDUSTRY_HINT: Record<string, string> = {
  Healthcare: "Healthcare & Pharma",
  "Education & Research": "Education",
  Legal: "Consulting & Professional Services",
  "Civil & Architecture": "Construction & Real Estate",
};

export function classifyIndustry(
  companyClean: string,
  companyKeyValue: string,
  functionLabel: string,
  overrides: Record<string, string>,
): Classification {
  const key = (companyKeyValue || "").trim().toLowerCase();
  const override = overrides[key] ?? overrides[(companyClean || "").trim().toLowerCase()];
  if (override) return { label: override, evidence: "manual override" };

  const c = (companyClean || "").trim();
  if (!c) return { label: "Unknown", evidence: "no company" };

  const known = KNOWN_COMPANY_INDUSTRY[key];
  if (known) return { label: known, evidence: "known employer" };
  const head = key.split(" ")[0] ?? "";
  const knownHead = head ? KNOWN_COMPANY_INDUSTRY[head] : undefined;
  if (knownHead) return { label: knownHead, evidence: `known employer (${head})` };

  for (const [label, rx] of INDUSTRY_RULES) {
    const m = rx.exec(c);
    if (m) return { label, evidence: `company keyword: ${m[0]}` };
  }
  const hint = FUNCTION_INDUSTRY_HINT[functionLabel];
  if (hint) return { label: hint, evidence: `inferred from role (${functionLabel})` };
  return { label: "Unknown", evidence: "no keyword matched" };
}

const RECRUITER_RE =
  /\b(recruit\w*|talent\s+acquisition|talent\s+partner|sourcer|headhunt\w*|hiring\s+manager|hr\b|human\s+resources?|hrbp|people\s+(?:ops|partner))\b|توظيف|موارد\s*بشرية/i;

export function isRecruiter(title: string): boolean {
  return RECRUITER_RE.test(title || "");
}

export function isDecisionMaker(rank: number): boolean {
  return rank >= SENIORITY_RANK.Manager;
}
