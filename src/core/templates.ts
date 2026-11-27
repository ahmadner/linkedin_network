import { ProfileVoice, sentence } from "./messages";
import type { Contact, Lang } from "./types";

export type TemplateId = "referral" | "job_inquiry" | "advice" | "intro" | "thanks";

export const TEMPLATE_IDS: TemplateId[] = ["referral", "job_inquiry", "advice", "intro", "thanks"];

export const TEMPLATE_LABEL: Record<TemplateId, string> = {
  referral: "طلب إحالة (Referral)",
  job_inquiry: "سؤال عن وظيفة",
  advice: "طلب نصيحة أو مكالمة قصيرة",
  intro: "تعارف",
  thanks: "شكر",
};

export const TEMPLATE_PURPOSE: Record<TemplateId, string> = {
  referral: "Ask the recipient to refer the user for a specific role at their company, and make it easy to say yes.",
  job_inquiry: "Ask whether the recipient's company or team is hiring for the user's target role, without assuming there is an opening.",
  advice: "Ask for short advice or a 15-minute call about the recipient's company, team or career path.",
  intro: "Introduce the user and start a relationship, with no ask beyond staying in touch.",
  thanks: "Thank the recipient for their help, time or reply, and keep the door open.",
};

export const TEMPLATES_WITH_JOB = new Set<TemplateId>(["referral", "job_inquiry"]);

export interface TemplateExtra {
  jobTitle: string;
  jobLink: string;
}

export interface TemplateText {
  ar: string;
  en: string;
}

export class TemplateBuilder extends ProfileVoice {
  build(id: TemplateId, c: Contact, extra: TemplateExtra): TemplateText {
    return { ar: this.render(id, c, extra, "ar"), en: this.render(id, c, extra, "en") };
  }

  private targetRole(extra: TemplateExtra, lang: Lang): string {
    return extra.jobTitle.trim() || (this.profile.me.target_roles[0] ?? "").trim() || this.myRole(lang);
  }

  private jobLine(extra: TemplateExtra, lang: Lang): string {
    const link = extra.jobLink.trim();
    if (!link) return "";
    return lang === "ar" ? `رابط الوظيفة: ${link}` : `Job link: ${link}`;
  }

  private aboutMe(lang: Lang): string[] {
    const skills = this.skills(lang);
    const line = lang === "ar"
      ? `أنا ${this.myRole(lang)}${this.yearsPhrase(lang)}${skills ? `، وأقوى مهاراتي: ${skills}` : ""}.`
      : `I am ${this.roleWithArticle()}${this.yearsPhrase(lang)}${skills ? `, and my strongest skills are ${skills}` : ""}.`;
    const h = this.highlight(lang);
    return h ? [line, sentence(h, lang)] : [line];
  }

  private end(lang: Lang, thanks: string, withLinks: boolean): string[] {
    const lines: string[] = [];
    const cv = withLinks ? this.cvLine(lang) : "";
    if (cv) lines.push("", cv);
    lines.push("", thanks, this.signature(lang));
    return lines;
  }

