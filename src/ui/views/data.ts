import type { JobStatus } from "../../../extension/src/protocol";
import { mergeExport, mergeSync } from "../../core/dataset";
import { cleanProfileUrl } from "../../core/text";
import { sanitizeProfile } from "../../core/profile";
import type { MeProfile } from "../../core/types";
import { filesFrom, importExportInBackground, loadStateInBackground, saveStateInBackground } from "../../io/background";
import { cell, decodeBytes, tableFrom } from "../../io/csv";
import { clearStoredState } from "../../io/db";
import { readPreviousTracking } from "../../io/excel";
import { emptyState, sanitizeLog, sanitizeTracking, stateFileName } from "../../io/state";
import { cancelSync, clearExtensionData, collectResult, detectExtension, LOCAL_TOOL, startSync, syncStatus } from "../../linkedin/bridge";
import { badge, card, type Ctx } from "../context";
import { append, download, fmtNumber, h, pickFiles } from "../dom";

let poller: ReturnType<typeof setInterval> | undefined;
let lastJob: JobStatus | null = null;
let extensionVersion = "";
let includeMessages = true;
let refreshPhotos = false;
let detectionStarted = false;

const PHASE_AR: Record<string, string> = {
  starting: "تجهيز",
  profile: "قراءة بروفايلك",
  connections: "سحب الأشخاص",
  discovery: "تجهيز الرسائل",
  conversations: "سحب المحادثات",
  messages: "سحب الرسائل",
  finished: "انتهى",
};

function fillEmptyProfile(me: MeProfile, suggested: Partial<MeProfile>): MeProfile {
  const next = { ...me };
  for (const [key, value] of Object.entries(suggested) as Array<[keyof MeProfile, MeProfile[keyof MeProfile]]>) {
    const current = next[key];
    const empty = Array.isArray(current) ? current.length === 0 : !current;
    if (empty && value !== undefined) (next as Record<string, unknown>)[key] = value;
  }
  return next;
}

async function importExportFiles(ctx: Ctx, files: File[]): Promise<void> {
  if (files.length === 0) return;
  const label = files.map((f) => f.name).join(", ");
  const imported = await ctx.busy("قراءة ملف الـ Export…", async (progress) => {
    progress("بقرا الملفات بالخلفية، الملفات الكبيرة بتاخذ شوي وقت");
    return importExportInBackground(await filesFrom(files), label);
  });
  if (!imported) return;
  ctx.store.update((s) => {
    s.dataset = mergeExport(s.dataset, imported);
    s.profile.me = fillEmptyProfile(s.profile.me, imported.suggestedProfile);
  });
  ctx.toast(`تم: ${fmtNumber(imported.connections.length)} شخص، ${fmtNumber(imported.messages.length)} رسالة، ${fmtNumber(imported.invitations.length)} دعوة`);
}

async function finishSync(ctx: Ctx, job: JobStatus): Promise<void> {
  const payload = await ctx.busy("نقل البيانات من الـ Extension…", (progress) => collectResult(job, progress));
  if (!payload) return;
  let people = 0;
  let messages = 0;
  ctx.store.update((s) => {
    const known = new Set(s.dataset.connections.map((c) => cleanProfileUrl(c.profileUrl).slug).filter(Boolean));
    const before = s.dataset.messages.length;
    s.dataset = mergeSync(s.dataset, payload);
    people = payload.connections.filter((c) => !known.has(c.slug)).length;
    messages = s.dataset.messages.length - before;
  });
  await clearExtensionData().catch(() => undefined);
  ctx.toast(`تمت المزامنة: ${fmtNumber(people)} شخص جديد، ${fmtNumber(payload.connections.length - people)} تحدّثت بياناتهم، ${fmtNumber(messages)} رسالة جديدة`);
  for (const n of payload.notes) ctx.toast(n);
}

function stopPolling(): void {
  clearInterval(poller);
  poller = undefined;
}

function poll(ctx: Ctx, rerender: () => void): void {
  stopPolling();
  poller = setInterval(() => {
    syncStatus()
      .then(async (job) => {
        lastJob = job;
        if (!job || job.state !== "running") {
          stopPolling();
          if (job?.state === "done") await finishSync(ctx, job);
          else if (job?.state === "error") ctx.toast(job.error, "error");
        }
        rerender();
      })
      .catch((error: unknown) => {
        stopPolling();
        ctx.toast(error instanceof Error ? error.message : String(error), "error");
      });
  }, 2000);
}

