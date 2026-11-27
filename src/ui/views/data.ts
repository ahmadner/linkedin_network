import type { JobStatus } from "../../../extension/src/protocol";
import { mergeExport, mergeSync } from "../../core/dataset";
import { cleanProfileUrl } from "../../core/text";
import { sanitizeProfile } from "../../core/profile";
import { profileGaps } from "../../core/messages";
import type { LogEntry, MeProfile } from "../../core/types";
import { filesFrom, importExportInBackground, loadStateInBackground, saveStateInBackground } from "../../io/background";
import { decodeBytes } from "../../io/csv";
import { clearStoredState } from "../../io/db";
import { readTrackingWorkbook, trackingTemplateWorkbook, XLSX_TYPE } from "../../io/excel";
import { LOG_FIELDS, logTemplateCsv, parseLogCsv, parseProfileJson, PROFILE_FIELDS, profileTemplateJson, TRACKING_FIELDS, type FieldGuide, type ImportIssue } from "../../io/imports";
import { emptyState, sanitizeTracking, stateFileName } from "../../io/state";
import { cancelSync, clearExtensionData, collectResult, detectExtension, LOCAL_TOOL, startSync, syncStatus } from "../../linkedin/bridge";
import { badge, card, type Ctx } from "../context";
import { append, download, fmtNumber, h, pickFiles } from "../dom";
import { icon } from "../icons";

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
  return card(ctx.store.hasData ? "المزامنة من LinkedIn" : "٢. تحديث مباشر من LinkedIn (Chrome Extension)", body);
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

interface ImportReport {
  title: string;
  summary: string;
  issues: ImportIssue[];
  error: string;
}

let lastReport: ImportReport | null = null;

const stamp = (): string => new Date().toISOString().slice(0, 10);

function report(ctx: Ctx, rerender: () => void, next: ImportReport): void {
  lastReport = next;
  if (next.error) ctx.toast(next.error, "error");
  else ctx.toast(next.summary);
  rerender();
}

function skippedText(n: number): string {
  return n > 0 ? ` وتجاهلت ${fmtNumber(n)} سطر` : "";
}

async function readText(file: File): Promise<string> {
  return decodeBytes(new Uint8Array(await file.arrayBuffer()));
}

async function importLog(ctx: Ctx, rerender: () => void): Promise<void> {
  const [file] = await pickFiles(".csv");
  if (!file) return;
  const title = `سجل التواصل: ${file.name}`;
  const result = parseLogCsv(await readText(file));
  if (result.error) return report(ctx, rerender, { title, summary: "", issues: result.issues, error: result.error });
  const logKey = (e: LogEntry): string => [e.profileUrl, e.fullName.toLowerCase(), e.channel.toLowerCase(), e.outgoing, e.sentAt, e.note].join("|");
  const existing = new Set(ctx.store.state.log.map(logKey));
  const fresh = result.items.filter((e) => {
    const k = logKey(e);
    if (existing.has(k)) return false;
    existing.add(k);
    return true;
  });
  const duplicates = result.items.length - fresh.length;
  if (fresh.length > 0) ctx.store.update((s) => (s.log = [...s.log, ...fresh]));
  report(ctx, rerender, {
    title,
    summary: `انضاف ${fmtNumber(fresh.length)} سطر للسجل${duplicates > 0 ? `، و ${fmtNumber(duplicates)} كانوا موجودين قبل` : ""}${skippedText(result.skipped)}.`,
    issues: result.issues,
    error: "",
  });
}

async function importTracking(ctx: Ctx, rerender: () => void): Promise<void> {
  const [file] = await pickFiles(".xlsx");
  if (!file) return;
  const title = `المتابعة: ${file.name}`;
  const result = await ctx.busy("قراءة ملف المتابعة…", async () => readTrackingWorkbook(await file.arrayBuffer()));
  if (!result) return;
  if (result.error) return report(ctx, rerender, { title, summary: "", issues: result.issues, error: result.error });
  const known = new Set(ctx.store.hasData ? ctx.store.analysis.contacts.map((c) => c.slug).filter(Boolean) : []);
  let unknown = 0;
  ctx.store.update((s) => {
    for (const [key, values] of result.items) {
      if (!known.has(key.slice(5))) unknown += 1;
      s.tracking[key] = sanitizeTracking({ ...s.tracking[key], ...values });
    }
  });
  report(ctx, rerender, {
    title,
    summary: `انحدّثت المتابعة لـ ${fmtNumber(result.items.size)} شخص${skippedText(result.skipped)}.${unknown > 0 ? ` منهم ${fmtNumber(unknown)} مش موجودين بشبكتك هلأ، وبتنطبق عليهم لما ينضافوا.` : ""}`,
    issues: result.issues,
    error: "",
  });
}

