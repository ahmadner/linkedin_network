import { suggestNetworkMoves } from "../../ai/features";
import {
  ACTION_LABEL, GAP_KIND_LABEL, GAP_LEVEL_LABEL, linkedinCompanySearch, linkedinPeopleSearch, networkGaps, suggestCompanies, suggestPeople,
  type ActionKind, type CompanySuggestion, type Gap, type PersonSuggestion,
} from "../../core/opportunities";
import type { SuggestedCompany } from "../../core/types";
import type { Column } from "../../io/excel";
import { avatar, badge, card, exportLinks, linkedinLinks, noData, runAi, type Ctx } from "../context";
import { h, select } from "../dom";
import { openContact } from "./contacts";

const view = { action: "" as "" | ActionKind };

const GAP_TONE: Record<Gap["level"], string> = { none: "bad", weak: "warn", ok: "good" };

const GAP_COLUMNS: Array<Column<Gap>> = [
  ["Type", (g) => g.kind, 10],
  ["Target", (g) => g.target, 28],
  ["Contacts", (g) => g.contacts, 10],
  ["Recruiters", (g) => g.recruiters, 10],
  ["Decision Makers", (g) => g.decisionMakers, 14],
  ["Level", (g) => g.level, 8],
  ["Advice", (g) => g.advice, 60],
  ["LinkedIn Search", (g) => g.search, 40],
];

const PEOPLE_COLUMNS: Array<Column<PersonSuggestion>> = [
  ["Action", (p) => p.action, 12],
  ["Full Name", (p) => p.contact.fullName, 24],
  ["Position", (p) => p.contact.positionPrimary || p.contact.positionClean, 30],
  ["Company", (p) => p.contact.companyClean, 26],
  ["Priority", (p) => p.contact.bucket, 9],
  ["Score", (p) => p.contact.score, 7],
  ["Reason", (p) => p.reason, 60],
  ["LinkedIn Profile", (p) => p.contact.profileUrl, 34],
];

const COMPANY_COLUMNS: Array<Column<CompanySuggestion>> = [
  ["Company", (s) => s.company.name, 30],
  ["Industry", (s) => s.company.industry, 24],
  ["Contacts", (s) => s.company.count, 10],
  ["Best Entry Point", (s) => s.company.topContact, 26],
  ["Their Role", (s) => s.company.topRole, 28],
  ["Reason", (s) => s.reason, 50],
];

const AI_COMPANY_COLUMNS: Array<Column<SuggestedCompany>> = [
  ["Company", (s) => s.name, 30],
  ["Why", (s) => s.why, 60],
  ["Roles To Connect", (s) => s.roles.join(", "), 40],
];

function external(href: string, label: string): HTMLElement {
  return h("a", { href, target: "_blank", rel: "noopener noreferrer" }, label);
}

function head(title: string, ...extra: Array<HTMLElement | null>): HTMLElement {
  return h("div", { class: "card-head" }, h("h2", {}, title), ...extra);
}

