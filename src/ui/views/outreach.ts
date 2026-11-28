import type { Candidate, OutboxDraft, OutboxItem, OutboxKind, OutboxResponse } from "../../../extension/src/protocol";
import { conversationIndex } from "../../core/conversations";
import { profileLink, threadUrl } from "../../core/links";
import { INVITE_NOTE_LIMIT, MAX_BATCH, newCandidates, peopleSearchUrl, personalize } from "../../core/outreach";
import { newTracking } from "../../core/pipeline";
import type { Contact } from "../../core/types";
import { outboxCancel, outboxStart, outboxStatus, searchCandidates } from "../../linkedin/bridge";
import { avatar, badge, linkedinLinks, type Ctx } from "../context";
import { copyText, fmtNumber, h } from "../dom";
import { arabicError, errorText } from "../errors";

interface MessageDraft {
  key: string;
  slug: string;
  name: string;
  text: string;
}

interface InviteDraft extends Candidate {
  selected: boolean;
}

const view = {
  messages: [] as MessageDraft[],
  candidates: [] as InviteDraft[],
  note: "",
  search: "",
  confirmMessages: false,
  confirmInvites: false,
  status: null as OutboxResponse | null,
  extension: "unknown" as "unknown" | "ready" | "missing",
  tab: "message" as OutboxKind,
};

const applied = new Set<string>();
let poller: ReturnType<typeof setInterval> | undefined;

const ITEM_STATE: Record<OutboxItem["state"], [string, string]> = { pending: ["بالانتظار", ""], sent: ["انبعتت", "good"], failed: ["فشلت", "bad"] };


export function queueMessages(ctx: Ctx, items: Array<{ contact: Contact; text: string }>): void {
  let added = 0;
  for (const { contact, text } of items) {
    if (!contact.slug || !text.trim()) continue;
    const draft = { key: contact.id, slug: contact.slug, name: contact.fullName, text: text.trim() };
    const index = view.messages.findIndex((d) => d.key === draft.key);
    if (index >= 0) {
      view.messages[index] = draft;
      added += 1;
    } else if (view.messages.length < MAX_BATCH) {
      view.messages.push(draft);
      added += 1;
    }
  }
  view.confirmMessages = false;
  view.tab = "message";
  const skipped = items.length - added;
  ctx.toast(skipped > 0 ? `انضاف ${fmtNumber(added)} لقائمة الإرسال. ${fmtNumber(skipped)} ما انضافوا (بدون رابط أو رسالة، أو القائمة وصلت ${MAX_BATCH}).` : `انضاف ${fmtNumber(added)} لقائمة الإرسال`);
  ctx.go("outreach");
}

function markSent(ctx: Ctx, status: OutboxResponse): void {
  const job = status.job;
  if (!job || job.kind !== "message") return;
  const fresh = job.items.filter((i) => i.state === "sent" && !applied.has(`${job.id}|${i.key}`));
  if (fresh.length === 0) return;
  for (const i of fresh) applied.add(`${job.id}|${i.key}`);
  ctx.store.update((s) => {
    for (const i of fresh) s.tracking[i.key] = { ...newTracking(), ...s.tracking[i.key], status: "Message sent", dateSent: i.at.slice(0, 10) };
  });
}

function settle(status: OutboxResponse): void {
  const job = status.job;
  if (!job || job.state === "running") return;
  const sent = new Set(job.items.filter((i) => i.state === "sent").map((i) => i.key));
  if (job.kind === "message") view.messages = view.messages.filter((d) => !sent.has(d.key));
  else view.candidates = view.candidates.filter((c) => !sent.has(c.memberId || c.slug));
}

async function refresh(ctx: Ctx, rerender: () => void): Promise<void> {
  try {
    const status = await outboxStatus();
    const changed = status.job?.updatedAt !== view.status?.job?.updatedAt || view.extension !== "ready";
    view.status = status;
    view.extension = "ready";
    markSent(ctx, status);
    settle(status);
    if (status.job?.state !== "running") stopPolling();
    else startPolling(ctx, rerender);
    if (changed) rerender();
  } catch {
    stopPolling();
    if (view.extension !== "missing") {
      view.extension = "missing";
      rerender();
    }
  }
}