async function importProfileJson(ctx: Ctx, rerender: () => void): Promise<void> {
  const [file] = await pickFiles(".json");
  if (!file) return;
  const title = `البروفايل: ${file.name}`;
  const result = parseProfileJson(await readText(file));
  if (result.error) return report(ctx, rerender, { title, summary: "", issues: result.issues, error: result.error });
  const profile = sanitizeProfile(result.items);
  ctx.store.update((s) => (s.profile = profile));
  const gaps = profileGaps(profile).filter((g) => g.startsWith("ضروري"));
  report(ctx, rerender, {
    title,
    summary: "انقرا ملف البروفايل وتحدّث ملفك.",
    issues: [...result.issues, ...gaps.map((g) => ({ row: 0, message: `ناقص: ${g.replace(/^ضروري: /, "")}` }))],
    error: "",
  });
}

function fieldGuide(fields: FieldGuide[]): HTMLElement {
  return h("details", { class: "guide" },
    h("summary", {}, "شرح الأعمدة"),
    h("div", { class: "scroll" }, h("table", { class: "grid compact-rows" },
      h("thead", {}, h("tr", {}, ["العمود", "ضروري؟", "شو تكتب", "مثال"].map((t) => h("th", {}, t)))),
      h("tbody", {}, fields.map((f) => h("tr", {},
        h("td", { dir: "ltr" }, h("code", {}, f.header)),
        h("td", {}, f.required ? badge("ضروري", "warn") : h("span", { class: "muted" }, "اختياري")),
        h("td", {}, f.help),
        h("td", { dir: "auto", class: "muted small" }, f.example),
      ))),
    )),
  );
}

function importRow(title: string, text: string, fields: FieldGuide[], template: [string, () => void], upload: [string, () => void]): HTMLElement {
  return h("div", { class: "import-row" },
    h("div", { class: "import-text" }, h("strong", {}, title), h("p", { class: "muted small" }, text)),
    h("div", { class: "row tight wrap" },
      h("button", { type: "button", class: "secondary small", onclick: template[1] }, icon("download"), template[0]),
      h("button", { type: "button", class: "small", onclick: upload[1] }, upload[0]),
    ),
    fieldGuide(fields),
  );
}

function reportBox(): HTMLElement | null {
  const r = lastReport;
  if (!r) return null;
  return h("div", { class: r.error ? "import-report bad" : "import-report", role: "status" },
    h("div", { class: "card-head" }, h("strong", {}, r.title), h("button", { type: "button", class: "link", onclick: (e: Event) => { lastReport = null; (e.currentTarget as HTMLElement).closest(".import-report")?.remove(); } }, "إخفاء")),
    h("p", {}, r.error || r.summary),
    r.issues.length > 0 ? h("ul", { class: "notes" }, r.issues.map((i) => h("li", {}, i.row > 0 ? `سطر ${i.row}: ` : "", i.message))) : null,
  );
}

