import type { CompanyRow, Contact } from "../../core/types";
import { COMPANY_COLUMNS } from "../../io/excel";
import { avatar, badge, exportLinks, noData, type Ctx } from "../context";
import { fmtNumber, h, replace } from "../dom";
import { icon } from "../icons";
import { openContact, searchContacts } from "./contacts";

const PAGE_SIZE = 50;
const view = { q: "", page: 0, recruiters: false };

function bestContacts(contacts: Contact[]): Map<string, Contact> {
  const best = new Map<string, Contact>();
  for (const c of contacts) {
    if (!c.companyKey) continue;
    const current = best.get(c.companyKey);
    if (!current || c.score > current.score) best.set(c.companyKey, c);
  }
  return best;
}

export function renderCompanies(ctx: Ctx): HTMLElement {
  if (!ctx.store.hasData) return noData(ctx);
  const all = ctx.store.analysis.companies;
  const best = bestContacts(ctx.store.analysis.contacts);
  const host = h("div", { class: "view" });
  const draw = (): void => {
    const q = view.q.toLowerCase();
    const list = all.filter((r) => (!view.recruiters || r.hasRecruiter) && (!q || r.name.toLowerCase().includes(q) || r.industry.toLowerCase().includes(q)));
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    view.page = Math.min(view.page, pages - 1);
    const entry = (r: CompanyRow): HTMLElement => {
      const c = best.get(r.key);
      if (!c) return h("span", { class: "muted" }, r.topContact || "—");
      return h("button", { type: "button", class: "task-main", onclick: () => openContact(ctx, c.id) }, avatar(ctx, c),
        h("span", { class: "task-text" }, h("span", { class: "task-name" }, c.fullName), h("span", { class: "task-sub", dir: "auto" }, c.positionPrimary || c.positionClean)));
    };
    replace(host,
      h("div", { class: "bulk" }, h("strong", {}, `${fmtNumber(list.length)} شركة`), exportLinks(ctx, "companies", COMPANY_COLUMNS, () => list)),
      list.length === 0 ? h("div", { class: "card empty" }, h("h2", {}, "ما في شركات بهالبحث"), h("p", { class: "muted" }, "جرّب كلمة ثانية.")) : h("div", { class: "scroll" }, h("table", { class: "grid compact-rows" },
        h("thead", {}, h("tr", {}, ["الشركة", "معارف", "أفضل مدخل", "Recruiter", "أصحاب قرار", "أعلى نقاط"].map((t) => h("th", {}, t)))),
        h("tbody", {}, list.slice(view.page * PAGE_SIZE, (view.page + 1) * PAGE_SIZE).map((r) => h("tr", {},
          h("td", {}, h("span", { class: "person-text" }, h("span", { class: "name", dir: "auto" }, r.name), h("span", { class: "sub" }, r.industry))),
          h("td", {}, h("button", { type: "button", class: "link", title: "شوفهم بجهات الاتصال", onclick: () => searchContacts(ctx, r.name) }, fmtNumber(r.count))),
          h("td", {}, entry(r)),
          h("td", {}, r.hasRecruiter ? badge("في", "good") : badge("ما في")),
          h("td", {}, fmtNumber(r.decisionMakers)),
          h("td", {}, r.bestScore),
        ))),
      )),
      pages > 1 ? h("nav", { class: "pager", "aria-label": "الصفحات" },
        h("button", { type: "button", class: "secondary small", disabled: view.page === 0, onclick: () => { view.page -= 1; draw(); } }, "السابق"),
        h("span", {}, `صفحة ${view.page + 1} من ${pages}`),
        h("button", { type: "button", class: "secondary small", disabled: view.page >= pages - 1, onclick: () => { view.page += 1; draw(); } }, "التالي"),
      ) : null,
    );
  };
  const search = h("input", { type: "search", placeholder: "ابحث بالشركة أو القطاع", value: view.q, "aria-label": "بحث" });
  search.addEventListener("input", () => {
    view.q = search.value.trim();
    view.page = 0;
    draw();
  });
  const recruiters = h("input", { type: "checkbox", checked: view.recruiters });
  recruiters.addEventListener("change", () => {
    view.recruiters = recruiters.checked;
    view.page = 0;
    draw();
  });
  draw();
  return h("div", { class: "view" },
    h("div", { class: "filters card" }, h("div", { class: "toolbar" }, h("span", { class: "search-box" }, icon("search"), search), h("label", { class: "check" }, recruiters, "فيها Recruiter بس"))),
    host,
  );
}
