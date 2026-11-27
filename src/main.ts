import "./styles.css";
import { loadStoredState } from "./io/db";
import { reviveState } from "./io/state";
import { createBusy, createToaster, type Ctx, type ViewId } from "./ui/context";
import { h, replace } from "./ui/dom";
import { Store } from "./ui/store";
import { renderAi } from "./ui/views/ai";
import { renderCompanies } from "./ui/views/companies";
import { renderContacts } from "./ui/views/contacts";
import { renderDashboard } from "./ui/views/dashboard";
import { renderData } from "./ui/views/data";
import { renderProfile } from "./ui/views/profile";
import { renderQuality } from "./ui/views/quality";

const TABS: Array<[ViewId, string]> = [
  ["data", "البيانات"],
  ["contacts", "جهات الاتصال"],
  ["companies", "الشركات"],
  ["dashboard", "المؤشرات"],
  ["profile", "ملفي وأهدافي"],
  ["ai", "الذكاء الاصطناعي"],
  ["quality", "جودة البيانات"],
];

function isView(value: string): value is ViewId {
  return TABS.some(([id]) => id === value);
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
  const nav = h("nav", { class: "tabs", "aria-label": "الأقسام" });
  const main = h("main", { id: "main" });
  let current: ViewId = isView(location.hash.slice(1)) ? (location.hash.slice(1) as ViewId) : store.hasData ? "contacts" : "data";

  const ctx: Ctx = {
    store,
    toast,
    busy: createBusy(overlays, toast),
    go: (view) => {
      current = view;
      history.replaceState(null, "", `#${view}`);
      render();
    },
  };

  function render(): void {
    replace(nav, TABS.map(([id, label]) => h("button", { type: "button", class: id === current ? "active" : "", "aria-current": id === current ? "page" : null, onclick: () => ctx.go(id) }, label)));
    const scrollY = window.scrollY;
    const view = (() => {
      switch (current) {
        case "data": return renderData(ctx, render);
        case "contacts": return renderContacts(ctx, render);
        case "companies": return renderCompanies(ctx);
        case "dashboard": return renderDashboard(ctx);
        case "profile": return renderProfile(ctx);
        case "ai": return renderAi(ctx, render);
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
    h("header", { class: "top" }, h("h1", {}, "شبكة LinkedIn"), h("p", {}, "تحليل شبكتك ورسائل مخصصة لكل شخص. كل البيانات بتضل بمتصفحك.")),
    nav,
    main,
    overlays,
    toasts,
  );
  render();
}

void boot();
