import "./styles.css";
import { loadStoredState } from "./io/db";
import { reviveState } from "./io/state";
import { awaitingMe, createBusy, createToaster, type Ctx, type ViewId } from "./ui/context";
import { fmtNumber, h, replace } from "./ui/dom";
import { icon, type IconName } from "./ui/icons";
import { Store } from "./ui/store";
import { applyTheme, themeToggle } from "./ui/theme";
import { renderAi } from "./ui/views/ai";
import { renderCompanies } from "./ui/views/companies";
import { contentBadge, renderContent } from "./ui/views/content";
import { closeContact, renderContacts } from "./ui/views/contacts";
import { renderDashboard } from "./ui/views/dashboard";
import { renderData } from "./ui/views/data";
import { renderHome } from "./ui/views/home";
import { renderOpportunities } from "./ui/views/opportunities";
import { renderOutreach } from "./ui/views/outreach";
import { renderProfile } from "./ui/views/profile";
import { renderQuality } from "./ui/views/quality";

interface Page {
  id: ViewId;
  label: string;
  icon: IconName;
  intro: string;
}

const GROUPS: Array<[string, Page[]]> = [
  ["", [
    { id: "home", label: "اليوم", icon: "home", intro: "أهم الخطوات اللي بتستناك هلأ." },
  ]],
  ["شبكتي", [
    { id: "contacts", label: "جهات الاتصال", icon: "users", intro: "كل شبكتك مرتبة حسب الأهمية. اضغط على أي شخص لتشوف تفاصيله ورسائله." },
    { id: "companies", label: "الشركات", icon: "building", intro: "الشركات اللي بتعرف فيها ناس، ومين أحسن مدخل لكل وحدة." },
    { id: "opportunities", label: "الفرص والفجوات", icon: "target", intro: "مين تحكي معه، ووين شبكتك ناقصة مقارنة بأهدافك." },
  ]],
  ["التواصل", [
    { id: "outreach", label: "الإرسال", icon: "send", intro: "راجع الرسائل وابعتها، أو ابعت طلبات تواصل لناس بمجالك." },
  ]],
  ["المحتوى", [
    { id: "content", label: "إنتاج المحتوى", icon: "pen", intro: "حلّل منشوراتك، خطط، واكتب منشورات وصور أقوى بالذكاء الاصطناعي. النشر دايمًا بإيدك." },
  ]],
  ["التحليل", [
    { id: "dashboard", label: "المؤشرات", icon: "chart", intro: "أرقام شبكتك ونشاط رسائلك." },
    { id: "quality", label: "جودة البيانات", icon: "check", intro: "شو انقرأ من ملفاتك وشو ناقص." },
  ]],
  ["الإعداد", [
    { id: "data", label: "البيانات والمزامنة", icon: "database", intro: "ارفع ملف الـ Export، اعمل مزامنة، أو احفظ واسترجع شغلك." },
    { id: "profile", label: "ملفي وأهدافي", icon: "user", intro: "معلوماتك وأهدافك. منها بتنكتب الرسائل وبتنحسب الأولويات." },
    { id: "ai", label: "الذكاء الاصطناعي", icon: "spark", intro: "مفتاح OpenAI والموديل، وكتابة الرسائل لمجموعة أشخاص مرة وحدة." },
  ]],
];

const PAGES = GROUPS.flatMap(([, pages]) => pages);

function isView(value: string): value is ViewId {
  return PAGES.some((p) => p.id === value);
}

function syncLabel(store: Store): string {
  const { sync, importMeta } = store.state.dataset;
  const at = sync.lastSyncAt || importMeta.exportImportedAt;
  if (!at) return "ما في بيانات لسا";
  return `${sync.lastSyncAt ? "آخر مزامنة" : "آخر Export"}: ${at.slice(0, 16).replace("T", " ")}`;
}

