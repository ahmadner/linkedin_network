import { conversationIndex } from "../../core/conversations";
import { conversations, MESSAGE_STATUS_LABEL, type Conversation, type ConversationStatus, type InboxItem } from "../../core/inbox";
import { personKey } from "../../core/text";
import type { Contact, Party } from "../../core/types";
import { INBOX_COLUMNS } from "../../io/excel";
import { analysisResult, runAnalysis, textDir, type AnalysisTarget } from "../analysis";
import { avatar, badge, emptyState, exportLinks, type Ctx } from "../context";
import { fmtNumber, h, replace } from "../dom";
import { icon } from "../icons";
import { detectSync, linkedinSync, redetectSync, runSync, stopSync, syncJobLine, syncRunning } from "../linkedinSync";
import { openContact } from "./contacts";

const LIST_STEP = 40;
const THREAD_STEP = 60;

type Filter = "" | ConversationStatus;

const FILTERS: Array<[Filter, string]> = [["", "الكل"], ["awaiting_me", "بانتظار ردّك"], ["awaiting_them", "بانتظار ردّهم"]];

const view = { q: "", filter: "" as Filter, selected: "", shown: LIST_STEP, older: 0, scrolled: "" };

type Finder = (p: Party) => Contact | undefined;

function stamp(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

function shortDate(iso: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return iso.slice(0, 10) === today ? iso.slice(11, 16) : iso.slice(0, 10);
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
    h("div", { class: "row tight wrap" },
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

function contactFinder(contacts: Contact[]): Finder {
  const bySlug = new Map<string, Contact>();
  const byName = new Map<string, Contact>();
  for (const c of contacts) {
    if (c.slug) bySlug.set(c.slug, c);
    const key = personKey(c.fullName);
    if (key && !byName.has(key)) byName.set(key, c);
  }
  return (p) => (p.slug ? bySlug.get(p.slug) : undefined) ?? byName.get(personKey(p.name));
}

function nameOf(p: Party): string {
  return p.name || p.slug || "—";
}

function title(conv: Conversation): string {
  return conv.people.length > 0 ? conv.people.map(nameOf).join("، ") : "—";
}

function face(ctx: Ctx, conv: Conversation, size: "small" | "large" = "small"): HTMLElement {
  const p = conv.people[0] ?? { name: "", slug: "" };
  return avatar(ctx, { slug: p.slug, fullName: nameOf(p) }, size);
}

function conversationRow(ctx: Ctx, conv: Conversation, rerender: () => void): HTMLElement {
  const preview = conv.last.content.replace(/\s+/g, " ").trim() || "—";
  const active = conv.key === view.selected;
  return h("li", {},
    h("button", {
      type: "button",
      class: `conv ${conv.status}${active ? " active" : ""}`,
      "aria-current": active ? "true" : null,
      onclick: () => {
        view.selected = conv.key;
        view.older = 0;
        rerender();
      },
    },
    face(ctx, conv),
    h("span", { class: "conv-text" },
      h("span", { class: "conv-top" },
        h("strong", { class: "conv-name", dir: "auto" }, title(conv)),
        h("time", { class: "conv-time", datetime: conv.last.at, dir: "ltr" }, shortDate(conv.last.at)),
      ),
      h("span", { class: "conv-bottom" },
        h("span", { class: "conv-preview", dir: "auto" }, conv.last.outgoing ? `أنا: ${preview}` : preview),
        conv.pending > 0
          ? h("span", { class: "nav-count hot", title: "رسائل بانتظار ردّك", "aria-label": `${fmtNumber(conv.pending)} بانتظار ردّك` }, fmtNumber(conv.pending))
          : h("span", { class: "conv-state" }, MESSAGE_STATUS_LABEL.awaiting_them),
      ),
    )),
  );
}

function analysisTarget(ctx: Ctx, conv: Conversation, find: Finder): AnalysisTarget {
  const contact = conv.people.length === 1 ? find(conv.people[0]!) ?? null : null;
  if (contact) return { key: contact.id, partner: contact, contact, history: conversationIndex(ctx.store.state.dataset.messages).of(contact) };
  const names = conv.people.map(nameOf);
  return {
    key: `conversation:${conv.key}`.slice(0, 300),
    partner: { greetingName: names.length === 1 ? names[0]!.split(/\s+/)[0] ?? "" : names.join("، "), positionPrimary: "", positionClean: "", companyClean: "" },
    contact: null,
    history: conv.items.map((i) => i.message),
  };
}

function bubbleMeta(item: InboxItem): string {
  const time = item.message.at.slice(11, 16);
  if (item.status === "answered") return `${time} · ${MESSAGE_STATUS_LABEL.answered} ✓✓`;
  if (item.status === "awaiting_them") return `${time} · ${MESSAGE_STATUS_LABEL.awaiting_them} ✓`;
  if (item.status === "awaiting_me") return `${time} · ${MESSAGE_STATUS_LABEL.awaiting_me}`;
  return time;
}

function chatThread(conv: Conversation, rerender: () => void): HTMLElement {
  const group = conv.people.length > 1;
  const shown = Math.min(conv.items.length, THREAD_STEP * (view.older + 1));
  const rows: HTMLElement[] = [];
  let day = "";
  for (const item of conv.items.slice(-shown)) {
    const m = item.message;
    const date = m.at.slice(0, 10);
    if (date !== day) {
      day = date;
      rows.push(h("li", { class: "chat-day" }, h("span", { dir: "ltr" }, date)));
    }
    rows.push(h("li", { class: `bubble ${m.outgoing ? "out" : "in"} ${item.status}` },
      group && !m.outgoing ? h("span", { class: "bubble-from", dir: "auto" }, nameOf(m.from)) : null,
      h("span", { class: "bubble-text", dir: textDir(m.content) }, m.content || "—"),
      h("span", { class: "bubble-meta" }, bubbleMeta(item)),
    ));
  }
  return h("div", { class: "chat-body", tabindex: 0, role: "region", "aria-label": `المحادثة مع ${title(conv)}` },
    shown < conv.items.length ? h("button", { type: "button", class: "secondary small chat-older", onclick: () => { view.older += 1; view.scrolled = "top"; rerender(); } }, `اعرض الأقدم (${fmtNumber(conv.items.length - shown)})`) : null,
    h("ol", { class: "chat" }, rows),
  );
}

function chatPanel(ctx: Ctx, conv: Conversation | undefined, find: Finder, rerender: () => void): HTMLElement {
  if (!conv) return h("section", { class: "card chat-panel chat-empty" }, icon("message"), h("p", { class: "muted" }, "اختار محادثة من القائمة عشان تشوفها هون."));
  const target = analysisTarget(ctx, conv, find);
  const result = analysisResult(ctx, target);
  const contact = target.contact;
  const role = contact ? [contact.positionPrimary || contact.positionClean, contact.companyClean].filter(Boolean).join(" · ") : "";
  return h("section", { class: "card chat-panel" },
    h("header", { class: "chat-head" },
      h("button", { type: "button", class: "secondary small chat-back", onclick: () => { view.selected = ""; rerender(); } }, icon("back"), "كل المحادثات"),
      h("span", { class: "person" }, face(ctx, conv, "large"),
        h("span", { class: "person-text" },
          contact
            ? h("button", { type: "button", class: "link inbox-name", dir: "auto", onclick: () => openContact(ctx, contact.id) }, title(conv))
            : h("strong", { class: "inbox-name", dir: "auto" }, title(conv)),
          h("span", { class: "sub", dir: "auto" }, role || `${fmtNumber(conv.items.length)} رسالة`),
        )),
      h("span", { class: "row tight wrap chat-actions" },
        badge(MESSAGE_STATUS_LABEL[conv.status], conv.status === "awaiting_me" ? "bad" : "warn"),
        conv.thread ? h("a", { class: "button secondary small", href: conv.thread, target: "_blank", rel: "noopener noreferrer" }, icon("external"), "افتح على LinkedIn") : null,
        h("button", { type: "button", class: "small", onclick: () => void runAnalysis(ctx, target) }, icon("spark"), result ? "حلّل من جديد" : "حلّل بالذكاء الاصطناعي"),
      ),
    ),
    result ? h("details", { class: "chat-analysis", open: true }, h("summary", {}, "تحليل المحادثة بالذكاء الاصطناعي"), result) : null,
    chatThread(conv, rerender),
  );
}

export function renderMessages(ctx: Ctx, rerender: () => void): HTMLElement {
  void detectSync(ctx, rerender);
  const sync = syncCard(ctx, rerender);
  if (!ctx.store.hasData) return h("div", { class: "view" }, sync, emptyState("ما في بيانات لسا", "ارفع ملف الـ Export من LinkedIn أو اعمل مزامنة من الإضافة، وبعدها بتطلع كل محادثاتك هون.", ["روح لصفحة البيانات", () => ctx.go("data")]));

  const all = conversations(ctx.store.state.dataset.messages);
  const find = contactFinder(ctx.store.analysis.contacts);
  const counts: Record<Filter, number> = { "": all.length, awaiting_me: 0, awaiting_them: 0 };
  for (const c of all) counts[c.status] += 1;
  const selected = all.find((c) => c.key === view.selected);
  if (!selected) view.selected = "";

  const listHost = h("ul", { class: "conv-list" });
  const summary = h("p", { class: "muted small", "aria-live": "polite" });
  let filtered: Conversation[] = [];

  const draw = (): void => {
    const needle = view.q.trim().toLowerCase();
    filtered = all.filter((c) => (!view.filter || c.status === view.filter) && (!needle || c.search.includes(needle)));
    summary.textContent = filtered.length === all.length ? `${fmtNumber(all.length)} محادثة` : `${fmtNumber(filtered.length)} من ${fmtNumber(all.length)} محادثة`;
    if (filtered.length === 0) {
      replace(listHost, h("li", { class: "empty-line" }, h("p", {}, all.length === 0 ? "ما في رسائل لسا. اعمل مزامنة أو ارفع ملف الـ Export." : "ما في محادثات بهالبحث أو الحالة.")));
      return;
    }
    replace(listHost,
      filtered.slice(0, view.shown).map((c) => conversationRow(ctx, c, rerender)),
      filtered.length > view.shown ? h("li", {}, h("button", { type: "button", class: "secondary small conv-more", onclick: () => { view.shown += LIST_STEP; draw(); } }, `اعرض أكثر (${fmtNumber(filtered.length - view.shown)})`)) : null,
    );
  };

  const search = h("input", { type: "search", placeholder: "ابحث بالاسم أو نص الرسائل", value: view.q, "aria-label": "بحث بالمحادثات" });
  search.addEventListener("input", () => {
    view.q = search.value;
    view.shown = LIST_STEP;
    draw();
  });

  draw();
  if (!selected) view.scrolled = "";
  else if (view.scrolled !== selected.key) {
    const toTop = view.scrolled === "top";
    view.scrolled = selected.key;
    requestAnimationFrame(() => {
      const body = document.querySelector<HTMLElement>(".chat-body");
      if (body) body.scrollTop = toTop ? 0 : body.scrollHeight;
      if (!toTop && matchMedia("(max-width: 900px)").matches) document.querySelector(".chat-panel")?.scrollIntoView({ block: "start" });
    });
  }

  return h("div", { class: "view" },
    sync,
    h("div", { class: selected ? "inbox-layout open" : "inbox-layout" },
      h("section", { class: "card conv-pane" },
        h("div", { class: "presets", role: "group", "aria-label": "حالة المحادثة" }, FILTERS.map(([id, label]) =>
          h("button", { type: "button", "aria-pressed": String(view.filter === id), class: id === "awaiting_me" && counts[id] > 0 ? "hot" : "", onclick: () => { view.filter = id; view.shown = LIST_STEP; rerender(); } },
            label, h("span", { class: "preset-count" }, fmtNumber(counts[id]))))),
        h("span", { class: "search-box" }, icon("search"), search),
        h("div", { class: "row tight wrap conv-tools" }, summary, exportLinks(ctx, "messages", INBOX_COLUMNS, () => filtered.flatMap((c) => c.items))),
        listHost,
      ),
      chatPanel(ctx, selected, find, rerender),
    ),
  );
}
