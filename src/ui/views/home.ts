import { getApiKey } from "../../ai/key";
import { conversationIndex } from "../../core/conversations";
import { suggestPeople } from "../../core/opportunities";
import { replyStats } from "../../core/stats";
import type { Contact } from "../../core/types";
import { ago, avatar, awaitingMe, kpi, linkedinLinks, type Ctx } from "../context";
import { fmtNumber, h } from "../dom";
import { icon, type IconName } from "../icons";
import { openContact, showContacts, type Preset } from "./contacts";

const LIST_SIZE = 6;

interface Task {
  contact: Contact;
  note: string;
}

function snippet(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function taskItem(ctx: Ctx, t: Task): HTMLElement {
  const c = t.contact;
  const role = [c.positionPrimary || c.positionClean, c.companyClean].filter(Boolean).join(" · ");
  return h("li", { class: "task" },
    h("button", { type: "button", class: "task-main", onclick: () => openContact(ctx, c.id) },
      avatar(ctx, c),
      h("span", { class: "task-text" },
        h("span", { class: "task-name" }, c.fullName, h("span", { class: `badge bucket-${c.bucket}` }, c.bucket)),
        role ? h("span", { class: "task-sub", dir: "auto" }, role) : null,
        t.note ? h("span", { class: "task-note", dir: "auto" }, t.note) : null,
      ),
    ),
    linkedinLinks(ctx, c, true),
  );
}

function taskCard(ctx: Ctx, title: string, iconName: IconName, hint: string, tasks: Task[], total: number, preset: Preset, empty: string): HTMLElement {
  return h("section", { class: "card task-card" },
    h("div", { class: "card-head" },
      h("h2", { class: "with-icon" }, icon(iconName), title, total > 0 ? h("span", { class: "count-pill" }, fmtNumber(total)) : null),
      total > tasks.length ? h("button", { type: "button", class: "link", onclick: () => showContacts(ctx, preset) }, "شوف الكل") : null,
    ),
    h("p", { class: "muted small" }, hint),
    tasks.length === 0 ? h("p", { class: "empty-line" }, empty) : h("ul", { class: "tasks" }, tasks.map((t) => taskItem(ctx, t))),
  );
}

function setupStep(done: boolean, title: string, text: string, action: [string, () => void], optional = false): HTMLElement {
  return h("li", { class: done ? "step done" : "step" },
    h("span", { class: "step-mark", "aria-hidden": "true" }, done ? "✓" : ""),
    h("div", { class: "step-body" },
      h("strong", {}, title, optional ? h("span", { class: "muted small" }, " (اختياري)") : null),
      h("p", { class: "muted small" }, done ? "تمام، خلصت." : text),
    ),
    done ? null : h("button", { type: "button", class: "secondary small", onclick: action[1] }, action[0]),
  );
}

function setupCard(ctx: Ctx, compact: boolean): HTMLElement | null {
  const me = ctx.store.state.profile.me;
  const hasData = ctx.store.hasData;
  const hasProfile = Boolean(me.full_name && me.current_role && me.top_skills.length > 0);
  const hasKey = Boolean(getApiKey());
  if (compact && hasProfile && hasKey) return null;
  return h("section", { class: compact ? "card setup compact" : "card setup" },
    h("h2", {}, compact ? "كمّل الإعداد" : "أهلًا! خلّينا نجهّز شبكتك بثلاث خطوات"),
    compact ? null : h("p", { class: "muted" }, "كل شي بيضل بمتصفحك. ما في سيرفر وما بنحفظ كلمة سر LinkedIn."),
    h("ol", { class: "steps" },
      compact ? null : setupStep(hasData, "ارفع بياناتك", "نزّل ملف الـ Export من LinkedIn وارفعه، أو اعمل مزامنة من الإضافة.", ["روح للبيانات", () => ctx.go("data")]),
      setupStep(hasProfile, "عبّي ملفك وأهدافك", "اسمك ومنصبك ومهاراتك والشركات اللي بدك ياها. منها بتنحسب الأولويات وبتنكتب الرسائل.", ["عبّي ملفي", () => ctx.go("profile")]),
      setupStep(hasKey, "حط مفتاح OpenAI", "عشان تكتب رسائل وتحلل محادثات بالذكاء الاصطناعي. المفتاح بيضل بمتصفحك بس.", ["حط المفتاح", () => ctx.go("ai")], true),
    ),
  );
}

export function renderHome(ctx: Ctx): HTMLElement {
  if (!ctx.store.hasData) return h("div", { class: "view" }, setupCard(ctx, false));

  const { contacts } = ctx.store.analysis;
  const index = conversationIndex(ctx.store.state.dataset.messages);
  const lastFrom = (c: Contact): string => {
    const thread = index.of(c);
    const last = [...thread].reverse().find((m) => !m.outgoing);
    return last?.content ? `"${snippet(last.content)}"` : "";
  };

  const replyAll = contacts.filter(awaitingMe).sort((a, b) => (a.daysSinceContact ?? Infinity) - (b.daysSinceContact ?? Infinity) || b.score - a.score);
  const suggestions = suggestPeople(contacts, 200);
  const follow = suggestions.filter((s) => s.action === "follow_up" && !awaitingMe(s.contact));
  const start = suggestions.filter((s) => (s.action === "start" || s.action === "reconnect") && !awaitingMe(s.contact));
  const replies = replyStats(contacts);
  const waiting = contacts.filter((c) => c.mode === "nudge").length;
  const freshTop = contacts.filter((c) => c.mode === "cold" && (c.bucket === "A" || c.bucket === "B")).length;

  return h("div", { class: "view" },
    h("div", { class: "kpis" },
      kpi("بدهم رد منك", fmtNumber(replyAll.length), "آخر رسالة كانت منهم", () => showContacts(ctx, "reply"), replyAll.length > 0 ? "hot" : ""),
      kpi("بانتظار ردهم", fmtNumber(waiting), "بعتتلهم وما ردوا", () => showContacts(ctx, "waiting")),
      kpi("أولوية عالية جديدة", fmtNumber(freshTop), "A و B وما تواصلت معهم", () => showContacts(ctx, "fresh")),
      kpi("نسبة الرد", `${replies.rate}%`, `${fmtNumber(replies.replied)} من ${fmtNumber(replies.messaged)}`),
      kpi("شبكتك", fmtNumber(contacts.length), "شخص بعد دمج المكرر", () => showContacts(ctx, "")),
    ),
    h("div", { class: "task-grid" },
      taskCard(ctx, "ردّ عليهم", "message", "حكوا معك وآخر رسالة كانت منهم. الرد السريع بيفرق كثير.",
        replyAll.slice(0, LIST_SIZE).map((c) => ({ contact: c, note: [ago(c.daysSinceContact), lastFrom(c)].filter(Boolean).join(" · ") })), replyAll.length, "reply", "ما في حدا بستنى ردك. ممتاز!"),
      taskCard(ctx, "تابع معهم", "refresh", "بعتتلهم من أكثر من أسبوع وما ردوا. رسالة متابعة قصيرة بتكفي.",
        follow.slice(0, LIST_SIZE).map((s) => ({ contact: s.contact, note: `بعتتله ${ago(s.contact.daysSinceContact)}` })), follow.length, "waiting", "ما في متابعات مستحقة هلأ."),
      taskCard(ctx, "ابدأ معهم", "send", "أهم ناس بشبكتك حسب أهدافك، وما في تواصل قريب بينكم.",
        start.slice(0, LIST_SIZE).map((s) => ({ contact: s.contact, note: s.action === "reconnect" ? `آخر تواصل ${ago(s.contact.daysSinceContact)}` : s.contact.archetypeLabel })), start.length, "fresh", "عبّي أهدافك بملفك عشان تطلعلك اقتراحات."),
    ),
    setupCard(ctx, true),
  );
}
