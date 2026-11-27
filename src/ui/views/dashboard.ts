import type { Contact } from "../../core/types";
import { buildWorkbook } from "../../io/excel";
import { card, MODE_AR, type Ctx } from "../context";
import { download, fmtNumber, h } from "../dom";

function counts(contacts: Contact[], key: (c: Contact) => string, limit = 12): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const c of contacts) {
    const k = key(c) || "Unknown";
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function barFill(ratio: number): HTMLElement {
  const el = h("span", { class: "bar" });
  el.style.inlineSize = `${Math.round(ratio * 100)}%`;
  return el;
}

function bars(title: string, data: Array<[string, number]>): HTMLElement {
  const max = Math.max(1, ...data.map(([, n]) => n));
  return card(title, h("ul", { class: "bars" }, data.map(([label, n]) =>
    h("li", {}, h("span", { class: "bar-label" }, label), h("span", { class: "bar-track" }, barFill(n / max)), h("span", { class: "bar-value" }, fmtNumber(n))))));
}

export function renderDashboard(ctx: Ctx): HTMLElement {
  if (!ctx.store.hasData) return h("div", { class: "view" }, card("ما في بيانات لسا", h("p", {}, "ارفع ملف الـ Export أول.")));
  const { contacts, companies } = ctx.store.analysis;
  const kpi = (label: string, value: number, note: string): HTMLElement => h("div", { class: "kpi" }, h("span", {}, label), h("strong", {}, fmtNumber(value)), h("small", {}, note));
  const exportExcel = async (): Promise<void> => {
    const buffer = await ctx.busy("تجهيز ملف Excel…", () => buildWorkbook(ctx.store.analysis, ctx.store.state.profile));
    if (buffer) download(`linkedin_network_${new Date().toISOString().slice(0, 10)}.xlsx`, buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  };
  const years = counts(contacts.filter((c) => c.connectedDate), (c) => (c.connectedDate ?? "").slice(0, 4), 12).sort((a, b) => b[0].localeCompare(a[0]));
  return h("div", { class: "view" },
    h("div", { class: "row end" }, h("button", { type: "button", onclick: () => void exportExcel() }, "تنزيل تقرير Excel كامل")),
    h("div", { class: "kpis" },
      kpi("كل الأشخاص", contacts.length, "بعد دمج المكرر"),
      kpi("أولوية A", contacts.filter((c) => c.bucket === "A").length, "ابدأ فيهم"),
      kpi("أولوية B", contacts.filter((c) => c.bucket === "B").length, "الموجة الثانية"),
      kpi("أول تواصل", contacts.filter((c) => c.mode === "cold").length, "ما في رسالة بينكم"),
      kpi("تواصلنا قبل", contacts.filter((c) => c.contactedBefore).length, "في رسالة أو دعوة"),
      kpi("بانتظار رد", contacts.filter((c) => c.mode === "nudge").length, "بعتت وما رد"),
      kpi("Recruiters / HR", contacts.filter((c) => c.isRecruiter).length, "قناة توظيف مباشرة"),
      kpi("أصحاب قرار", contacts.filter((c) => c.isDecisionMaker).length, "Manager وأعلى"),
      kpi("شركات", companies.length, "أصحاب عمل مختلفين"),
      kpi("إيميلات", contacts.filter((c) => c.emailValid).length, "تواصل خارج LinkedIn"),
    ),
    h("div", { class: "cards-grid" },
      bars("حسب المستوى", counts(contacts, (c) => c.seniority)),
      bars("حسب التخصص", counts(contacts, (c) => c.function)),
      bars("حسب القطاع", counts(contacts, (c) => c.industry)),
      bars("أكثر الشركات", companies.slice(0, 12).map((r): [string, number] => [r.name, r.count])),
      bars("حالة التواصل", counts(contacts, (c) => MODE_AR[c.mode] ?? c.mode)),
      bars("سنة الاتصال", years),
    ),
  );
}