function jobLine(job: JobStatus | null): HTMLElement | null {
  if (!job) return null;
  const state = { running: "شغّالة", done: "خلصت", error: "وقفت بخطأ", cancelled: "انلغت" }[job.state];
  return h("div", { class: "job" },
    h("p", {}, badge(state, job.state === "error" ? "bad" : job.state === "done" ? "good" : ""), " ", PHASE_AR[job.phase] ?? job.phase),
    h("p", { class: "muted" }, `أشخاص: ${fmtNumber(job.counts.connections)} · محادثات: ${fmtNumber(job.counts.conversations)} · رسائل: ${fmtNumber(job.counts.messages)}`),
    job.error ? h("p", { class: "error-text" }, job.error) : null,
    job.notes.length > 0 ? h("ul", { class: "notes" }, job.notes.map((n) => h("li", {}, n))) : null,
  );
}

function extensionCard(ctx: Ctx, rerender: () => void): HTMLElement {
  const { sync } = ctx.store.state.dataset;
  const body = h("div", {});
  const installed = extensionVersion !== "";
  const running = lastJob?.state === "running";

  const start = async (): Promise<void> => {
    try {
      lastJob = await startSync(
        { newestConnectionAt: sync.newestConnectionAt, newestMessageAt: sync.newestMessageAt },
        { messages: includeMessages, photos: refreshPhotos, maxConversations: 3000 },
      );
      poll(ctx, rerender);
      rerender();
    } catch (error) {
      ctx.toast(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const messagesToggle = h("input", { type: "checkbox", checked: includeMessages });
  messagesToggle.addEventListener("change", () => (includeMessages = messagesToggle.checked));
  const photosToggle = h("input", { type: "checkbox", checked: refreshPhotos });
  photosToggle.addEventListener("change", () => (refreshPhotos = photosToggle.checked));

  append(body, [
    h("p", {}, installed ? badge(`الـ Extension مركّب (v${extensionVersion})`, "good") : badge("الـ Extension مش مركّب أو مش مسموح لهاد الموقع", "bad")),
    h("p", { class: "muted" }, sync.lastSyncAt
      ? `آخر مزامنة: ${sync.lastSyncAt.slice(0, 16).replace("T", " ")}. المزامنة الجاية بتسحب بس الأشخاص والرسائل الأحدث من هيك.`
      : "ما في مزامنة لسا. أول مزامنة بتسحب كل شي، فالأفضل ترفع الـ Export أول."),
    h("label", { class: "check" }, messagesToggle, " اسحب الرسائل كمان (أبطأ)"),
    h("label", { class: "check" }, photosToggle, " حدّث بيانات وصور كل الأشخاص (بيمر على كل شبكتك، أبطأ)"),
    h("div", { class: "row" },
      h("button", { type: "button", disabled: !installed || running, onclick: () => void start() }, "مزامنة الآن"),
      running ? h("button", { type: "button", class: "secondary", onclick: () => void cancelSync().then(rerender) }, "إيقاف") : null,
      LOCAL_TOOL ? null : h("a", { class: "button secondary", href: "./linkedin-network-extension.zip", download: true }, "تحميل الـ Extension"),
    ),
    jobLine(lastJob),
    installed ? null : h("details", { class: "help" },
      h("summary", {}, "طريقة التركيب (مرة وحدة)"),
      h("ol", {},
        LOCAL_TOOL
          ? h("li", {}, "شغّل npm run extension:local بمجلد المشروع.")
          : h("li", {}, "حمّل ملف الـ Extension وفك الضغط عنه بمجلد ثابت."),
        h("li", {}, "افتح chrome://extensions وفعّل Developer mode."),
        h("li", {}, LOCAL_TOOL ? "اضغط Load unpacked واختار المجلد dist-extension/local." : "اضغط Load unpacked واختار المجلد."),
        h("li", {}, "تأكد إنك مسجّل دخول على linkedin.com بنفس المتصفح، وارجع حدّث هاي الصفحة."),
      ),
    ),
    h("p", { class: "muted small" }, "الـ Extension بيقرا بياناتك انت بس، بجلستك، ببطء وعلى دفعات. ما بيعدّل ولا بيبعت أي شي على LinkedIn. بس استخدام أدوات آلية تقنيًا ضد شروط LinkedIn، فالخطر صغير بس مش صفر."),
  ]);
  return card("٢. تحديث مباشر من LinkedIn (Chrome Extension)", body);
}

function stats(ctx: Ctx): HTMLElement {
  const d = ctx.store.state.dataset;
  const a = ctx.store.hasData ? ctx.store.analysis : null;
  const item = (label: string, value: string): HTMLElement => h("div", { class: "stat" }, h("span", {}, label), h("strong", {}, value));
  return h("div", { class: "stats" },
    item("أشخاص (بعد الدمج)", fmtNumber(a?.contacts.length ?? 0)),
    item("رسائل", fmtNumber(d.messages.length)),
    item("دعوات", fmtNumber(d.invitations.length)),
    item("آخر Export", d.importMeta.exportImportedAt ? d.importMeta.exportImportedAt.slice(0, 10) : "—"),
    item("آخر مزامنة", d.sync.lastSyncAt ? d.sync.lastSyncAt.slice(0, 10) : "—"),
    item("الحفظ التلقائي", ctx.store.saveError ? "فشل" : ctx.store.savedAt || "جاهز"),
  );
}

async function importLog(ctx: Ctx): Promise<void> {
  const [file] = await pickFiles(".csv");
  if (!file) return;
  const table = tableFrom(decodeBytes(new Uint8Array(await file.arrayBuffer())), (c) => c.includes("full_name") || c.includes("profile_url"));
  if (!table) return ctx.toast("الملف لازم يكون بنفس أعمدة outreach_log.csv", "error");
  const inbound = /^(in|incoming|inbound|received|receive|reply|replied|response|responded|them|from them|واصل|وصل|رد|ورد|منهم|استلمت)$/i;
  const entries = table.rows.map((r) => {
    const direction = cell(r, table.column("direction")).toLowerCase().replace(/[\s_-]+/g, " ");
    return sanitizeLog({
      profileUrl: cell(r, table.column("profile_url")),
      fullName: cell(r, table.column("full_name")),
      channel: cell(r, table.column("channel")),
      outgoing: !(inbound.test(direction) || /^(in|rec|repl|resp|from)/.test(direction)),
      sentAt: cell(r, table.column("sent_at")).slice(0, 10),
      note: cell(r, table.column("note")),
    });
  }).filter((e) => e.fullName || e.profileUrl);
  ctx.store.update((s) => (s.log = [...s.log, ...entries]));
  ctx.toast(`انضاف ${entries.length} سطر للسجل`);
}

async function importPreviousReport(ctx: Ctx): Promise<void> {
  const [file] = await pickFiles(".xlsx");
  if (!file) return;
  const rows = await ctx.busy("قراءة التقرير القديم…", async () => readPreviousTracking(await file.arrayBuffer()));
  if (!rows) return;
  let carried = 0;
  ctx.store.update((s) => {
    for (const [url, values] of rows) {
      const { slug } = cleanProfileUrl(url);
      if (!slug) continue;
      s.tracking[`slug:${slug}`] = sanitizeTracking({ ...s.tracking[`slug:${slug}`], ...values });
      carried += 1;
    }
  });
  ctx.toast(`انتقلت المتابعة لـ ${carried} شخص`);
}

async function importProfileJson(ctx: Ctx): Promise<void> {
  const [file] = await pickFiles(".json");
  if (!file) return;
  try {
    const profile = sanitizeProfile(JSON.parse(await file.text()));
    ctx.store.update((s) => (s.profile = profile));
    ctx.toast("انقرا ملف my_profile.json");
  } catch {
    ctx.toast("ملف JSON مش صالح", "error");
  }
}

export function renderData(ctx: Ctx, rerender: () => void): HTMLElement {
  if (!detectionStarted) {
    detectionStarted = true;
    void detectExtension().then((hello) => {
      if (!hello) return;
      extensionVersion = hello.version;
      lastJob = hello.job;
      if (hello.job?.state === "running") poll(ctx, rerender);
      else if (hello.job?.state === "done" && hello.job.finishedAt > ctx.store.state.dataset.sync.lastSyncAt) void finishSync(ctx, hello.job).then(rerender);
      rerender();
    });
  }

  const dropZone = h("div", { class: "drop", tabindex: 0, role: "button" }, h("strong", {}, "اسحب ملف الـ Export هون أو اضغط للاختيار"), h("span", { class: "muted" }, "ملف .zip كامل، أو Connections.csv و messages.csv و Invitations.csv"));
  const choose = async (): Promise<void> => importExportFiles(ctx, await pickFiles(".zip,.csv", true));
  dropZone.addEventListener("click", () => void choose());
  dropZone.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && void choose());
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("over");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("over"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("over");
    void importExportFiles(ctx, [...(e.dataTransfer?.files ?? [])]);
  });

  const saveState = async (): Promise<void> => {
    const bytes = await ctx.busy("تجهيز ملف الحفظ…", () => saveStateInBackground(ctx.store.state));
    if (bytes) download(stateFileName(), new Uint8Array(bytes), "application/zip");
  };
  const loadState = async (): Promise<void> => {
    const [file] = await pickFiles(".zip");
    if (!file) return;
    const state = await ctx.busy("قراءة ملف الحفظ…", async () => loadStateInBackground(new Uint8Array(await file.arrayBuffer())));
    if (!state) return;
    ctx.store.replace(state);
    ctx.toast("رجعت كل البيانات من ملف الحفظ");
  };
  const reset = async (): Promise<void> => {
    if (!window.confirm("رح تنمسح كل البيانات من هاد المتصفح. نزّلت ملف الحفظ قبل؟")) return;
    await clearStoredState();
    ctx.store.replace(emptyState());
    ctx.toast("انمسحت البيانات المحلية");
  };

  return h("div", { class: "view" },
    stats(ctx),
    card("١. أول تحميل: ملف الـ Export من LinkedIn",
      h("p", {}, "أسرع طريقة لسحب كل الأشخاص وكل الرسائل دفعة وحدة. من LinkedIn: Settings & Privacy ← Data privacy ← Get a copy of your data، واختار Connections و Messages و Invitations."),
      dropZone,
      ctx.store.state.dataset.importMeta.exportLabel ? h("p", { class: "muted small" }, `آخر ملف: ${ctx.store.state.dataset.importMeta.exportLabel}`) : null,
    ),
    extensionCard(ctx, rerender),
    card("٣. الحفظ والاسترجاع",
      h("p", {}, "كل شي بينحفظ تلقائيًا بهاد المتصفح. للنقل لجهاز ثاني أو كنسخة احتياطية، نزّل ملف zip فيه ملف YAML لكل نوع بيانات (الأشخاص، الرسائل، الدعوات، بروفايلك، المتابعة، الذكاء الاصطناعي، ونقطة آخر مزامنة)، وارفعه لاحقًا عشان تكمل من حيث وقفت."),
      h("div", { class: "row" },
        h("button", { type: "button", onclick: () => void saveState() }, "تنزيل ملف الحفظ (zip)"),
        h("button", { type: "button", class: "secondary", onclick: () => void loadState() }, "رفع ملف حفظ"),
      ),
      h("p", { class: "muted small" }, "مفتاح OpenAI ما بينحفظ بهاد الملف أبدًا."),
    ),
    card("استيراد إضافي",
      h("div", { class: "row wrap" },
        h("button", { type: "button", class: "secondary", onclick: () => void importLog(ctx) }, "سجل تواصل خارجي (outreach_log.csv)"),
        h("button", { type: "button", class: "secondary", onclick: () => void importPreviousReport(ctx) }, "متابعة من تقرير Excel قديم"),
        h("button", { type: "button", class: "secondary", onclick: () => void importProfileJson(ctx) }, "بروفايل من my_profile.json"),
      ),
      h("div", { class: "row" }, h("button", { type: "button", class: "danger", onclick: () => void reset() }, "مسح كل البيانات المحلية")),
    ),
  );
}
