import { SENIORITY_RANK } from "./classify";
import type { Lang, MessageSet, OutreachMode, Profile } from "./types";

type Pair = readonly [string, string];

export const INDUSTRY_ANGLE: Record<string, Pair> = {
  "Banking & Finance": ["الأنظمة البنكية والمالية بتفرض مستوى عالي من الدقة والأمان والأداء", "banking and fintech systems set a high bar for accuracy, security and performance"],
  Telecom: ["قطاع الاتصالات بتعامل مع أحجام بيانات ضخمة وأنظمة real-time", "telecom runs on huge data volumes and real-time systems"],
  "Software & IT Services": ["بيئة الشركات التقنية وتسليم المنتجات لعملاء مختلفين", "product delivery across different clients in a software house"],
  "Healthcare & Pharma": ["الأنظمة الصحية بتحتاج موثوقية عالية وحماية لبيانات المرضى", "healthcare systems demand high reliability and strict data protection"],
  Education: ["الأنظمة التعليمية والمنصات الرقمية وتأثيرها المباشر على الطلاب", "education platforms and the direct impact they have on students"],
  "Government & Public Sector": ["مشاريع التحول الرقمي في القطاع العام وحجم المستخدمين الكبير", "public-sector digital transformation and its large user base"],
  "NGO & International Orgs": ["العمل التنموي والإنساني والأثر الحقيقي للمشاريع على الأرض", "development and humanitarian work with measurable impact on the ground"],
  "Consulting & Professional Services": ["العمل الاستشاري والتنقل بين قطاعات وعملاء مختلفين", "consulting work and the exposure it gives across sectors and clients"],
  "E-commerce & Retail": ["التجارة الإلكترونية وتحديات الحجم في أوقات الذروة", "e-commerce and the scale challenges that come with peak traffic"],
  "Manufacturing & Industrial": ["الأنظمة الصناعية وربط خطوط الإنتاج بالأنظمة الرقمية", "industrial systems and connecting production lines to digital tooling"],
  "Construction & Real Estate": ["إدارة المشاريع الإنشائية وضبط الجداول والتكاليف", "construction project delivery and keeping schedule and cost under control"],
  "Energy & Utilities": ["قطاع الطاقة والمرافق وأنظمة المراقبة والتحكم", "the energy and utilities sector with its monitoring and control systems"],
  "Logistics & Transport": ["اللوجستيك والتتبع وتحسين سلاسل التوريد", "logistics, tracking and supply-chain optimisation"],
  "Media & Entertainment": ["صناعة المحتوى والإعلام الرقمي وسرعة الإنتاج", "digital media and the pace content production demands"],
  "Hospitality & Tourism": ["قطاع الضيافة والسياحة وتجربة العميل من أول لمسة", "hospitality and the customer experience from the first touchpoint"],
  "Agriculture & Food": ["قطاع الأغذية والزراعة وسلاسل التوريد والجودة", "the food and agriculture sector, its supply chains and quality controls"],
  "Freelance / Self-employed": ["العمل المستقل وبناء شغل خاص من الصفر", "independent work and building something from scratch"],
  Unknown: ["الشغل والخبرة الي بنيتها في مجالك", "the experience you have built in your field"],
};

