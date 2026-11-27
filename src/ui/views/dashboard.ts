import { countBy, messageActivity, networkGrowth, replyStats } from "../../core/stats";
import { buildWorkbook, XLSX_TYPE, type Column } from "../../io/excel";
import { columnChart } from "../charts";
import { card, exportLinks, MODE_AR, type Ctx } from "../context";
import { download, fmtNumber, h } from "../dom";

type Count = [string, number];

const COUNT_COLUMNS: Array<Column<Count>> = [["Label", ([label]) => label, 36], ["Count", ([, n]) => n, 10]];

function barFill(ratio: number): HTMLElement {
  const el = h("span", { class: "bar" });
  el.style.inlineSize = `${Math.round(ratio * 100)}%`;
  return el;
}

function bars(ctx: Ctx, title: string, name: string, all: Count[], limit = 12, note = ""): HTMLElement {
  const data = all.slice(0, limit);
  const max = Math.max(1, ...data.map(([, n]) => n));
  return h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", {}, title), exportLinks(ctx, name, COUNT_COLUMNS, () => all)),
    note ? h("p", { class: "muted small" }, note) : null,
    data.length === 0 ? h("p", { class: "muted" }, "ما في بيانات") : h("ul", { class: "bars" }, data.map(([label, n]) =>
      h("li", {}, h("span", { class: "bar-label", title: label, dir: "auto" }, label), h("span", { class: "bar-track" }, barFill(n / max)), h("span", { class: "bar-value" }, fmtNumber(n))))),
  );
}

export function renderDashboard(ctx: Ctx): HTMLElement {
  if (!ctx.store.hasData) return h("div", { class: "view" }, card("ما في بيانات لسا", h("p", {}, "ارفع ملف الـ Export أول.")));
  const { contacts, companies } = ctx.store.analysis;
  const messages = ctx.store.state.dataset.messages;
  const kpi = (label: string, value: string, note: string): HTMLElement => h("div", { class: "kpi" }, h("span", {}, label), h("strong", {}, value), h("small", {}, note));
  const n = (value: number): string => fmtNumber(value);
  const exportExcel = async (): Promise<void> => {
    const buffer = await ctx.busy("تجهيز ملف Excel…", () => buildWorkbook(ctx.store.analysis, ctx.store.state.profile));
    if (buffer) download(`linkedin_network_${new Date().toISOString().slice(0, 10)}.xlsx`, buffer, XLSX_TYPE);
  };

  const growth = networkGrowth(contacts, 36);
  const lastYear = growth.slice(-12).reduce((sum, p) => sum + p.added, 0);
  const activity = messageActivity(messages, 18);
  const replies = replyStats(contacts);
  const countries = countBy(contacts, (c) => c.country);
  const knownCountries = countries.filter(([k]) => k !== "Unknown");
  const unknownCountries = contacts.length - knownCountries.reduce((sum, [, v]) => sum + v, 0);
  const tags = countBy(contacts.flatMap((c) => c.tracking.tags), (t) => t);
  const years = countBy(contacts.filter((c) => c.connectedDate), (c) => (c.connectedDate ?? "").slice(0, 4)).sort((a, b) => b[0].localeCompare(a[0]));

  return h("div", { class: "view" },
    h("div", { class: "row end" }, h("button", { type: "button", onclick: () => void exportExcel() }, "تنزيل تقرير Excel كامل")),
    h("div", { class: "kpis" },
      kpi("كل الأشخاص", n(contacts.length), "بعد دمج المكرر"),
      kpi("آخر 12 شهر", n(lastYear), "أشخاص جدد بشبكتك"),
      kpi("أولوية A", n(contacts.filter((c) => c.bucket === "A").length), "ابدأ فيهم"),
      kpi("أولوية B", n(contacts.filter((c) => c.bucket === "B").length), "الموجة الثانية"),
      kpi("أول تواصل", n(contacts.filter((c) => c.mode === "cold").length), "ما في رسالة بينكم"),
      kpi("تواصلنا قبل", n(contacts.filter((c) => c.contactedBefore).length), "في رسالة أو دعوة"),
      kpi("بانتظار رد", n(contacts.filter((c) => c.mode === "nudge").length), "بعتت وما رد"),
      kpi("نسبة الرد", `${replies.rate}%`, `${n(replies.replied)} من ${n(replies.messaged)} راسلتهم`),
      kpi("Recruiters / HR", n(contacts.filter((c) => c.isRecruiter).length), "قناة توظيف مباشرة"),
      kpi("أصحاب قرار", n(contacts.filter((c) => c.isDecisionMaker).length), "Manager وأعلى"),
      kpi("شركات", n(companies.length), "أصحاب عمل مختلفين"),
      kpi("إيميلات", n(contacts.filter((c) => c.emailValid).length), "تواصل خارج LinkedIn"),
    ),
    h("div", { class: "cards-grid" },
      h("section", { class: "card wide" },
        h("div", { class: "card-head" }, h("h2", {}, "نمو الشبكة (أشخاص جدد كل شهر)"),
          exportLinks(ctx, "network-growth", [["Month", (p) => p.month, 10], ["Added", (p) => p.added, 10], ["Total", (p) => p.total, 10]], () => networkGrowth(contacts, Infinity))),
        growth.length === 0 ? h("p", { class: "muted" }, "ما في تواريخ اتصال") : columnChart("نمو الشبكة", [{ name: "أشخاص جدد", className: "s1" }], growth.map((p) => ({ label: p.month, values: [p.added] }))),
        growth.length > 0 ? h("p", { class: "muted small" }, `المجموع حتى ${growth[growth.length - 1]!.month}: ${n(growth[growth.length - 1]!.total)}`) : null,
      ),
      h("section", { class: "card wide" },
        h("div", { class: "card-head" }, h("h2", {}, "نشاط الرسائل"),
          exportLinks(ctx, "message-activity", [["Month", (p) => p.month, 10], ["Sent", (p) => p.sent, 10], ["Received", (p) => p.received, 10]], () => messageActivity(messages, Infinity))),
        activity.length === 0 ? h("p", { class: "muted" }, "ما في رسائل لسا") : columnChart("نشاط الرسائل", [{ name: "بعتت", className: "s1" }, { name: "وصلني", className: "s2" }], activity.map((p) => ({ label: p.month, values: [p.sent, p.received] }))),
      ),
      bars(ctx, "حسب المستوى", "by-seniority", countBy(contacts, (c) => c.seniority)),
      bars(ctx, "حسب التخصص", "by-function", countBy(contacts, (c) => c.function)),
      bars(ctx, "حسب القطاع", "by-industry", countBy(contacts, (c) => c.industry)),
      bars(ctx, "أكثر الشركات", "by-company", companies.map((r): Count => [r.name, r.count]), 15),
      bars(ctx, "حسب الدولة", "by-country", knownCountries, 12, `الدولة بتنعرف من رابط البروفايل بس، فـ ${n(unknownCountries)} شخص مش معروفة دولتهم.`),
      bars(ctx, "حالة التواصل", "by-mode", countBy(contacts, (c) => MODE_AR[c.mode] ?? c.mode)),
      bars(ctx, "سنة الاتصال", "by-year", years, 15),
      bars(ctx, "الوسوم", "by-tag", tags, 15),
    ),
  );
}
