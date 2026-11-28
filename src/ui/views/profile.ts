import { FUNCTION_LABELS, INDUSTRY_LABELS } from "../../core/classify";
import { asStringList } from "../../core/profile";
import { DEFAULT_WEIGHTS } from "../../core/scoring";
import type { Goal, MeProfile } from "../../core/types";
import { card, type Ctx } from "../context";
import { field, h, numberInput, select, textArea, textInput } from "../dom";

const ME_FIELDS: Array<[keyof MeProfile, string, "text" | "list" | "number" | "area"]> = [
  ["full_name", "اسمك الكامل (English)", "text"],
  ["first_name", "اسمك الأول (English، للتوقيع)", "text"],
  ["full_name_ar", "اسمك الكامل بالعربي", "text"],
  ["first_name_ar", "اسمك الأول بالعربي (للتوقيع)", "text"],
  ["headline", "الـ Headline", "text"],
  ["current_role", "دورك الحالي أو المستهدف", "text"],
  ["current_company", "شركتك الحالية", "text"],
  ["years_experience", "سنوات الخبرة", "number"],
  ["location", "مكانك", "text"],
  ["target_roles", "الأدوار الي بتدور عليها (افصل بفاصلة)", "list"],
  ["top_skills", "أهم مهاراتك (أول 3 بتظهر بالرسالة)", "list"],
  ["highlight_ar", "إنجاز بسطر واحد (عربي)", "area"],
  ["highlight_en", "Achievement in one line (English)", "area"],
  ["cv_link", "رابط السيرة الذاتية", "text"],
  ["portfolio_link", "رابط الأعمال", "text"],
  ["education", "التعليم", "text"],
];

const WEIGHT_AR: Record<string, string> = {
  recruiter: "Recruiter / HR",
  hiring_manager_in_target_function: "صاحب قرار بتخصص مستهدف",
  decision_maker_max: "أقصى نقاط للمنصب",
  target_company: "شركة مستهدفة",
  target_industry: "قطاع مستهدف",
  target_function: "تخصص مستهدف",
  same_function_peer: "تخصص قريب",
  email_available: "إيميل متاح",
  recency_max: "حداثة الاتصال",
  multi_contact_company: "3+ معارف بنفس الشركة",
  penalty_student: "خصم طالب/متدرب",
  penalty_no_company: "خصم بدون شركة",
  penalty_awaiting_reply: "خصم بعتت وما رد",
  penalty_contacted_recently: "خصم تواصل خلال 30 يوم",
};

const GOALS: Array<[Goal, string]> = [
  ["job_search", "بدور على شغل"],
  ["sales", "مبيعات"],
  ["partnership", "شراكات"],
  ["networking", "توسيع الشبكة"],
];

const lines = (v: string): string[] => v.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 500);

function checklist(all: string[], selected: string[], onChange: (v: string[]) => void): HTMLElement {
  const chosen = new Set(selected);
  return h("div", { class: "checks" }, all.filter((l) => l !== "Unknown").map((label) => {
    const box = h("input", { type: "checkbox", checked: chosen.has(label) });
    box.addEventListener("change", () => {
      if (box.checked) chosen.add(label);
      else chosen.delete(label);
      onChange(all.filter((l) => chosen.has(l)));
    });
    return h("label", { class: "check" }, box, " ", label);
  }));
}

function overridesEditor(ctx: Ctx): HTMLElement {
  const rows = Object.entries(ctx.store.state.overrides).sort((a, b) => a[0].localeCompare(b[0]));
  const company = h("input", { type: "text", placeholder: "اسم الشركة", "aria-label": "اسم الشركة" });
  const industry = select(INDUSTRY_LABELS.filter((l) => l !== "Unknown").map((l) => [l, l]), "Software & IT Services", () => undefined, { "aria-label": "القطاع" });
  const add = (): void => {
    const key = company.value.trim().toLowerCase();
    if (!key) return;
    ctx.store.update((s) => (s.overrides[key] = industry.value));
  };
  return h("div", {},
    h("table", { class: "grid compact" },
      h("thead", {}, h("tr", {}, h("th", {}, "الشركة"), h("th", {}, "القطاع"), h("th", {}, h("span", { class: "sr-only" }, "إجراء")))),
      h("tbody", {}, rows.map(([k, v]) => h("tr", {}, h("td", {}, k), h("td", {}, v), h("td", {},
        h("button", { type: "button", class: "link", onclick: () => ctx.store.update((s) => delete s.overrides[k]) }, "حذف"))))),
    ),
    h("div", { class: "row" }, company, industry, h("button", { type: "button", class: "secondary", onclick: add }, "إضافة")),
  );
}