export const FUNCTION_ANGLE: Record<string, Pair> = {
  "Engineering & Software": ["تطوير البرمجيات", "software engineering"],
  "Data & AI": ["البيانات والذكاء الاصطناعي", "data and AI"],
  "DevOps & Cloud": ["الـ DevOps والكلاود", "DevOps and cloud"],
  Security: ["الأمن السيبراني", "security"],
  "QA & Testing": ["اختبار البرمجيات والجودة", "QA and testing"],
  Product: ["إدارة المنتج", "product management"],
  "Design & UX": ["التصميم وتجربة المستخدم", "design and UX"],
  "IT & Support": ["تقنية المعلومات والدعم", "IT and support"],
  "Sales & BD": ["المبيعات وتطوير الأعمال", "sales and business development"],
  Marketing: ["التسويق", "marketing"],
  "Customer Success": ["خدمة ونجاح العملاء", "customer success"],
  "Finance & Accounting": ["المالية والمحاسبة", "finance and accounting"],
  "Operations & Supply Chain": ["العمليات وسلاسل التوريد", "operations and supply chain"],
  Legal: ["المجال القانوني", "legal"],
  Healthcare: ["القطاع الصحي", "healthcare"],
  "Education & Research": ["التعليم والبحث", "education and research"],
  "Civil & Architecture": ["الهندسة المدنية والمعمارية", "civil engineering and architecture"],
  "Project & Program Mgmt": ["إدارة المشاريع", "project management"],
  "Media & Content": ["الإعلام والمحتوى", "media and content"],
  "Consulting & Strategy": ["الاستشارات والاستراتيجية", "consulting and strategy"],
  "HR & Recruiting": ["الموارد البشرية والتوظيف", "HR and recruiting"],
  Unknown: ["مجالك", "your field"],
};

export const MODE_LABEL: Record<OutreachMode, string> = {
  cold: "Cold - first contact",
  reconnect: "Reconnect - spoke before",
  nudge: "Nudge - no reply yet",
};

export type Archetype = "recruiter" | "hiring_manager" | "senior_leader" | "founder" | "peer" | "academic" | "generic";

export const ARCHETYPE_LABEL: Record<Archetype, string> = {
  recruiter: "Recruiter / HR",
  hiring_manager: "Hiring manager (target function)",
  senior_leader: "Senior leader",
  founder: "Founder / Owner",
  peer: "Peer in my field",
  academic: "Student / Academic",
  generic: "General network",
};

export function clip(text: string, limit: number): string {
  const t = (text || "").replace(/[ \t]+/g, " ").trim();
  if (t.length <= limit) return t;
  let cut = t.slice(0, Math.max(0, limit - 1));
  const space = cut.lastIndexOf(" ");
  if (space > 0) cut = cut.slice(0, space);
  return cut.replace(/[ ,.،؛-]+$/, "") + "…";
}

function tidy(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+([,.،؛!?])/g, "$1")
    .trim();
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function sentence(text: string, lang: Lang): string {
  const ends = lang === "ar" ? [".", "!", "؟"] : [".", "!", "?"];
  return ends.some((e) => text.endsWith(e)) ? text : text + ".";
}

export function sincePhrase(days: number | null, lang: Lang): string {
  const ar = lang === "ar";
  if (days === null) return ar ? "قبل فترة" : "a while back";
  if (days <= 14) return ar ? "قبل أيام" : "a few days ago";
  if (days <= 45) return ar ? "قبل أسابيع" : "a few weeks ago";
  if (days <= 75) return ar ? "قبل شهر تقريبًا" : "about a month ago";
  if (days < 330) {
    const m = Math.max(2, Math.round(days / 30));
    if (ar) return m === 2 ? "قبل شهرين" : m <= 10 ? `قبل ${m} أشهر` : `قبل ${m} شهر`;
    return `about ${m} months ago`;
  }
  const y = Math.max(1, Math.round(days / 365.25));
  if (ar) return y === 1 ? "قبل سنة تقريبًا" : y === 2 ? "قبل سنتين تقريبًا" : y <= 10 ? `قبل ${y} سنوات` : `قبل ${y} سنة`;
  return y === 1 ? "about a year ago" : `about ${y} years ago`;
}

export function pickArchetype(input: {
  isRecruiter: boolean;
  seniority: string;
  seniorityRank: number;
  function: string;
  targetFunctions: string[];
}): Archetype {
  const inTarget = input.targetFunctions.some((f) => f.trim().toLowerCase() === input.function.toLowerCase());
  if (input.isRecruiter || input.function === "HR & Recruiting") return "recruiter";
  if (input.seniority === "Founder / Owner") return "founder";
  if (input.seniority === "Student" || input.seniority === "Intern / Trainee" || input.function === "Education & Research") return "academic";
  if (inTarget && input.seniorityRank >= SENIORITY_RANK.Manager) return "hiring_manager";
  if (input.seniorityRank >= SENIORITY_RANK.Director) return "senior_leader";
  if (inTarget) return "peer";
  return "generic";
}