function startPolling(ctx: Ctx, rerender: () => void): void {
  poller ??= setInterval(() => void refresh(ctx, rerender), 3000);
}

function stopPolling(): void {
  clearInterval(poller);
  poller = undefined;
}

async function start(ctx: Ctx, rerender: () => void, kind: OutboxKind, items: OutboxDraft[]): Promise<void> {
  try {
    view.status = await outboxStart(kind, items);
    if (kind === "message") view.confirmMessages = false;
    else view.confirmInvites = false;
    startPolling(ctx, rerender);
    rerender();
  } catch (error) {
    ctx.toast(errorText(error), "error");
  }
}

async function stop(ctx: Ctx, rerender: () => void): Promise<void> {
  try {
    view.status = await outboxCancel();
    await refresh(ctx, rerender);
    rerender();
  } catch (error) {
    ctx.toast(errorText(error), "error");
  }
}

function riskNote(): HTMLElement {
  return h("details", { class: "advice warn-note" },
    h("summary", {}, h("strong", {}, "قواعد الأمان: "), "واحد كل 45 لـ 120 ثانية، وبحد أقصى 25 رسالة و20 طلب باليوم."),
    h("p", {}, "الإرسال الآلي ممكن يخالف شروط LinkedIn، والإرسال الكثير أو المتشابه ممكن يوقف حسابك مؤقتًا. عشان هيك الأداة بتبعت واحد كل 45 لـ 120 ثانية، بحد أقصى 25 رسالة و20 طلب تواصل باليوم، وبتوقف لحالها إذا LinkedIn أعطى أي تحذير أو طلب تحقق. راجع كل رسالة قبل ما تبعت، واكتبها شخصية قد ما بتقدر."),
  );
}

