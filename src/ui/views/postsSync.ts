import type { HelloResponse, PostsJob } from "../../../extension/src/protocol";
import { mergeSyncedPosts } from "../../core/content";
import { cancelPostsSync, collectPosts, detectExtension, postsSyncStatus, startPostsSync, supportsPosts } from "../../linkedin/bridge";
import { type Ctx } from "../context";
import { fmtNumber, h } from "../dom";
import { arabicError } from "../errors";
import { icon } from "../icons";

const POLL_MS = 3000;
const RECENT_DAYS = 90;

interface SyncUi {
  detected: boolean;
  hello: HelloResponse | null;
  job: PostsJob | null;
  all: boolean;
  merging: boolean;
}

const ui: SyncUi = { detected: false, hello: null, job: null, all: false, merging: false };
let poller: ReturnType<typeof setInterval> | undefined;

const STATE_TEXT: Record<PostsJob["state"], string> = {
  running: "بقرأ منشوراتك من LinkedIn",
  done: "خلصت القراءة",
  error: "القراءة وقفت",
  cancelled: "انوقفت القراءة",
};

function stopPolling(): void {
  clearInterval(poller);
  poller = undefined;
}

async function finish(ctx: Ctx, job: PostsJob): Promise<void> {
  if (ui.merging || !job.finishedAt || job.finishedAt <= ctx.store.state.content.postsSyncedAt) return;
  ui.merging = true;
  try {
    const synced = await ctx.busy("دمج المنشورات…", (progress) => collectPosts((label) => progress(label)));
    if (!synced) return;
    let result = { added: 0, updated: 0 };
    ctx.store.update((s) => {
      const merged = mergeSyncedPosts(s.content.posts, synced);
      s.content.posts = merged.posts;
      s.content.postsSyncedAt = job.finishedAt;
      result = merged;
    }, { recompute: false });
    ctx.toast(`تم: ${fmtNumber(synced.length)} منشور انقرأ، ${fmtNumber(result.added)} جديد، و${fmtNumber(result.updated)} تحدّثت أرقامه`);
  } finally {
    ui.merging = false;
  }
}

function poll(ctx: Ctx): void {
  if (poller) return;
  poller = setInterval(() => {
    void postsSyncStatus().then(async (job) => {
      const changed = job?.updatedAt !== ui.job?.updatedAt || job?.state !== ui.job?.state;
      ui.job = job;
      if (!job || job.state !== "running") {
        stopPolling();
        if (job?.state === "done") await finish(ctx, job);
      }
      if (changed) ctx.store.emit();
    }).catch(() => stopPolling());
  }, POLL_MS);
}

function detect(ctx: Ctx): void {
  if (ui.detected) return;
  ui.detected = true;
  void detectExtension().then(async (hello) => {
    ui.hello = hello;
    ui.job = hello?.postsJob ?? null;
    if (ui.job?.state === "running") poll(ctx);
    else if (ui.job?.state === "done") await finish(ctx, ui.job);
    ctx.store.emit();
  });
}

function sinceDate(ctx: Ctx): string {
  if (ui.all || !ctx.store.state.content.postsSyncedAt) return "";
  return new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
}

async function start(ctx: Ctx): Promise<void> {
  const job = await ctx.busy("تشغيل الإضافة…", () => startPostsSync(sinceDate(ctx)));
  if (!job) return;
  ui.job = job;
  poll(ctx);
  ctx.store.emit();
}

async function cancel(ctx: Ctx): Promise<void> {
  await cancelPostsSync().catch(() => undefined);
  ui.job = await postsSyncStatus().catch(() => ui.job);
  ctx.store.emit();
}

function statusLine(job: PostsJob): HTMLElement {
  const counts = `${fmtNumber(job.counts.posts)} منشور · ${fmtNumber(job.counts.pages)} صفحة`;
  return h("div", { class: job.state === "error" ? "job error-text" : "job" },
    h("strong", {}, `${STATE_TEXT[job.state]}: `, counts),
    job.error ? h("p", { class: "small" }, arabicError(job.error)) : null,
    job.notes.length ? h("p", { class: "muted small" }, job.notes.join(" ")) : null,
  );
}

export function postsSyncCard(ctx: Ctx): HTMLElement {
  detect(ctx);
  const synced = ctx.store.state.content.postsSyncedAt;
  const head = h("h2", { class: "with-icon" }, icon("refresh"), "اسحب منشوراتك بالإضافة");
  if (!ui.hello) {
    return h("section", { class: "card" }, head,
      h("p", { class: "muted small" }, "إضافة Chrome بتقرأ منشوراتك القديمة وأرقام التفاعل عليها (التفاعلات والتعليقات وإعادة النشر) من حسابك مباشرة، بدون ما تستنى ملف الـ Export."),
      h("button", { type: "button", class: "secondary small", onclick: () => ctx.go("data") }, "ركّب الإضافة من صفحة البيانات"),
    );
  }
  if (!supportsPosts(ui.hello)) {
    return h("section", { class: "card warn-note" }, head,
      h("p", {}, `الإضافة عندك نسخة ${ui.hello.version} وما بتعرف تقرأ المنشورات. نزّل النسخة الجديدة من صفحة البيانات وركّبها مكان القديمة، وبعدين حدّث هالصفحة.`),
      h("button", { type: "button", class: "secondary small", onclick: () => ctx.go("data") }, "روح لصفحة البيانات"),
    );
  }
  const running = ui.job?.state === "running";
  const all = h("input", { type: "checkbox", checked: ui.all || !synced, disabled: !synced || running });
  all.addEventListener("change", () => (ui.all = all.checked));
  return h("section", { class: "card" }, head,
    h("p", { class: "muted small" }, "بتقرأ منشوراتك بس (مش منشورات غيرك) من صفحة الـ Activity بحسابك، صفحة صفحة وبهدوء. إذا سكّرت المتصفح بتكمّل من حيث وقفت. ما بتنشر ولا بتغيّر إشي."),
    h("p", { class: "muted small" }, synced ? `آخر سحب: ${synced.slice(0, 16).replace("T", " ")}. السحب الجاي بيجيب المنشورات الجديدة وبيحدّث أرقام آخر ${RECENT_DAYS} يوم.` : "أول مرة بيسحب كل منشوراتك."),
    h("label", { class: "check" }, all, "اسحب كل المنشورات من الأول"),
    ui.job ? statusLine(ui.job) : null,
    h("div", { class: "row" },
      running
        ? h("button", { type: "button", class: "secondary", onclick: () => void cancel(ctx) }, "إيقاف")
        : h("button", { type: "button", onclick: () => void start(ctx) }, icon("refresh"), synced ? "حدّث منشوراتي وأرقامها" : "اسحب منشوراتي"),
    ),
    h("p", { class: "hint" }, "عدد المشاهدات (Impressions) LinkedIn ما بيعطيه بهالطريقة غالبًا، فبتقدر تدخّله بإيدك تحت كل منشور."),
  );
}