function gapsCard(ctx: Ctx, gaps: Gap[]): HTMLElement {
  if (gaps.length === 0) {
    return card("فجوات الشبكة",
      h("p", {}, "حدد القطاعات والتخصصات والشركات المستهدفة بصفحة ملفي وأهدافي، وبعدها بتطلعلك الفجوات هون."),
      h("button", { type: "button", onclick: () => ctx.go("profile") }, "روح لملفي وأهدافي"));
  }
  return h("section", { class: "card" },
    head("فجوات الشبكة", exportLinks(ctx, "network-gaps", GAP_COLUMNS, () => gaps)),
    h("p", { class: "muted small" }, "مقارنة بين أهدافك وبين مين بتعرف فعلًا. الأحمر ما في حدا، والأصفر في بس ناقص Recruiter أو صاحب قرار أو العدد قليل."),
    h("div", { class: "scroll" }, h("table", { class: "grid compact-rows" },
      h("thead", {}, h("tr", {}, ["النوع", "الهدف", "معارف", "Recruiters", "أصحاب قرار", "الحالة", "شو تعمل", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, gaps.map((g) => h("tr", {},
        h("td", {}, GAP_KIND_LABEL[g.kind]),
        h("td", { dir: "auto" }, g.target),
        h("td", {}, g.contacts),
        h("td", {}, g.recruiters),
        h("td", {}, g.decisionMakers),
        h("td", {}, badge(GAP_LEVEL_LABEL[g.level], GAP_TONE[g.level])),
        h("td", {}, g.advice),
        h("td", {}, external(g.search, "ابحث على LinkedIn")),
      ))),
    )),
  );
}

function peopleCard(ctx: Ctx, people: PersonSuggestion[], rerender: () => void): HTMLElement {
  const list = view.action ? people.filter((p) => p.action === view.action) : people;
  return h("section", { class: "card" },
    head("أشخاص تبني علاقة معهم",
      select([["", "كل الخطوات"], ...(Object.keys(ACTION_LABEL) as ActionKind[]).map((k): [string, string] => [k, ACTION_LABEL[k]])], view.action, (v) => {
        view.action = v as "" | ActionKind;
        rerender();
      }),
      exportLinks(ctx, "suggested-people", PEOPLE_COLUMNS, () => list),
    ),
    h("p", { class: "muted small" }, "من شبكتك الحالية: الأعلى نقاطًا، بحد أقصى اثنين من كل شركة. المتابعة للي ما ردوا من أسبوع أو أكثر، والرجوع للي آخر تواصل معهم من 3 شهور أو أكثر."),
    list.length === 0 ? h("p", { class: "muted" }, "ما في اقتراحات حاليًا") : h("div", { class: "scroll short" }, h("table", { class: "grid" },
      h("thead", {}, h("tr", {}, ["الشخص", "الخطوة", "ليش", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, list.map((p) => {
        const tr = h("tr", { tabindex: 0 },
          h("td", {}, h("span", { class: "person" }, avatar(ctx, p.contact), h("span", { class: "person-text" },
            h("span", { class: "name" }, p.contact.fullName, badge(p.contact.bucket, `bucket-${p.contact.bucket}`)),
            h("span", { class: "sub", dir: "auto" }, [p.contact.positionPrimary || p.contact.positionClean, p.contact.companyClean].filter(Boolean).join(" · "))))),
          h("td", {}, badge(ACTION_LABEL[p.action], `action-${p.action}`)),
          h("td", { class: "muted small" }, p.reason),
          h("td", {}, linkedinLinks(ctx, p.contact, true)),
        );
        const open = (): void => openContact(ctx, p.contact.id);
        tr.addEventListener("click", open);
        tr.addEventListener("keydown", (e) => {
          if (e.target === tr && e.key === "Enter") open();
        });
        return tr;
      })),
    )),
  );
}

function companiesCard(ctx: Ctx, companies: CompanySuggestion[]): HTMLElement {
  return h("section", { class: "card" },
    head("شركات تركّز عليها", exportLinks(ctx, "suggested-companies", COMPANY_COLUMNS, () => companies)),
    h("p", { class: "muted small" }, "شركات بشبكتك من شركاتك أو قطاعاتك المستهدفة، مع أفضل شخص تبدأ فيه."),
    companies.length === 0 ? h("p", { class: "muted" }, "ما في شركات من قطاعاتك المستهدفة بشبكتك لسا") : h("div", { class: "scroll short" }, h("table", { class: "grid compact-rows" },
      h("thead", {}, h("tr", {}, ["الشركة", "القطاع", "معارف", "أفضل مدخل", "ليش", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, companies.map((s) => h("tr", {},
        h("td", { dir: "auto" }, s.targeted ? h("strong", {}, s.company.name) : s.company.name),
        h("td", {}, s.company.industry),
        h("td", {}, s.company.count),
        h("td", {}, s.company.topContact, h("div", { class: "muted small" }, s.company.topRole)),
        h("td", {}, s.reason),
        h("td", {}, external(linkedinPeopleSearch(`${s.company.name} Recruiter`), "Recruiters فيها")),
      ))),
    )),
  );
}

function aiCard(ctx: Ctx, gaps: Gap[]): HTMLElement {
  const state = ctx.store.state;
  const result = state.ai.suggestions;
  const run = async (): Promise<void> => {
    const { contacts, companies } = ctx.store.analysis;
    const out = await runAi(ctx, "الذكاء الاصطناعي بيدور على فرص…", (cfg) => suggestNetworkMoves(state.profile, contacts, companies, gaps, cfg));
    if (out) ctx.store.update((s) => (s.ai.suggestions = out), { recompute: false });
  };
  const location = state.profile.me.location.split(",")[0]?.trim() ?? "";
  return h("section", { class: "card" },
    head("اقتراحات الذكاء الاصطناعي",
      h("button", { type: "button", class: "secondary", onclick: () => void run() }, result ? "اقترح من جديد" : "اقترح شركات وأشخاص"),
      result ? exportLinks(ctx, "ai-suggested-companies", AI_COMPANY_COLUMNS, () => result.companies) : null,
    ),
    h("p", { class: "muted small" }, "بيتبعت لـ OpenAI: بروفايلك المهني وأهدافك، وأسماء أكثر الشركات بشبكتك وعددهم، والفجوات. ما بتنبعت أسماء أشخاص. تأكد من أي شركة قبل ما تعتمد عليها."),
    result ? h("div", { class: "ai-suggestions" },
      h("p", { class: "muted small" }, `آخر اقتراح: ${result.generatedAt.slice(0, 16).replace("T", " ")} · ${result.model}`),
      result.actions.length > 0 ? h("div", {}, h("h3", {}, "خطوات هالأسبوع"), h("ol", {}, result.actions.map((a) => h("li", {}, a)))) : null,
      result.companies.length > 0 ? h("div", {}, h("h3", {}, "شركات"), h("ul", { class: "suggest-list" }, result.companies.map((s) => h("li", {},
        h("strong", { dir: "auto" }, s.name), " ", h("span", { class: "muted" }, s.why),
        h("div", { class: "row tight wrap small" },
          external(linkedinCompanySearch(s.name), "الشركة على LinkedIn"),
          ...s.roles.map((role) => external(linkedinPeopleSearch(`${role} ${s.name}`), role)),
        ),
      )))) : null,
      result.people.length > 0 ? h("div", {}, h("h3", {}, "أنواع أشخاص تضيفهم"), h("ul", { class: "suggest-list" }, result.people.map((p) => h("li", {},
        h("strong", { dir: "auto" }, p.title), " ", h("span", { class: "muted" }, p.why), " ",
        external(linkedinPeopleSearch([p.title, location].filter(Boolean).join(" ")), "ابحث"),
      )))) : null,
    ) : h("p", { class: "muted" }, "اضغط الزر عشان يقترح شركات جديدة مش بشبكتك، وأنواع ناس تضيفهم، وخطوات لهالأسبوع."),
  );
}

export function renderOpportunities(ctx: Ctx, rerender: () => void): HTMLElement {
  if (!ctx.store.hasData) return noData(ctx);
  const { contacts, companies } = ctx.store.analysis;
  const profile = ctx.store.state.profile;
  const gaps = networkGaps(contacts, profile);
  return h("div", { class: "view" },
    peopleCard(ctx, suggestPeople(contacts), rerender),
    gapsCard(ctx, gaps),
    companiesCard(ctx, suggestCompanies(companies, profile)),
    aiCard(ctx, gaps),
  );
}