function meter(label: string, used: number, limit: number): HTMLElement {
  const fill = h("span", { class: "bar" });
  fill.style.inlineSize = `${Math.min(100, Math.round((used / Math.max(1, limit)) * 100))}%`;
  return h("div", { class: used >= limit ? "meter full" : "meter" },
    h("span", { class: "meter-label" }, label, h("span", { class: "muted" }, `${fmtNumber(used)} / ${fmtNumber(limit)}`)),
    h("span", { class: "bar-track", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": limit, "aria-valuenow": used, "aria-label": label }, fill));
}

function statusBar(rerender: () => void): HTMLElement {
  const usage = view.status?.usage;
  const state = view.extension;
  return h("section", { class: "card status-bar" },
    h("div", { class: "status-ext" },
      h("span", { class: `status-dot ${state}` }),
      h("span", {}, h("strong", {}, state === "ready" ? "الإضافة شغّالة" : state === "missing" ? "الإضافة مش موصولة" : "بفحص الإضافة…"),
        h("span", { class: "muted small" }, state === "missing" ? "بتقدر تستعمل \"انسخ وافتح\" وتبعت بإيدك." : state === "ready" ? "الإرسال بيصير من متصفحك وبحسابك." : "")),
      state === "missing" ? h("button", { type: "button", class: "secondary small", onclick: () => { view.extension = "unknown"; rerender(); } }, "جرّب مرة ثانية") : null,
    ),
    usage ? h("div", { class: "meters" },
      meter("رسائل اليوم", usage.message.day, usage.message.limits.day),
      meter("رسائل الأسبوع", usage.message.week, usage.message.limits.week),
      meter("طلبات اليوم", usage.invite.day, usage.invite.limits.day),
      meter("طلبات الأسبوع", usage.invite.week, usage.invite.limits.week),
    ) : null,
  );
}

function remaining(kind: OutboxKind): number {
  const u = view.status?.usage[kind];
  return u ? Math.max(0, Math.min(u.limits.day - u.day, u.limits.week - u.week)) : 0;
}

function jobCard(ctx: Ctx, rerender: () => void, kind: OutboxKind): HTMLElement | null {
  const job = view.status?.job;
  if (!job || job.kind !== kind) return null;
  const sent = job.items.filter((i) => i.state === "sent").length;
  const running = job.state === "running";
  const next = running && job.nextAt > Date.now() ? ` · الجاي بعد حوالي ${Math.ceil((job.nextAt - Date.now()) / 1000)} ثانية` : "";
  return h("div", { class: "job" },
    h("div", { class: "row tight wrap" },
      badge(running ? "شغّال" : job.state === "done" ? "خلص" : "وقف", running ? "" : job.state === "done" ? "good" : "warn"),
      h("span", {}, `${fmtNumber(sent)} من ${fmtNumber(job.items.length)} انبعتوا${next}`),
      running ? h("button", { type: "button", class: "secondary", onclick: () => void stop(ctx, rerender) }, "إيقاف") : null,
    ),
    job.error ? h("p", { class: "error-text" }, arabicError(job.error)) : null,
    h("ul", { class: "outbox-items" }, job.items.map((i) => h("li", {},
      badge(ITEM_STATE[i.state][0], ITEM_STATE[i.state][1]), " ", h("span", { dir: "auto" }, i.name || i.slug || i.memberId),
      i.error ? h("small", { class: "muted" }, ` · ${arabicError(i.error)}`) : null,
    ))),
  );
}

function confirmBox(checked: boolean, label: string, onChange: (v: boolean) => void): HTMLElement {
  const input = h("input", { type: "checkbox", checked });
  input.addEventListener("change", () => onChange(input.checked));
  return h("label", { class: "check" }, input, ` ${label}`);
}

function messageRow(ctx: Ctx, d: MessageDraft, rerender: () => void): HTMLElement {
  const contact = ctx.store.analysis.contacts.find((c) => c.id === d.key);
  const area = h("textarea", { rows: 5, dir: /[؀-ۿ]/.test(d.text) ? "rtl" : "ltr", "aria-label": d.name });
  area.value = d.text;
  const count = h("span", { class: "count" }, String(d.text.length));
  area.addEventListener("input", () => {
    d.text = area.value;
    count.textContent = String(area.value.length);
  });
  const copyOpen = async (): Promise<void> => {
    await copyText(d.text);
    const target = (contact && threadUrl(conversationIndex(ctx.store.state.dataset.messages).of(contact))) || profileLink(`https://www.linkedin.com/in/${d.slug}`);
    if (target) window.open(target, "_blank", "noopener,noreferrer");
  };
  const remove = (): void => {
    view.messages = view.messages.filter((m) => m !== d);
    rerender();
  };
  return h("li", { class: "draft" },
    h("div", { class: "row tight wrap" },
      h("span", { class: "person" }, contact ? avatar(ctx, contact) : null, h("strong", { dir: "auto" }, d.name)),
      contact ? linkedinLinks(ctx, contact, true) : null,
      count,
      h("button", { type: "button", class: "link", onclick: () => void copyOpen() }, "انسخ وافتح"),
      h("button", { type: "button", class: "link", onclick: remove }, "شيل"),
    ),
    area,
  );
}

function messagesCard(ctx: Ctx, rerender: () => void): HTMLElement {
  const running = view.status?.job?.state === "running";
  const ready = view.extension === "ready";
  const left = remaining("message");
  const send = (): void => {
    const items = view.messages.filter((d) => d.text.trim()).map((d): OutboxDraft => ({ key: d.key, kind: "message", slug: d.slug, memberId: "", name: d.name, text: d.text }));
    void start(ctx, rerender, "message", items);
  };
  return h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", {}, `رسائل جاهزة للإرسال (${fmtNumber(view.messages.length)})`)),
    jobCard(ctx, rerender, "message"),
    view.messages.length === 0
      ? h("div", { class: "empty-line" },
        h("p", {}, "القائمة فاضية. افتح أي شخص واضغط \"جهّز رسالة\"، أو اختار ناس من جهات الاتصال واضغط \"جهّز رسالة\"."),
        h("button", { type: "button", class: "secondary small", onclick: () => ctx.go("contacts") }, "روح لجهات الاتصال"))
      : h("ul", { class: "drafts" }, view.messages.map((d) => messageRow(ctx, d, rerender))),
    view.messages.length > 0 ? h("div", {},
      view.messages.length > left && ready ? h("p", { class: "muted small" }, `باقيلك ${fmtNumber(left)} رسالة اليوم، فالباقي بضل بالقائمة.`) : null,
      confirmBox(view.confirmMessages, "راجعت كل رسالة وبدي أبعتهم من حسابي", (v) => {
        view.confirmMessages = v;
        rerender();
      }),
      h("div", { class: "row" },
        h("button", { type: "button", disabled: !ready || running || !view.confirmMessages || left === 0, onclick: send }, `ابعت ${fmtNumber(Math.min(view.messages.length, left))} رسالة`),
        h("button", { type: "button", class: "secondary", onclick: () => { view.messages = []; rerender(); } }, "فضّي القائمة"),
      ),
    ) : null,
  );
}

function invitesCard(ctx: Ctx, rerender: () => void): HTMLElement {
  const running = view.status?.job?.state === "running";
  const ready = view.extension === "ready";
  const left = remaining("invite");
  const chosen = view.candidates.filter((c) => c.selected);
  const role = ctx.store.state.profile.me.target_roles[0] ?? ctx.store.state.profile.me.current_role;
  const location = ctx.store.state.profile.me.location.split(",")[0]?.trim() ?? "";
  if (!view.search) view.search = [role, location].filter(Boolean).join(" ");

  const known = new Set(ctx.store.analysis.contacts.map((c) => c.slug).filter(Boolean));
  const pull = async (): Promise<void> => {
    try {
      const result = await searchCandidates();
      const fresh = newCandidates(result.candidates, known);
      const have = new Set(view.candidates.map((c) => c.memberId || c.slug));
      const added = fresh.filter((c) => !have.has(c.memberId || c.slug)).map((c): InviteDraft => ({ ...c, selected: true }));
      view.candidates = [...view.candidates, ...added].slice(0, MAX_BATCH * 2);
      view.confirmInvites = false;
      ctx.toast(`لقيت ${fmtNumber(result.candidates.length)} شخص بالصفحة، انضاف منهم ${fmtNumber(added.length)} جديد. روح للصفحة الجاية بالبحث واسحب مرة ثانية إذا بدك أكثر.`);
      rerender();
    } catch (error) {
      ctx.toast(errorText(error), "error");
    }
  };
  const send = (): void => {
    const items = chosen.map((c): OutboxDraft => ({ key: c.memberId || c.slug, kind: "invite", slug: c.slug, memberId: c.memberId, name: c.name, text: personalize(view.note, c.name) }));
    void start(ctx, rerender, "invite", items);
  };

  const search = h("input", { type: "text", value: view.search, "aria-label": "كلمات البحث" });
  search.addEventListener("input", () => (view.search = search.value));
  const note = h("textarea", { rows: 3, placeholder: "مرحبًا {name}، شفت شغلك بـ ... وحابب نكون على تواصل." });
  note.value = view.note;
  const noteCount = h("span", { class: view.note.length > INVITE_NOTE_LIMIT ? "count over" : "count" }, `${view.note.length}/${INVITE_NOTE_LIMIT}`);
  note.addEventListener("input", () => {
    view.note = note.value;
    noteCount.textContent = `${note.value.length}/${INVITE_NOTE_LIMIT}`;
    noteCount.className = note.value.length > INVITE_NOTE_LIMIT ? "count over" : "count";
  });
  note.addEventListener("change", rerender);
  const tooLong = chosen.some((c) => personalize(view.note, c.name).length > INVITE_NOTE_LIMIT);

  return h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", {}, "طلبات تواصل لناس من مجالك")),
    h("ol", { class: "how" },
      h("li", {}, "اكتب شو بدك تدور وافتح البحث على LinkedIn (درجة ثانية بس)."),
      h("li", {}, "ارجع هون واضغط \"اسحب الأشخاص\". اللي بشبكتك أصلًا بيطلعوا لحالهم."),
      h("li", {}, "راجع القائمة، اختار مين، واكتب نوت إذا بدك، وبعدين ابعت."),
    ),
    jobCard(ctx, rerender, "invite"),
    h("div", { class: "row tight wrap" },
      search,
      h("a", { class: "button secondary", href: peopleSearchUrl(view.search), target: "_blank", rel: "noopener noreferrer", onclick: (e: Event) => ((e.currentTarget as HTMLAnchorElement).href = peopleSearchUrl(view.search)) }, "افتح البحث على LinkedIn"),
      h("button", { type: "button", disabled: !ready, onclick: () => void pull() }, "اسحب الأشخاص من صفحة البحث"),
    ),
    h("label", { class: "field" }, h("span", { class: "field-label" }, "نوت مع الطلب (اختياري). {name} بتصير الاسم الأول"), note, noteCount),
    view.candidates.length === 0 ? h("p", { class: "muted" }, "ما في أشخاص لسا.") : h("ul", { class: "drafts" }, view.candidates.map((c) => {
      const box = h("input", { type: "checkbox", checked: c.selected, "aria-label": c.name });
      box.addEventListener("change", () => {
        c.selected = box.checked;
        view.confirmInvites = false;
        rerender();
      });
      const preview = view.note.trim() ? personalize(view.note, c.name) : "";
      const url = c.slug ? `https://www.linkedin.com/in/${c.slug}` : `https://www.linkedin.com/in/${c.memberId}`;
      return h("li", { class: "draft" },
        h("label", { class: "row tight wrap" }, box,
          h("strong", { dir: "auto" }, c.name), c.degree ? badge(c.degree) : null,
          h("span", { class: "muted small", dir: "auto" }, c.headline),
          h("a", { href: url, target: "_blank", rel: "noopener noreferrer", class: "small" }, "البروفايل"),
        ),
        preview ? h("p", { class: "muted small", dir: "auto" }, preview) : null,
      );
    })),
    view.candidates.length > 0 ? h("div", {},
      tooLong ? h("p", { class: "error-text" }, `النوت أطول من ${INVITE_NOTE_LIMIT} حرف لبعض الأشخاص. قصّرها.`) : null,
      chosen.length > left && ready ? h("p", { class: "muted small" }, `باقيلك ${fmtNumber(left)} طلب اليوم، فالباقي بضل بالقائمة.`) : null,
      confirmBox(view.confirmInvites, "راجعت القائمة والنوت وبدي أبعت الطلبات من حسابي", (v) => {
        view.confirmInvites = v;
        rerender();
      }),
      h("div", { class: "row" },
        h("button", { type: "button", disabled: !ready || running || !view.confirmInvites || chosen.length === 0 || tooLong || left === 0, onclick: send }, `ابعت ${fmtNumber(Math.min(chosen.length, left))} طلب`),
        h("button", { type: "button", class: "secondary", onclick: () => { view.candidates = []; rerender(); } }, "فضّي القائمة"),
      ),
    ) : null,
  );
}

export function renderOutreach(ctx: Ctx, rerender: () => void): HTMLElement {
  if (view.extension === "unknown" || (view.status?.job?.state === "running" && !poller)) void refresh(ctx, rerender);
  const tabs: Array<[OutboxKind, string, number]> = [["message", "الرسائل", view.messages.length], ["invite", "طلبات التواصل", view.candidates.length]];
  return h("div", { class: "view" },
    statusBar(rerender),
    riskNote(),
    h("div", { class: "presets", role: "group", "aria-label": "نوع الإرسال" }, tabs.map(([id, label, n]) =>
      h("button", { type: "button", "aria-pressed": String(view.tab === id), onclick: () => { view.tab = id; rerender(); } }, label, h("span", { class: "preset-count" }, fmtNumber(n))))),
    view.tab === "message" ? messagesCard(ctx, rerender) : invitesCard(ctx, rerender),
  );
}
