import { card, noData, type Ctx } from "../context";
import { fmtNumber, h } from "../dom";

export function renderQuality(ctx: Ctx): HTMLElement {
  if (!ctx.store.hasData) return noData(ctx);
  const { contacts, quality, profileGaps } = ctx.store.analysis;
  const count = (fn: (c: (typeof contacts)[number]) => boolean): string => fmtNumber(contacts.filter(fn).length);
  const rows: Array<[string, string]> = [
    ["المصادر", quality.sources.join(" · ") || "—"],
    ["صاحب الحساب", `${quality.ownerName || "غير معروف"} (${quality.identityMethod})`],
    ["ملفات السجل الموجودة", quality.historyFound.join(", ") || "لا شي"],
    ["ملفات السجل الناقصة", quality.historyMissing.join(", ") || "لا شي"],
    ["سطور الأشخاص (كل المصادر)", fmtNumber(quality.rowsInFile)],
    ["مكرر اندمج", fmtNumber(quality.duplicatesRemoved)],
    ["رسائل", fmtNumber(quality.messagesTotal)],
    ["دعوات", fmtNumber(quality.invitationsTotal)],
    ["سجل يدوي", fmtNumber(quality.logTotal)],
    ["سجل مطابق برابط البروفايل", count((c) => c.historyMatch === "profile URL")],
    ["سجل مطابق بالاسم بس", count((c) => c.historyMatch === "name match")],
    ["بدون شركة", count((c) => !c.companyClean)],
    ["بدون منصب", count((c) => !c.positionClean)],
    ["مستوى غير معروف", count((c) => c.seniority === "Unknown")],
    ["تخصص غير معروف", count((c) => c.function === "Unknown")],
    ["قطاع غير معروف", count((c) => c.industry === "Unknown")],
    ["تصنيفات من AI", count((c) => c.aiClassified)],
  ];
  const flagged = contacts.filter((c) => c.issues.length > 0).slice(0, 500);
  return h("div", { class: "view" },
    profileGaps.length > 0 ? card("نواقص بملفك", h("ul", {}, profileGaps.map((g) => h("li", {}, g))), h("button", { type: "button", class: "secondary", onclick: () => ctx.go("profile") }, "كمّل ملفك")) : null,
    card("مصدر البيانات وجودتها", h("div", { class: "scroll", tabindex: 0, role: "region", "aria-label": "مصدر البيانات وجودتها" }, h("table", { class: "grid compact" }, h("tbody", {}, rows.map(([k, v]) => h("tr", {}, h("th", {}, k), h("td", {}, v))))))),
    quality.warnings.length > 0 ? card("ملاحظات", h("ul", {}, quality.warnings.map((w) => h("li", {}, w)))) : null,
    card("حقول LinkedIn ما بيعطيها",
      h("ul", {},
        h("li", {}, "المدينة والدولة (إلا إذا موجودة برابط البروفايل)"),
        h("li", {}, "رقم الهاتف، عدد المتابعين، ملخص البروفايل، المهارات"),
        h("li", {}, "التاريخ الوظيفي ومدة البقاء بالشركة"),
        h("li", {}, "حجم الشركة وموقعها"),
        h("li", {}, "الأشخاص الجدد من الإضافة بيجوا بالـ Headline بس، فالشركة بتنستنتج منه إذا مكتوبة بصيغة \"Title at Company\""),
      ),
    ),
    flagged.length > 0 ? card(`سطور فيها ملاحظات (${fmtNumber(flagged.length)})`,
      h("div", { class: "scroll short", tabindex: 0, role: "region", "aria-label": "سطور فيها ملاحظات" }, h("table", { class: "grid compact" },
        h("thead", {}, h("tr", {}, h("th", {}, "الاسم"), h("th", {}, "الشركة"), h("th", {}, "الملاحظة"))),
        h("tbody", {}, flagged.map((c) => h("tr", {}, h("td", {}, c.fullName), h("td", {}, c.companyClean), h("td", {}, c.issues.join(", "))))),
      ))) : null,
  );
}