export function renderProfile(ctx: Ctx): HTMLElement {
  const { profile } = ctx.store.state;
  const setMe = <K extends keyof MeProfile>(key: K, value: MeProfile[K]): void => ctx.store.update((s) => (s.profile.me[key] = value));

  const meFields = ME_FIELDS.map(([key, label, kind]) => {
    const value = profile.me[key];
    if (kind === "number") return field(label, numberInput(Number(value) || 0, (v) => setMe(key, Math.max(0, v) as MeProfile[typeof key]), { min: 0, max: 60 }));
    if (kind === "list") return field(label, textInput((value as string[]).join(", "), (v) => setMe(key, asStringList(v) as MeProfile[typeof key])));
    if (kind === "area") return field(label, textArea(String(value), (v) => setMe(key, v as MeProfile[typeof key]), { rows: 2 }));
    return field(label, textInput(String(value), (v) => setMe(key, v as MeProfile[typeof key])));
  });

  const t = profile.targeting;
  const weights = Object.keys(DEFAULT_WEIGHTS).map((key) =>
    field(WEIGHT_AR[key] ?? key, numberInput(t.weights[key] ?? DEFAULT_WEIGHTS[key] ?? 0, (v) => ctx.store.update((s) => (s.profile.targeting.weights[key] = v)), { step: 1 })));

  return h("div", { class: "view" },
    card("ملفي", h("p", { class: "muted" }, "كل رسالة وكل نقطة أولوية مبنية على هاد الملف. إذا رفعت الـ Export، الحقول الفاضية بتتعبى من بروفايلك تلقائيًا."), h("div", { class: "form-grid" }, meFields)),
    card("الرسائل",
      h("div", { class: "form-grid" },
        field("التوقيع بالعربي", textInput(profile.messaging.signature_ar, (v) => ctx.store.update((s) => (s.profile.messaging.signature_ar = v)))),
        field("Signature (English)", textInput(profile.messaging.signature_en, (v) => ctx.store.update((s) => (s.profile.messaging.signature_en = v)))),
        field("حد أحرف النوت", numberInput(profile.messaging.note_char_limit, (v) => ctx.store.update((s) => (s.profile.messaging.note_char_limit = Math.min(3000, Math.max(50, v)))), { min: 50, max: 3000 }), "الحساب المجاني: 200 حرف"),
        field("حد أحرف الرسالة", numberInput(profile.messaging.message_char_limit, (v) => ctx.store.update((s) => (s.profile.messaging.message_char_limit = Math.min(8000, Math.max(200, v)))), { min: 200, max: 8000 })),
      ),
    ),
    card("الأهداف",
      field("الهدف", select(GOALS, t.goal, (v) => ctx.store.update((s) => (s.profile.targeting.goal = v as Goal)))),
      h("h3", {}, "التخصصات المستهدفة"),
      checklist(FUNCTION_LABELS, t.target_functions, (v) => ctx.store.update((s) => (s.profile.targeting.target_functions = v))),
      h("h3", {}, "القطاعات المستهدفة"),
      checklist(INDUSTRY_LABELS, t.target_industries, (v) => ctx.store.update((s) => (s.profile.targeting.target_industries = v))),
      h("div", { class: "form-grid" },
        field("شركات أحلامك (سطر لكل شركة)", textArea(t.target_companies.join("\n"), (v) => ctx.store.update((s) => (s.profile.targeting.target_companies = lines(v))), { rows: 4 })),
        field("شركات مستثناة (سطر لكل شركة)", textArea(t.excluded_companies.join("\n"), (v) => ctx.store.update((s) => (s.profile.targeting.excluded_companies = lines(v))), { rows: 4 })),
      ),
    ),
    card("أوزان النقاط والفئات",
      h("div", { class: "form-grid narrow" }, weights),
      h("div", { class: "form-grid narrow" },
        (["A", "B", "C"] as const).map((b) => field(`حد الفئة ${b}`, numberInput(t.buckets[b], (v) => ctx.store.update((s) => (s.profile.targeting.buckets[b] = v)), { min: 0, max: 100 })))),
    ),
    card("تصحيح قطاع شركة", h("p", { class: "muted" }, "التصحيح بيسري على كل الأشخاص بنفس الشركة."), overridesEditor(ctx)),
  );
}