function importCard(ctx: Ctx, rerender: () => void): HTMLElement {
  const contacts = ctx.store.hasData ? ctx.store.analysis.contacts : [];
  const trackingTemplate = async (): Promise<void> => {
    const buffer = await ctx.busy("تجهيز قالب المتابعة…", () => trackingTemplateWorkbook(contacts));
    if (buffer) download(`tracking_template_${stamp()}.xlsx`, buffer, XLSX_TYPE);
  };
  return h("section", { class: "card" },
    h("h2", {}, "استيراد إضافي"),
    h("p", { class: "muted small" }, "نزّل القالب، عبّيه ببياناتك، وارفعه. السطر اللي رابطه example-person مثال وبيتجاهله النظام، فبتقدر تخليه أو تمسحه."),
    reportBox(),
    h("div", { class: "imports" },
      importRow("سجل تواصل خارجي", "تواصل صار برا LinkedIn (إيميل، واتساب، تلفون، لقاء). بيدخل بحساب مين تواصلت معه ومين ردّ.", LOG_FIELDS,
        ["نزّل القالب (CSV)", () => download("outreach_log_template.csv", logTemplateCsv(), "text/csv;charset=utf-8")],
        ["ارفع السجل", () => void importLog(ctx, rerender)]),
      importRow("متابعة الأشخاص", contacts.length > 0 ? `القالب فيه كل شبكتك (${fmtNumber(contacts.length)} شخص) مع متابعتهم الحالية. عدّل الحالة والملاحظات وارجع ارفعه. بيقبل كمان تقرير Excel قديم من الأداة.` : "حالة التواصل والملاحظات والوسوم لكل شخص. بيقبل كمان تقرير Excel قديم من الأداة.", TRACKING_FIELDS,
        ["نزّل القالب (Excel)", () => void trackingTemplate()],
        ["ارفع المتابعة", () => void importTracking(ctx, rerender)]),
      importRow("ملفي وأهدافي", "القالب هو ملفك الحالي كـ JSON. عدّل عليه وارجع ارفعه، والملف كامل بيحل محل الموجود.", PROFILE_FIELDS,
        ["نزّل القالب (JSON)", () => download("my_profile.json", profileTemplateJson(ctx.store.state.profile), "application/json")],
        ["ارفع البروفايل", () => void importProfileJson(ctx, rerender)]),
    ),
  );
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
  dropZone.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    void choose();
  });
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

  const exportCard = card(ctx.store.hasData ? "ملف الـ Export من LinkedIn" : "١. أول تحميل: ملف الـ Export من LinkedIn",
      h("p", {}, "أسرع طريقة لسحب كل الأشخاص وكل الرسائل دفعة وحدة. من LinkedIn: Settings & Privacy ← Data privacy ← Get a copy of your data، واختار Connections و Messages و Invitations."),
      dropZone,
      ctx.store.state.dataset.importMeta.exportLabel ? h("p", { class: "muted small" }, `آخر ملف: ${ctx.store.state.dataset.importMeta.exportLabel}`) : null,
  );
  const sources = ctx.store.hasData ? [extensionCard(ctx, rerender), exportCard] : [exportCard, extensionCard(ctx, rerender)];

  return h("div", { class: "view" },
    ctx.store.hasData ? stats(ctx) : null,
    h("div", { class: "cards-grid" }, sources),
    card(ctx.store.hasData ? "الحفظ والاسترجاع" : "٣. الحفظ والاسترجاع",
      h("p", {}, "كل شي بينحفظ تلقائيًا بهاد المتصفح. للنقل لجهاز ثاني أو كنسخة احتياطية، نزّل ملف zip فيه ملف YAML لكل نوع بيانات (الأشخاص، الرسائل، الدعوات، بروفايلك، المتابعة، الذكاء الاصطناعي، ونقطة آخر مزامنة)، وارفعه لاحقًا عشان تكمل من حيث وقفت."),
      h("div", { class: "row" },
        h("button", { type: "button", onclick: () => void saveState() }, "تنزيل ملف الحفظ (zip)"),
        h("button", { type: "button", class: "secondary", onclick: () => void loadState() }, "رفع ملف حفظ"),
      ),
      h("p", { class: "muted small" }, "مفتاح OpenAI ما بينحفظ بهاد الملف أبدًا."),
    ),
    importCard(ctx, rerender),
    h("section", { class: "card danger-zone" },
      h("div", { class: "card-head" },
        h("div", {}, h("h2", {}, "مسح البيانات"), h("p", { class: "muted small" }, "بيمسح كل شي من هاد المتصفح. نزّل ملف الحفظ أول.")),
        h("button", { type: "button", class: "danger", onclick: () => void reset() }, "مسح كل البيانات المحلية"),
      ),
    ),
  );
}