async function boot(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) return;
  let initial = null;
  try {
    initial = reviveState(await loadStoredState());
  } catch {
    initial = null;
  }
  const store = new Store(initial ?? undefined);
  const overlays = h("div", { class: "overlays" });
  const toasts = h("div", { class: "toasts", "aria-live": "polite" });
  const toast = createToaster(toasts);
  const nav = h("nav", { class: "nav", "aria-label": "الأقسام" });
  const status = h("p", { class: "side-status" });
  const title = h("h1", {});
  const intro = h("p", { class: "muted" });
  const main = h("main", { id: "main", tabindex: -1 });
  const hashView = location.hash.slice(1);
  let current: ViewId = isView(hashView) ? hashView : store.hasData ? "home" : "data";

  const ctx: Ctx = {
    store,
    toast,
    busy: createBusy(overlays, toast),
    go: (view) => {
      const changed = view !== current;
      if (changed && current === "contacts") closeContact();
      current = view;
      history.replaceState(null, "", `#${view}`);
      render();
      if (changed) {
        window.scrollTo({ top: 0 });
        main.focus({ preventScroll: true });
      }
    },
  };

  function badgeFor(id: ViewId): string {
    if (id === "content") return contentBadge(ctx);
    if (!store.hasData) return "";
    if (id === "home") {
      const n = store.analysis.contacts.filter(awaitingMe).length;
      return n > 0 ? fmtNumber(n) : "";
    }
    if (id === "contacts") return fmtNumber(store.analysis.contacts.length);
    return "";
  }

  function render(): void {
    replace(nav, GROUPS.map(([group, pages]) => h("div", { class: "nav-group" },
      group ? h("span", { class: "nav-title" }, group) : null,
      pages.map((p) => {
        const count = badgeFor(p.id);
        return h("a", { href: `#${p.id}`, class: p.id === current ? "nav-item active" : "nav-item", "aria-current": p.id === current ? "page" : null, onclick: (e: Event) => { e.preventDefault(); ctx.go(p.id); } },
          icon(p.icon), h("span", { class: "nav-label" }, p.label), count ? h("span", { class: p.id === "home" ? "nav-count hot" : "nav-count" }, count) : null);
      }),
    )));
    const page = PAGES.find((p) => p.id === current) ?? PAGES[0]!;
    title.textContent = page.label;
    intro.textContent = page.intro;
    document.title = `${page.label} · شبكة LinkedIn`;
    status.textContent = syncLabel(store);
    const scrollY = window.scrollY;
    const view = (() => {
      switch (current) {
        case "home": return renderHome(ctx);
        case "data": return renderData(ctx, render);
        case "contacts": return renderContacts(ctx, render);
        case "companies": return renderCompanies(ctx);
        case "dashboard": return renderDashboard(ctx);
        case "opportunities": return renderOpportunities(ctx, render);
        case "outreach": return renderOutreach(ctx, render);
        case "content": return renderContent(ctx);
        case "profile": return renderProfile(ctx);
        case "ai": return renderAi(ctx);
        case "quality": return renderQuality(ctx);
      }
    })();
    replace(main, view);
    window.scrollTo({ top: scrollY });
  }

  store.subscribe(render);
  window.addEventListener("hashchange", () => {
    const next = location.hash.slice(1);
    if (isView(next) && next !== current) ctx.go(next);
  });

  replace(root,
    h("a", { class: "skip", href: "#main" }, "انتقل للمحتوى"),
    h("div", { class: "app" },
      h("aside", { class: "sidebar" },
        h("div", { class: "brand" }, h("span", { class: "brand-mark" }, icon("users")), h("span", {}, h("strong", {}, "شبكة LinkedIn"), h("small", {}, "كل البيانات بمتصفحك")), themeToggle()),
        nav,
        status,
      ),
      h("div", { class: "content" },
        h("header", { class: "page-head" }, title, intro),
        main,
      ),
    ),
    overlays,
    toasts,
  );
  render();
}

applyTheme();
void boot();