  private render(id: TemplateId, c: Contact, extra: TemplateExtra, lang: Lang): string {
    const ar = lang === "ar";
    const g = this.greeting(c.greetingName, lang);
    const company = c.companyClean;
    const at = this.atCompany(company, lang);
    const role = this.targetRole(extra, lang);
    const job = this.jobLine(extra, lang);
    const theirs = this.theirRolePhrase(c.positionPrimary || c.positionClean, company, lang);
    const contacted = c.contactedBefore;

    switch (id) {
      case "referral":
        return this.finish(ar
          ? [g, "", contacted ? "بتمنى تكون بخير، وشكرًا إنك دايمًا متعاون." : `شفت ${theirs}، وحبيت أتواصل معك بطلب صغير.`, "",
            `بقدّم على دور ${role}${at}، وبحكم إنك جوا الشركة، إحالتك (Referral) بتفرق كثير.`, ...(job ? [job] : []), "",
            ...this.aboutMe(lang), "",
            "إذا مرتاح لهالشي، ببعتلك السيرة وأي معلومة بتحتاجها عشان أسهّل عليك. وإذا مش مناسب، بفهم تمامًا.",
            ...this.end(lang, "شكرًا كثير على وقتك،", true)]
          : [g, "", contacted ? "I hope you are doing well, and thanks again for always being helpful." : `I came across ${theirs} and wanted to reach out with a small ask.`, "",
            `I am applying for the ${role} role${at}, and a referral from someone inside would make a real difference.`, ...(job ? [job] : []), "",
            ...this.aboutMe(lang), "",
            "If you are comfortable with it, I can send my CV and anything else that makes it easy for you. If not, I completely understand.",
            ...this.end(lang, "Thank you so much for your time,", true)]);
      case "job_inquiry":
        return this.finish(ar
          ? [g, "", `شفت ${theirs}، وحبيت أسألك سؤال سريع.`, "",
            `بدور على فرصة كـ ${role}، وبتساءل إذا ${company ? `${company} أو فريقكم` : "فريقكم"} بيوظّف حاليًا أو قريبًا بهالمجال.`, ...(job ? [job] : []), "",
            ...this.aboutMe(lang), "",
            "إذا في شي مناسب، أو إذا في شخص أحسن أحكي معه، بكون ممتن لو تدلني.",
            ...this.end(lang, "شكرًا لوقتك،", true)]
          : [g, "", `I came across ${theirs} and wanted to ask a quick question.`, "",
            `I am looking for a ${role} role, and I was wondering whether ${company ? `${company} or your team` : "your team"} is hiring in this area now or soon.`, ...(job ? [job] : []), "",
            ...this.aboutMe(lang), "",
            "If there is something suitable, or a better person for me to talk to, I would be grateful for a pointer.",
            ...this.end(lang, "Thanks for your time,", true)]);
      case "advice":
        return this.finish(ar
          ? [g, "", `شفت ${theirs}، وعندي فضول أعرف أكثر عن تجربتك.`, "",
            ...this.aboutMe(lang), "",
            `بحب آخذ رأيك بخطوتي الجاية نحو دور ${role}${company ? `، وكيف الشغل${at} من جوا` : ""}. إذا عندك 15 دقيقة مكالمة هالأسبوع أو الجاي، بكون ممتن، وبمشي على الوقت الي بناسبك.`,
            ...this.end(lang, "شكرًا مقدمًا،", false)]
          : [g, "", `I came across ${theirs} and I am curious to learn more about your experience.`, "",
            ...this.aboutMe(lang), "",
            `I would value your view on my next step towards a ${role} role${company ? `, and what working${at} is like from the inside` : ""}. If you have 15 minutes for a call this week or next, I would be grateful, and I will work around your schedule.`,
            ...this.end(lang, "Thanks in advance,", false)]);
      case "intro":
        return this.finish(ar
          ? [g, "", `شفت ${theirs}، وحبيت أعرّفك على حالي.`, "",
            ...this.aboutMe(lang), "",
            "ما عندي طلب معين، بس بحب نبقى على تواصل ونتبادل الخبرات. وإذا في شي أقدر أساعد فيه من طرفي، أنا جاهز.",
            ...this.end(lang, "تشرفت فيك،", false)]
          : [g, "", `I came across ${theirs} and wanted to introduce myself.`, "",
            ...this.aboutMe(lang), "",
            "No specific ask - I would just like to stay in touch and swap notes. And if there is anything I can help with on my side, happy to.",
            ...this.end(lang, "Nice to meet you,", false)]);
      case "thanks":
        return this.finish(ar
          ? [g, "", "حبيت أشكرك من قلبي على وقتك ومساعدتك، فرقت معي فعلًا.", "",
            "رح أخبرك بالتطورات، وإذا احتجت أي شي من طرفي، أنا موجود.",
            ...this.end(lang, "شكرًا مرة ثانية،", false)]
          : [g, "", "I wanted to say a genuine thank you for your time and help - it really made a difference.", "",
            "I will keep you posted on how things go, and if you ever need anything from my side, I am here.",
            ...this.end(lang, "Thanks again,", false)]);
    }
  }
}
