import { inbox, MESSAGE_STATUS_LABEL, MESSAGE_STATUSES, statusCounts, type InboxItem, type MessageStatus } from "../../core/inbox";
import { personKey } from "../../core/text";
import type { Contact, Party } from "../../core/types";
import { INBOX_COLUMNS } from "../../io/excel";
import { avatar, badge, emptyState, exportLinks, type Ctx } from "../context";
import { fmtNumber, h, replace } from "../dom";
import { icon } from "../icons";
import { detectSync, linkedinSync, redetectSync, runSync, stopSync, syncJobLine, syncRunning } from "../linkedinSync";
import { openContact } from "./contacts";

const PAGE_SIZE = 50;

type Filter = "" | MessageStatus;

const STATUS_TONE: Record<MessageStatus, string> = { awaiting_me: "bad", awaiting_them: "warn", replied: "good", answered: "good" };

const view = { q: "", filter: "" as Filter, page: 0 };

function stamp(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

function syncCard(ctx: Ctx, rerender: () => void): HTMLElement {
  const { sync } = ctx.store.state.dataset;
  const state = linkedinSync.state;
  const running = syncRunning();
  const start = (): Promise<void> => runSync(ctx, rerender, { messages: true, photos: false, maxConversations: 3000 });
  const last = sync.lastSyncAt ? `آخر مزامنة: ${stamp(sync.lastSyncAt)}` : "ما في مزامنة لسا. أول مزامنة بتسحب كل الرسائل، فالأفضل ترفع الـ Export أول.";
  return h("section", { class: "card inbox-sync" },
    h("div", { class: "status-ext" },
      h("span", { class: `status-dot ${state}` }),
      h("span", {},
        h("strong", {}, state === "ready" ? "الإضافة شغّالة" : state === "missing" ? "الإضافة مش موصولة" : "بفحص الإضافة…"),
        h("span", { class: "muted small" }, state === "missing" ? "ركّب الإضافة من صفحة البيانات عشان تسحب الرسائل الجديدة." : last)),
    ),
    h("div", { class: "row tight wrap inbox-sync-actions" },
      state === "missing"
        ? [
          h("button", { type: "button", class: "secondary small", onclick: () => redetectSync(ctx, rerender) }, "جرّب مرة ثانية"),
          h("button", { type: "button", class: "secondary small", onclick: () => ctx.go("data") }, "روح لصفحة البيانات"),
        ]
        : [
          h("button", { type: "button", disabled: state !== "ready" || running, onclick: () => void start() }, icon("refresh"), running ? "عم بزامن…" : "مزامنة الرسائل الجديدة"),
          running ? h("button", { type: "button", class: "secondary", onclick: () => void stopSync(ctx, rerender) }, "إيقاف") : null,
        ],
    ),
    running || linkedinSync.job?.state === "error" ? syncJobLine(linkedinSync.job) : null,
  );
}

function contactFinder(contacts: Contact[]): (p: Party) => Contact | undefined {
  const bySlug = new Map<string, Contact>();
  const byName = new Map<string, Contact>();
  for (const c of contacts) {
    if (c.slug) bySlug.set(c.slug, c);
    const key = personKey(c.fullName);
    if (key && !byName.has(key)) byName.set(key, c);
  }
  return (p) => (p.slug ? bySlug.get(p.slug) : undefined) ?? byName.get(personKey(p.name));
}

function personLabel(ctx: Ctx, p: Party, find: (p: Party) => Contact | undefined): HTMLElement {
  const name = p.name || p.slug || "—";
  const contact = find(p);
  if (contact) return h("button", { type: "button", class: "link inbox-name", dir: "auto", onclick: () => openContact(ctx, contact.id) }, name);
  if (p.slug) return h("a", { class: "inbox-name", dir: "auto", href: `https://www.linkedin.com/in/${encodeURIComponent(p.slug)}`, target: "_blank", rel: "noopener noreferrer" }, name);
  return h("strong", { class: "inbox-name", dir: "auto" }, name);
}

function messageItem(ctx: Ctx, item: InboxItem, find: (p: Party) => Contact | undefined): HTMLElement {
  const m = item.message;
  const first = item.counterpart[0] ?? { name: "", slug: "" };
  const people = item.counterpart.length > 0 ? item.counterpart : [first];
  const text = h("p", { class: "inbox-text", dir: "auto" }, m.content || "—");
  const long = m.content.length > 420 || m.content.split("\n").length > 6;
  return h("li", { class: `inbox-item ${m.outgoing ? "out" : "in"} ${item.status}` },
    h("div", { class: "inbox-head" },
      h("span", { class: "person" }, avatar(ctx, { slug: first.slug, fullName: first.name || first.slug }),
        h("span", { class: "person-text" },
          h("span", { class: "inbox-people" }, people.flatMap((p, i) => (i === 0 ? [personLabel(ctx, p, find)] : ["، ", personLabel(ctx, p, find)]))),
          h("span", { class: "sub" }, h("time", { datetime: m.at, dir: "ltr" }, stamp(m.at)), people.length > 1 ? ` · محادثة جماعية (${fmtNumber(people.length)})` : ""),
        )),
      h("span", { class: "inbox-badges" },
        badge(m.outgoing ? "مرسلة" : "واردة", m.outgoing ? "mode-cold" : ""),
        badge(MESSAGE_STATUS_LABEL[item.status], STATUS_TONE[item.status]),
      ),
    ),
    text,
    long ? h("button", { type: "button", class: "link small inbox-more", "aria-expanded": "false", onclick: (e: Event) => {
      const open = text.classList.toggle("open");
      const button = e.currentTarget as HTMLButtonElement;
      button.setAttribute("aria-expanded", String(open));
      button.textContent = open ? "اعرض أقل" : "اعرض الرسالة كاملة";
    } }, "اعرض الرسالة كاملة") : null,
    item.thread ? h("a", { class: "small inbox-open", href: item.thread, target: "_blank", rel: "noopener noreferrer" }, icon("external"), "افتح المحادثة على LinkedIn") : null,
  );
}

function matches(item: InboxItem, needle: string): boolean {
  if (view.filter && item.status !== view.filter) return false;
  return !needle || item.search.includes(needle);
}

export function renderMessages(ctx: Ctx, rerender: () => void): HTMLElement {
  void detectSync(ctx, rerender);
  const sync = syncCard(ctx, rerender);
  if (!ctx.store.hasData) return h("div", { class: "view" }, sync, emptyState("ما في بيانات لسا", "ارفع ملف الـ Export من LinkedIn أو اعمل مزامنة من الإضافة، وبعدها بتطلع كل رسائلك هون.", ["روح لصفحة البيانات", () => ctx.go("data")]));

  const all = inbox(ctx.store.state.dataset.messages);
  const counts = statusCounts(all);
  const find = contactFinder(ctx.store.analysis.contacts);
  const host = h("div", { class: "inbox-host" });
  const summary = h("p", { class: "muted small", "aria-live": "polite" });
  let list: InboxItem[] = [];

  const draw = (): void => {
    const needle = view.q.trim().toLowerCase();
    list = all.filter((item) => matches(item, needle));
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    view.page = Math.min(view.page, pages - 1);
    const rows = list.slice(view.page * PAGE_SIZE, (view.page + 1) * PAGE_SIZE);
    summary.textContent = list.length === all.length ? `${fmtNumber(all.length)} رسالة` : `${fmtNumber(list.length)} من ${fmtNumber(all.length)} رسالة`;
    if (list.length === 0) {
      replace(host, h("div", { class: "empty-line" }, h("p", {}, all.length === 0 ? "ما في رسائل لسا. اعمل مزامنة أو ارفع ملف الـ Export." : "ما في رسائل بهالبحث أو الحالة.")));
      return;
    }
    const turn = (step: number) => (): void => {
      view.page += step;
      draw();
      host.scrollIntoView({ block: "start" });
    };
    replace(host,
      h("ol", { class: "inbox" }, rows.map((item) => messageItem(ctx, item, find))),
      pages > 1 ? h("nav", { class: "pager", "aria-label": "الصفحات" },
        h("button", { type: "button", class: "secondary small", disabled: view.page === 0, onclick: turn(-1) }, "السابق"),
        h("span", {}, `صفحة ${fmtNumber(view.page + 1)} من ${fmtNumber(pages)}`),
        h("button", { type: "button", class: "secondary small", disabled: view.page >= pages - 1, onclick: turn(1) }, "التالي"),
      ) : null,
    );
  };

  const search = h("input", { type: "search", placeholder: "ابحث بالاسم أو نص الرسالة", value: view.q, "aria-label": "بحث بالرسائل" });
  search.addEventListener("input", () => {
    view.q = search.value;
    view.page = 0;
    draw();
  });

  const filters: Array<[Filter, string, number]> = [["", "الكل", all.length], ...MESSAGE_STATUSES.map((s): [Filter, string, number] => [s, MESSAGE_STATUS_LABEL[s], counts[s]])];
  draw();
  return h("div", { class: "view" },
    sync,
    h("div", { class: "presets", role: "group", "aria-label": "حالة الرسالة" }, filters.map(([id, label, n]) =>
      h("button", { type: "button", "aria-pressed": String(view.filter === id), class: id === "awaiting_me" && n > 0 ? "hot" : "", onclick: () => { view.filter = id; view.page = 0; rerender(); } },
        label, h("span", { class: "preset-count" }, fmtNumber(n))))),
    h("section", { class: "card" },
      h("div", { class: "toolbar" },
        h("span", { class: "search-box" }, icon("search"), search),
        exportLinks(ctx, "messages", INBOX_COLUMNS, () => list),
      ),
      summary,
      host,
    ),
  );
}