export interface MessageContext {
  greetingName: string;
  theirRole: string;
  company: string;
  industry: string;
  function: string;
  archetype: Archetype;
  mode: OutreachMode;
  daysSince: number | null;
}

const JOB_ASK: Record<Archetype, Pair> = {
  recruiter: ["إذا في عندكم شاغر مناسب حاليًا أو مستقبلًا، بكون ممتن لو تاخذ سيرتي بعين الاعتبار.", "If you have a suitable opening now or later, I would be grateful if you kept my CV in mind."],
  hiring_manager: ["إذا فريقك بيتوسع، بحب أعرف إذا في مجال نحكي عن دور مناسب.", "If your team is growing, I would love to know whether there is room to talk about a fit."],
  senior_leader: ["بحب أضيفك لشبكتي وأتابع شغلكم، وإذا في فرصة مناسبة بكون سعيد أعرف عنها.", "I would like to stay connected and follow your work, and I would be glad to hear of any suitable opportunity."],
  founder: ["إذا بتبنوا الفريق حاليًا، بحب أسمع عن الاحتياج وكيف أقدر أساعد.", "If you are building the team right now, I would love to hear what you need and how I could help."],
  peer: ["بحب نبقى على تواصل ونتبادل الخبرات، وإذا سمعت عن فرصة مناسبة بكون ممتن لو تدلني.", "Happy to stay in touch and swap notes, and grateful for any pointer to a suitable opening."],
  academic: ["بحب نبقى على تواصل ونتعاون إذا طرأ شي مشترك.", "Happy to stay connected and collaborate if something overlaps."],
  generic: ["بحب نبقى على تواصل، وإذا في شي أقدر أساعد فيه خبرني.", "Happy to stay connected - and let me know if there is anything I can help with."],
};

const GENERAL_ASK: Pair = ["بحب نبقى على تواصل ونشوف إذا في مجال نتعاون فيه.", "I would like to stay connected and explore whether there is room to collaborate."];

export class MessageBuilder {
  private readonly noteLimit: number;
  private readonly messageLimit: number;

  constructor(private readonly profile: Profile) {
    this.noteLimit = profile.messaging.note_char_limit || 200;
    this.messageLimit = profile.messaging.message_char_limit || 1600;
  }

  build(ctx: MessageContext): MessageSet {
    const out = {} as MessageSet;
    for (const lang of ["ar", "en"] as const) {
      if (ctx.mode === "nudge") {
        out[`note_${lang}`] = this.nudgeShort(lang, ctx);
        out[`message_${lang}`] = this.nudge(lang, ctx);
      } else if (ctx.mode === "reconnect") {
        out[`note_${lang}`] = this.reconnectShort(lang, ctx);
        out[`message_${lang}`] = this.reconnect(lang, ctx);
      } else {
        out[`note_${lang}`] = this.note(lang, ctx);
        out[`message_${lang}`] = this.message(lang, ctx);
      }
      out[`followup_${lang}`] = this.followup(lang, ctx);
    }
    return out;
  }

  private pick(pair: Pair, lang: Lang): string {
    return lang === "ar" ? pair[0] : pair[1];
  }

  private myRole(lang: Lang): string {
    const me = this.profile.me;
    const role = me.current_role.trim() || (me.target_roles[0] ?? "").trim();
    return role || (lang === "ar" ? "مهتم بمجالك" : "working in a related field");
  }

  private yearsPhrase(lang: Lang): string {
    const y = Math.floor(Number(this.profile.me.years_experience) || 0);
    if (y <= 0) return "";
    if (lang === "en") return ` with ${y}+ years of experience`;
    if (y === 1) return " وعندي خبرة سنة";
    if (y === 2) return " وعندي خبرة سنتين";
    return y <= 10 ? ` وعندي خبرة ${y} سنوات` : ` وعندي خبرة ${y} سنة`;
  }

