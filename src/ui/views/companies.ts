import { card, type Ctx } from "../context";
import { fmtNumber, h, replace } from "../dom";

const PAGE_SIZE = 50;
const view = { q: "", page: 0 };

export function renderCompanies(ctx: Ctx): HTMLElement {
  if (!ctx.store.hasData) return h("div", { class: "view" }, card("ما في بيانات لسا", h("p", {}, "ارفع ملف الـ Export أول.")));
  const all = ctx.store.analysis.companies;
  const host = h("div", {});
  const draw = (): void => {
    const q = view.q.toLowerCase();
    const list = q ? all.filter((r) => r.name.toLowerCase().includes(q) || r.industry.toLowerCase().includes(q)) : all;
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    view.page = Math.min(view.page, pages - 1);
    replace(host,
      h("div", { class: "scroll" }, h("table", { class: "grid" },
        h("thead", {}, h("tr", {}, ["الشركة", "القطاع", "معارف", "أعلى نقاط", "أعلى مستوى", "أفضل مدخل", "دوره", "Recruiter؟", "أصحاب قرار", "التخصصات"].map((t) => h("th", {}, t)))),
        h("tbody", {}, list.slice(view.page * PAGE_SIZE, (view.page + 1) * PAGE_SIZE).map((r) => h("tr", {},
          h("td", {}, r.name), h("td", {}, r.industry), h("td", {}, r.count), h("td", {}, r.bestScore), h("td", {}, r.topSeniority),
          h("td", {}, r.topContact), h("td", { class: "clip" }, r.topRole), h("td", {}, r.hasRecruiter ? "Yes" : "No"), h("td", {}, r.decisionMakers),
          h("td", { class: "clip" }, r.functions),
        ))),
      )),
      h("div", { class: "pager" },
        h("button", { type: "button", class: "secondary", disabled: view.page === 0, onclick: () => { view.page -= 1; draw(); } }, "السابق"),
        h("span", {}, `${fmtNumber(list.length)} شركة · صفحة ${view.page + 1} من ${pages}`),
        h("button", { type: "button", class: "secondary", disabled: view.page >= pages - 1, onclick: () => { view.page += 1; draw(); } }, "التالي"),
      ),
    );
  };
  const search = h("input", { type: "search", placeholder: "بحث بالشركة أو القطاع", value: view.q });
  search.addEventListener("input", () => {
    view.q = search.value.trim();
    view.page = 0;
    draw();
  });
  draw();
  return h("div", { class: "view" }, h("div", { class: "toolbar" }, search), host);
}