  private skills(lang: Lang): string {
    const list = this.profile.me.top_skills.map((s) => s.trim()).filter(Boolean).slice(0, 3);
    if (list.length === 0) return "";
    if (lang === "ar") return list.join("، ");
    return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0] ?? "";
  }

  private highlight(lang: Lang): string {
    return (lang === "ar" ? this.profile.me.highlight_ar : this.profile.me.highlight_en).trim();
  }

  private cvLine(lang: Lang): string {
    const { cv_link: cv, portfolio_link: pf } = this.profile.me;
    const bits: string[] = [];
    if (cv.trim()) bits.push(lang === "ar" ? `سيرتي الذاتية: ${cv.trim()}` : `CV: ${cv.trim()}`);
    if (pf.trim()) bits.push(lang === "ar" ? `أعمالي: ${pf.trim()}` : `Portfolio: ${pf.trim()}`);
    return bits.join("\n");
  }

  private signature(lang: Lang): string {
    const m = this.profile.messaging;
    const sig = (lang === "ar" ? m.signature_ar : m.signature_en).trim();
    return sig || this.profile.me.first_name.trim() || this.profile.me.full_name.trim();
  }

  private greeting(name: string, lang: Lang): string {
    if (lang === "ar") return name ? `مرحبًا ${name}،` : "مرحبًا،";
    return name ? `Hi ${name},` : "Hello,";
  }

  private atCompany(company: string, lang: Lang): string {
    if (!company) return "";
    return lang === "ar" ? ` في ${company}` : ` at ${company}`;
  }

  private theirRolePhrase(role: string, company: string, lang: Lang): string {
    const ar = lang === "ar";
    if (role && company) return ar ? `دورك كـ ${role} في ${company}` : `your work as ${role} at ${company}`;
    if (role) return ar ? `دورك كـ ${role}` : `your work as ${role}`;
    if (company) return ar ? `شغلك في ${company}` : `your work at ${company}`;
    return ar ? "شغلك" : "your work";
  }

  private ask(archetype: Archetype, lang: Lang): string {
    return this.pick(this.profile.targeting.goal === "job_search" ? JOB_ASK[archetype] : GENERAL_ASK, lang);
  }

  private aboutMeBlock(lang: Lang, prefix: string): string[] {
    const lines = [prefix];
    const h = this.highlight(lang);
    if (h) lines.push(sentence(h, lang));
    return lines;
  }

  private closing(lang: Lang, ask: string, thanks: string): string[] {
    const lines = ["", ask];
    const cv = this.cvLine(lang);
    if (cv) lines.push("", cv);
    lines.push("", thanks, this.signature(lang));
    return lines;
  }

  private finish(lines: string[]): string {
    return clip(tidy(lines.join("\n")), this.messageLimit);
  }

  private reconnect(lang: Lang, ctx: MessageContext): string {
    const since = sincePhrase(ctx.daysSince, lang);
    const role = this.theirRolePhrase(ctx.theirRole, ctx.company, lang);
    const ask = this.ask(ctx.archetype, lang);
    if (lang === "ar") {
      return this.finish([
        this.greeting(ctx.greetingName, lang), "",
        `آخر تواصل بينا كان ${since}، وحبيت أرجع أطل عليك.`, "",
        `شفت ${role}، وبتابع شغلكم باهتمام.`, "",
        ...this.aboutMeBlock(lang, `من جهتي، أنا هلأ ${this.myRole(lang)}${this.yearsPhrase(lang)}.`),
        ...this.closing(lang, ask, "شكرًا لوقتك،"),
      ]);
    }
    return this.finish([
      this.greeting(ctx.greetingName, lang), "",
      `We last spoke ${since}, so I wanted to reconnect.`, "",
      `I saw ${role} and I follow your work with real interest.`, "",
      ...this.aboutMeBlock(lang, `On my side, I am now ${this.myRole(lang)}${this.yearsPhrase(lang)}.`),
      ...this.closing(lang, ask, "Thanks for your time,"),
    ]);
  }

  private reconnectShort(lang: Lang, ctx: MessageContext): string {
    const since = sincePhrase(ctx.daysSince, lang);
    const at = this.atCompany(ctx.company, lang);
    const core = lang === "ar"
      ? `آخر تواصل بينا كان ${since} - حبيت أطل عليك وأشوف كيف ماشي الشغل${at}.`
      : `We last spoke ${since} - just checking in to see how things are going${at}.`;
    return clip(`${this.greeting(ctx.greetingName, lang)} ${core}`, this.noteLimit);
  }

  private nudge(lang: Lang, ctx: MessageContext): string {
    const since = sincePhrase(ctx.daysSince, lang);
    const g = this.greeting(ctx.greetingName, lang);
    if (lang === "ar") {
      return this.finish([
        g, "", `كنت بعتتلك رسالة ${since} وما بعرف إذا وصلتك وسط الزحمة.`, "",
        "إذا الوقت مش مناسب بتفهم تمامًا وما بدي أثقل عليك. وإذا في مجال، رد بسطر واحد بكفي.", "",
        "شكرًا على أي حال،", this.signature(lang),
      ]);
    }
    return this.finish([
      g, "", `I sent you a message ${since} and I am not sure it reached you.`, "",
      "If the timing is not right I completely understand and will not keep pushing. If there is room, even a one-line reply is plenty.", "",
      "Thanks either way,", this.signature(lang),
    ]);
  }

  private nudgeShort(lang: Lang, ctx: MessageContext): string {
    const since = sincePhrase(ctx.daysSince, lang);
    const core = lang === "ar"
      ? `بس برجع أذكّرك برسالتي ${since} - إذا الوقت مش مناسب بتفهم تمامًا.`
      : `Just following up on my message from ${since} - if the timing is off, no problem at all.`;
    return clip(`${this.greeting(ctx.greetingName, lang)} ${core}`, this.noteLimit);
  }

  private note(lang: Lang, ctx: MessageContext): string {
    const role = this.myRole(lang);
    const at = this.atCompany(ctx.company, lang);
    const ar: Record<Archetype, string> = {
      recruiter: `أنا ${role} وبتابع الشواغر${at}. حبيت أتواصل معك ويكون اسمي بين يديك.`,
      hiring_manager: `أنا ${role} ومهتم بشغل فريقك${at}. حبيت أضيفك لشبكتي.`,
      senior_leader: `أنا ${role} ومتابع لشغلكم${at}. بشرف لي أضيفك لشبكتي.`,
      founder: `أنا ${role} ومعجب بالي بتبنوه${at}. حبيت أتواصل معك.`,
      peer: `أنا ${role} وشغلك قريب من مجالي. حبيت نبقى على تواصل.`,
      academic: `أنا ${role} ومهتم بالمجال الي بتشتغل فيه. حبيت نبقى على تواصل.`,
      generic: `أنا ${role} وحبيت أضيفك لشبكتي المهنية${at}.`,
    };
    const en: Record<Archetype, string> = {
      recruiter: `I am ${role}, currently exploring openings${at} - would like to connect and be on your radar.`,
      hiring_manager: `I am ${role} and I follow the work your team does${at}. Would be glad to connect.`,
      senior_leader: `I am ${role} and have been following your work${at}. It would be a pleasure to connect.`,
      founder: `I am ${role} and I like what you are building${at}. Would love to connect.`,
      peer: `I am ${role} - your work is close to my field, so I would like to stay connected.`,
      academic: `I am ${role} and interested in the field you work in. Would like to stay connected.`,
      generic: `I am ${role} and would like to add you to my professional network${at}.`,
    };
    const core = (lang === "ar" ? ar : en)[ctx.archetype];
    return clip(`${this.greeting(ctx.greetingName, lang)} ${core}`, this.noteLimit);
  }

  private message(lang: Lang, ctx: MessageContext): string {
    const role = this.theirRolePhrase(ctx.theirRole, ctx.company, lang);
    const angle = this.pick(INDUSTRY_ANGLE[ctx.industry] ?? INDUSTRY_ANGLE.Unknown!, lang);
    const fn = this.pick(FUNCTION_ANGLE[ctx.function] ?? FUNCTION_ANGLE.Unknown!, lang);
    const skills = this.skills(lang);
    const ask = this.ask(ctx.archetype, lang);
    const g = this.greeting(ctx.greetingName, lang);

    if (lang === "ar") {
      const opener: Record<Archetype, string> = {
        recruiter: `لاحظت ${role}، والتوظيف في مجال ${fn} تحديدًا الي بدور عليه.`,
        hiring_manager: `تابعت ${role}، و${angle}.`,
        senior_leader: `تابعت ${role}، و${angle}.`,
        founder: `شدني ${role}، و${angle}.`,
        peer: `شفت ${role}، واشتغالنا في نفس المجال (${fn}) خلاني أحب أتواصل معك.`,
        academic: `شفت ${role}، والمجال مشترك بيننا.`,
        generic: `شفت ${role}، و${angle}.`,
      };
      const about = `أنا ${this.myRole(lang)}${this.yearsPhrase(lang)}${skills ? `، وأقرب مهاراتي: ${skills}` : ""}.`;
      return this.finish([g, "", opener[ctx.archetype], "", ...this.aboutMeBlock(lang, about), ...this.closing(lang, ask, "شكرًا لوقتك،")]);
    }
    const opener: Record<Archetype, string> = {
      recruiter: `I came across ${role}, and ${fn} is exactly the space I am targeting.`,
      hiring_manager: `I have been following ${role} - ${angle}.`,
      senior_leader: `I have been following ${role} - ${angle}.`,
      founder: `${capitalize(role)} caught my attention - ${angle}.`,
      peer: `I saw ${role}, and since we both work in ${fn} I wanted to reach out.`,
      academic: `I saw ${role} and we share the same field of interest.`,
      generic: `I saw ${role} - ${angle}.`,
    };
    const about = `I am ${this.myRole(lang)}${this.yearsPhrase(lang)}${skills ? `, and my strongest skills are ${skills}` : ""}.`;
    return this.finish([g, "", opener[ctx.archetype], "", ...this.aboutMeBlock(lang, about), ...this.closing(lang, ask, "Thanks for your time,")]);
  }

  private followup(lang: Lang, ctx: MessageContext): string {
    const g = this.greeting(ctx.greetingName, lang);
    const body = lang === "ar"
      ? "بس بذكرك برسالتي السابقة - بتفهم إذا الوقت مش مناسب. إذا في أي شي أقدر أساعد فيه من طرفي، أنا جاهز. شكرًا!"
      : "Just a gentle nudge on my earlier message - I completely understand if the timing is off. If there is anything I can help with on my side, happy to. Thank you!";
    return tidy(`${g}\n\n${body}`);
  }
}

export function profileGaps(profile: Profile): string[] {
  const me = profile.me;
  const gaps: string[] = [];
  const required: Array<[keyof typeof me, string]> = [
    ["full_name", "your name"],
    ["current_role", "your current/target role"],
    ["top_skills", "top skills"],
  ];
  const recommended: Array<[keyof typeof me, string]> = [
    ["years_experience", "years of experience"],
    ["highlight_ar", "one-line achievement (Arabic)"],
    ["highlight_en", "one-line achievement (English)"],
    ["cv_link", "CV link"],
    ["target_roles", "target roles"],
  ];
  const empty = (v: unknown): boolean => (Array.isArray(v) ? v.length === 0 : !v);
  for (const [key, label] of required) if (empty(me[key])) gaps.push(`REQUIRED: ${label}`);
  for (const [key, label] of recommended) if (empty(me[key])) gaps.push(`recommended: ${label}`);
  return gaps;
}
