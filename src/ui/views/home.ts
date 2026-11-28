import { getApiKey } from "../../ai/key";
import { conversationIndex } from "../../core/conversations";
import { todayIso } from "../../core/dates";
import { AGE_BANDS, buildInsights, FUNNEL_BENCHMARK, type AgeBand, type Bottleneck, type FunnelStageKey, type Insights, type Step } from "../../core/insights";
import { GAP_KIND_LABEL, GAP_LEVEL_LABEL, type Gap } from "../../core/opportunities";
import type { Contact } from "../../core/types";
import { barFill, columnChart, lineChart } from "../charts";
import { ago, avatar, badge, linkedinLinks, type Ctx } from "../context";
import { fmtNumber, h } from "../dom";
import { icon, type IconName } from "../icons";
import { openContact, showContacts, type Preset } from "./contacts";

const LIST_SIZE = 6;
const QUEUE_SIZE = 3;
const GAP_LIST = 5;
const RECENT_WEEKS = 4;
const LATE_AFTER: AgeBand[] = ["8-30", "31-90", "90+"];

const BAND_LABEL: Record<AgeBand, string> = { "0-2": "يومين", "3-7": "أسبوع", "8-30": "شهر", "31-90": "3 شهور", "90+": "أقدم" };
const BAND_TITLE: Record<AgeBand, string> = { "0-2": "من 0 لـ 2 يوم", "3-7": "من 3 لـ 7 أيام", "8-30": "من 8 لـ 30 يوم", "31-90": "من شهر لـ 3 شهور", "90+": "أكثر من 3 شهور" };
const STAGE_LABEL: Record<FunnelStageKey, string> = { priority: "أولوية عالية", contacted: "راسلتهم", replied: "ردّوا", converted: "موعد أو ترشيح" };
const GAP_TONE: Record<Gap["level"], string> = { none: "bad", weak: "warn", ok: "good" };

interface Task {
  contact: Contact;
  note: string;
}

interface StepView {
  title: string;
  why: string;
  icon: IconName;
  action: [string, () => void];
  extra?: HTMLElement | null;
}

type Tone = "good" | "bad" | "flat";

function snippet(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function duration(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return "أقل من ساعة";
  if (hours < 24) return `${Math.round(hours)} ساعة`;
  return `${Math.round(hours / 24)} يوم`;
}

function shortDay(iso: string): string {
  return `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;
}

function shortMonth(month: string): string {
  return `${Number(month.slice(5, 7))}/${month.slice(2, 4)}`;
}

function external(href: string, label: string, className = "button secondary small"): HTMLElement {
  return h("a", { href, target: "_blank", rel: "noopener noreferrer", class: className }, label, icon("external"));
}

function nameList(names: string[]): string {
  return names.length <= 2 ? names.join(" و ") : `${names.slice(0, 2).join("، ")} و ${fmtNumber(names.length - 2)} غيرهم`;
}

function stepView(ctx: Ctx, step: Step, i: Insights): StepView {
  const { backlog, content, coverage } = i;
  switch (step.kind) {
    case "profile":
      return { icon: "user", title: "كمّل ملفك وأهدافك", why: "الأولويات والرسائل والاقتراحات كلها بتنحسب من منصبك وأهدافك، وهلأ ناقصين.", action: ["عبّي ملفي", () => ctx.go("profile")] };
    case "reply": {
      const first = backlog.queue[0];
      const why = [
        backlog.freshImportant > 0 ? `${fmtNumber(backlog.freshImportant)} منهم أولوية عالية أو Recruiters.` : "",
        backlog.oldestFreshDays !== null ? `أقدم رسالة ${ago(backlog.oldestFreshDays)}.` : "",
        "الرد خلال يوم أو يومين بيضاعف فرصة إن المحادثة تكمل.",
      ].filter(Boolean).join(" ");
      return {
        icon: "message",
        title: `ردّ على ${fmtNumber(step.count)} شخص بستنوا ردك`,
        why,
        action: ["افتح قائمة الردود", () => showContacts(ctx, "reply")],
        extra: first ? h("button", { type: "button", class: "secondary", onclick: () => openContact(ctx, first.id) }, `ابدأ بـ ${first.fullName}`) : null,
      };
    }
    case "post_due":
      return { icon: "calendar", title: `انشر ${fmtNumber(step.count)} منشور موعده اليوم أو فات`, why: "المنشورات مجدولة وجاهزة، ضل بس تنشرها.", action: ["افتح المحتوى", () => ctx.go("content")] };
    case "sync":
      return { icon: "refresh", title: "حدّث بياناتك من LinkedIn", why: `آخر تحديث ${ago(step.count)}، فالردود والأرقام هون ممكن تكون ناقصة.`, action: ["روح للمزامنة", () => ctx.go("data")] };
    case "follow_up":
      return { icon: "refresh", title: `تابع مع ${fmtNumber(step.count)} شخص ما ردوا`, why: "بعتتلهم من أكثر من أسبوع. رسالة متابعة قصيرة وحدة بترجع المحادثة.", action: ["شوف مين", () => showContacts(ctx, "waiting")] };
    case "post": {
      const last = content.daysSinceLast === null ? "وما في منشورات مسجلة لسا" : `وآخر منشور ${ago(content.daysSinceLast)}`;
      return {
        icon: "pen",
        title: content.ready > 0 ? `انشر واحد من منشوراتك الجاهزة (${fmtNumber(content.ready)})` : "اكتب منشور هالأسبوع",
        why: `نشرت ${fmtNumber(content.last30)} من ${fmtNumber(content.target30)} بآخر 30 يوم ${last}.`,
        action: [content.ready > 0 ? "افتح المنشورات" : "اكتب منشور", () => ctx.go("content")],
      };
    }
    case "gap": {
      const level = coverage.none > 0 ? "none" : "weak";
      const gaps = coverage.gaps.filter((g) => g.level === level);
      const first = gaps[0];
      return {
        icon: "target",
        title: level === "none" ? `ضيف ناس بـ ${nameList(gaps.map((g) => g.target))}` : `قوّي شبكتك بـ ${nameList(gaps.map((g) => g.target))}`,
        why: level === "none" ? `${fmtNumber(gaps.length)} من أهدافك ما فيها ولا شخص بشبكتك. ابدأ بـ Recruiter، وبعده مدير الفريق.` : `${fmtNumber(gaps.length)} من أهدافك فيها ناس قليلين أو ما فيها Recruiter أو صاحب قرار.`,
        action: ["شوف الفجوات", () => ctx.go("opportunities")],
        extra: first ? external(first.search, `دوّر بـ ${first.target}`, "button secondary") : null,
      };
    }
    case "start":
      return { icon: "send", title: `ابدأ مع ${fmtNumber(step.count)} شخص من أهم ناسك`, why: "أولوية A و B حسب أهدافك، وما في بينكم تواصل قريب.", action: ["شوف مين", () => showContacts(ctx, "fresh")] };
    case "close_stale":
      return { icon: "check", title: `نظّف ${fmtNumber(step.count)} محادثة قديمة`, why: "رسائل صار لها أكثر من شهر بدون رد. رد بسطر أو سكّرها من صفحة الشخص، عشان قائمتك تضل دقيقة.", action: ["افتحها", () => showContacts(ctx, "reply")] };
  }
}

function nextStepCard(ctx: Ctx, i: Insights): HTMLElement {
  const [top, ...rest] = i.steps;
  const main = top ? stepView(ctx, top, i) : null;
  return h("section", { class: "next", "aria-labelledby": "next-title" },
    h("div", { class: "next-main" },
      h("h2", { class: "next-eyebrow", id: "next-title" }, icon(main?.icon ?? "check"), "خطوتك الجاية"),
      h("p", { class: "next-title", dir: "auto" }, main?.title ?? "ما في شي مستعجل هلأ"),
      h("p", { class: "next-why" }, main?.why ?? "رديت على الكل، والمتابعات والنشر ماشيين حسب هدفك. استغل الوقت وابدأ مع حدا جديد من أهم ناسك."),
      main ? h("div", { class: "row wrap" }, h("button", { type: "button", onclick: main.action[1] }, main.action[0]), main.extra) : null,
    ),
    rest.length > 0 ? h("div", { class: "next-queue" },
      h("h3", {}, "وبعدها"),
      h("ol", {}, rest.slice(0, QUEUE_SIZE).map((step) => {
        const v = stepView(ctx, step, i);
        return h("li", {}, h("button", { type: "button", class: "queue-item", onclick: v.action[1] },
          icon(v.icon),
          h("span", {}, h("strong", {}, v.title), h("small", {}, v.why))));
      })),
    ) : null,
  );
}

function change(diff: number | null, text: string, betterWhenUp: boolean): HTMLElement | null {
  if (diff === null) return null;
  const tone: Tone = diff === 0 ? "flat" : (diff > 0) === betterWhenUp ? "good" : "bad";
  const arrow = diff === 0 ? "=" : diff > 0 ? "▲" : "▼";
  return h("span", { class: `delta ${tone}` }, h("span", { "aria-hidden": "true" }, arrow), text, h("span", { class: "sr-only" }, " مقارنة بالفترة اللي قبلها"));
}

function tile(label: string, value: string, note: string, delta: HTMLElement | null, onClick?: () => void, tone = ""): HTMLElement {
  const body = [h("span", { class: "pulse-label" }, label), h("strong", {}, value), delta, h("small", {}, note)];
  return onClick
    ? h("button", { type: "button", class: `kpi pulse clickable ${tone}`, onclick: onClick }, ...body)
    : h("div", { class: `kpi pulse ${tone}` }, ...body);
}

function pulseRow(ctx: Ctx, i: Insights): HTMLElement {
  const { backlog, replies, speed, growth, content, coverage } = i;
  const rateDiff = replies.rate !== null && replies.previousRate !== null ? replies.rate - replies.previousRate : null;
  const speedDiff = speed.medianHours !== null && speed.previousMedianHours !== null ? Math.round(speed.medianHours - speed.previousMedianHours) : null;
  const growthDiff = growth.last30 + growth.previous30 > 0 ? growth.last30 - growth.previous30 : null;
  const postDiff = content.last30 + content.previous30 > 0 ? content.last30 - content.previous30 : null;
  const covered = coverage.ok + coverage.weak;
  return h("div", { class: "kpis pulse-row" },
    tile("بستنوا ردك", fmtNumber(backlog.fresh),
      backlog.fresh > 0 ? `${fmtNumber(backlog.freshImportant)} مهمين · أقدمهم ${ago(backlog.oldestFreshDays)}` : backlog.stale > 0 ? `و ${fmtNumber(backlog.stale)} أقدم من شهر` : "رديت على الكل",
      null, () => showContacts(ctx, "reply"), backlog.freshImportant > 0 ? "hot" : ""),
    tile("نسبة الرد على رسائلك", replies.rate === null ? "—" : `${replies.rate}%`,
      replies.started > 0 ? `${fmtNumber(replies.replied)} من ${fmtNumber(replies.started)} محادثة بدأتها بآخر 90 يوم` : "ما بدأت محادثات بآخر 90 يوم",
      change(rateDiff, rateDiff === null ? "" : `${Math.abs(rateDiff)} نقطة`, true), () => ctx.go("outreach")),
    tile("سرعة ردك", duration(speed.medianHours),
      speed.samples > 0 ? `الوسيط على ${fmtNumber(speed.samples)} رد بآخر 90 يوم` : "ما في ردود بآخر 90 يوم",
      change(speedDiff, speedDiff === null ? "" : speedDiff === 0 ? "نفس السرعة" : `${speedDiff < 0 ? "أسرع" : "أبطأ"} بـ ${duration(Math.abs(speedDiff))}`, false), () => ctx.go("messages")),
    tile("ناس جدد بآخر 30 يوم", `+${fmtNumber(growth.last30)}`,
      growth.last30 > 0 ? `${percent(growth.targeted30, growth.last30)}% منهم أولوية A أو B` : "ما انضاف حدا هالشهر",
      change(growthDiff, `${fmtNumber(Math.abs(growthDiff ?? 0))} شخص`, true), () => showContacts(ctx, "")),
    tile("منشوراتك بآخر 30 يوم", `${fmtNumber(content.last30)} من ${fmtNumber(content.target30)}`,
      content.daysSinceLast === null ? "ما في منشورات مسجلة" : `آخر منشور ${ago(content.daysSinceLast)}`,
      change(postDiff, `${fmtNumber(Math.abs(postDiff ?? 0))} منشور`, true), () => ctx.go("content"), content.target30 > 0 && content.last30 < content.target30 / 2 ? "warn" : ""),
    tile("تغطية أهدافك", coverage.total > 0 ? `${fmtNumber(covered)} من ${fmtNumber(coverage.total)}` : "—",
      coverage.total === 0 ? "حدّد شركات وقطاعات بملفك" : coverage.none > 0 ? `${fmtNumber(coverage.none)} ما فيها ولا شخص` : `${fmtNumber(coverage.ok)} منها قوية`,
      null, () => ctx.go("opportunities"), coverage.none > 0 ? "warn" : ""),
  );
}

function chartCard(title: string, takeaway: string, body: HTMLElement, className = "", actions: HTMLElement | null = null): HTMLElement {
  return h("section", { class: `card insight ${className}`.trim() },
    h("div", { class: "card-head" }, h("h2", {}, title), actions),
    h("p", { class: "takeaway" }, takeaway),
    body,
  );
}

function activityCard(i: Insights): HTMLElement {
  const recent = i.weeks.slice(-RECENT_WEEKS);
  const before = i.weeks.slice(-RECENT_WEEKS * 2, -RECENT_WEEKS);
  const sum = (list: typeof i.weeks, key: "messaged" | "heard"): number => list.reduce((s, w) => s + w[key], 0);
  const now = sum(recent, "messaged");
  const then = sum(before, "messaged");
  const heard = sum(recent, "heard");
  const trend = then === 0 ? (now > 0 ? "بعد ما كنت واقف قبلها" : "") : now === then ? "نفس الـ 4 اللي قبلهم" : `${Math.abs(percent(now - then, then))}% ${now > then ? "أكثر" : "أقل"} من الـ 4 اللي قبلهم`;
  const takeaway = now === 0 && heard === 0
    ? "ما في رسائل بآخر 4 أسابيع. ابدأ مع 3 لـ 5 أشخاص من أهم ناسك هالأسبوع."
    : `راسلت ${fmtNumber(now)} شخص بآخر 4 أسابيع${trend ? `، ${trend}` : ""}، و ${fmtNumber(heard)} شخص راسلوك.`;
  return chartCard("نشاطك الأسبوعي", takeaway,
    lineChart("نشاطك الأسبوعي", [{ name: "ناس راسلتهم", className: "s1" }, { name: "ناس راسلوك", className: "s2" }],
      i.weeks.map((w) => ({ label: shortDay(w.end), title: `${shortDay(w.start)} – ${shortDay(w.end)}`, values: [w.messaged, w.heard] })),
      { summary: takeaway, labelHeader: "الأسبوع" }),
    "span-2");
}

const BOTTLENECK_ADVICE: Record<Bottleneck, (rate: number) => string> = {
  contacted: (r) => `هون بتوقف: راسلت ${r}% بس من أهم ناسك. ابدأ مع 5 منهم هالأسبوع.`,
  replied: (r) => `هون بتوقف: ${r}% بس ردّوا. خلّي أول رسالة أقصر وأخص بالشخص، واذكر شي من شغله.`,
  converted: (r) => `هون بتوقف: ${r}% بس من الردود وصلت لموعد أو ترشيح. لما حدا يرد، اقترح مكالمة 15 دقيقة.`,
};

function funnelCard(ctx: Ctx, i: Insights): HTMLElement {
  const { stages, bottleneck, tracked } = i.funnel;
  const top = stages[0]?.count ?? 0;
  const rateOf = (index: number): number => percent(stages[index]?.count ?? 0, stages[index - 1]?.count ?? 0);
  const bottleIndex = stages.findIndex((s) => s.key === bottleneck);
  const takeaway = top === 0
    ? "ما في حدا بأولوية A أو B لسا. عبّي أهدافك بملفك عشان تنحسب الأولويات."
    : bottleneck ? BOTTLENECK_ADVICE[bottleneck](rateOf(bottleIndex)) : "كل مرحلة فوق المعدل المطلوب. كمّل بنفس الوتيرة.";
  const action: Record<Bottleneck, [string, () => void]> = {
    contacted: ["ابدأ مع الأولويات", () => showContacts(ctx, "fresh")],
    replied: ["حسّن رسائلك", () => ctx.go("outreach")],
    converted: ["افتح المحادثات", () => ctx.go("messages")],
  };
  return chartCard("قمع التواصل مع أهم ناسك", takeaway,
    h("div", { class: "funnel-wrap" },
      h("ol", { class: "funnel", "aria-label": "مراحل التواصل" }, stages.map((s, index) => {
        const key = s.key;
        const weak = key === bottleneck;
        const bench = key === "priority" ? null : FUNNEL_BENCHMARK[key];
        return h("li", { class: weak ? "weak" : "" },
          h("span", { class: "funnel-label" }, STAGE_LABEL[key]),
          h("span", { class: "bar-track" }, barFill(top > 0 ? s.count / top : 0, weak ? "late" : "")),
          h("span", { class: "funnel-value" }, fmtNumber(s.count)),
          h("span", { class: "funnel-rate" }, bench === null ? "" : `${rateOf(index)}% من اللي قبل · الهدف ${Math.round(bench * 100)}%`, weak ? badge("هون بتوقف", "bad") : null),
        );
      })),
      tracked ? null : h("p", { class: "muted small" }, "مرحلة الموعد بتنحسب من الحالة اللي بتحطها لكل شخص (في موعد أو رشّحني)، فما دخلت بتحديد وين بتوقف."),
      bottleneck ? h("div", { class: "row" }, h("button", { type: "button", class: "secondary small", onclick: action[bottleneck][1] }, action[bottleneck][0])) : null,
    ));
}

function backlogCard(ctx: Ctx, i: Insights): HTMLElement {
  const { bands, total } = i.backlog;
  const late = bands.filter((b) => LATE_AFTER.includes(b.band));
  const lateCount = late.reduce((s, b) => s + b.count, 0);
  const lateImportant = late.reduce((s, b) => s + b.important, 0);
  const takeaway = total === 0
    ? "ما في حدا بستنى ردك. ممتاز."
    : lateCount === 0
      ? `كل الـ ${fmtNumber(total)} رسالة عمرها أقل من أسبوع. رد عليهم وهم لسا متذكرين.`
      : `${fmtNumber(total)} محادثة آخر رسالة فيها من الشخص الثاني، و ${fmtNumber(lateCount)} منها صار لها أكثر من أسبوع${lateImportant > 0 ? ` (${fmtNumber(lateImportant)} من ناس مهمين)` : ""}. رد على المهمين أول، واللي أقدم من شهر رد بسطر أو سكّرها.`;
  return chartCard("عمر الرسائل اللي بتستنى ردك", takeaway,
    columnChart("عمر الرسائل اللي بتستنى ردك", [{ name: "مهمين: A و B و Recruiters", className: "s1" }, { name: "غيرهم", className: "s-muted" }],
      AGE_BANDS.map((band) => {
        const row = bands.find((b) => b.band === band)!;
        return { label: BAND_LABEL[band], title: BAND_TITLE[band], values: [row.important, row.count - row.important] };
      }),
      { stacked: true, summary: takeaway, labelHeader: "عمر الرسالة" }),
    "", total > 0 ? h("button", { type: "button", class: "link", onclick: () => showContacts(ctx, "reply") }, "شوف الكل") : null);
}

function growthCard(i: Insights): HTMLElement {
  const months = i.growth.months;
  const targeted = months.reduce((s, m) => s + m.targeted, 0);
  const all = months.reduce((s, m) => s + m.targeted + m.other, 0);
  const share = percent(targeted, all);
  const takeaway = all === 0
    ? "ما انضاف حدا لشبكتك بآخر 12 شهر. ابعت دعوات لناس بمجالك من صفحة الإرسال."
    : `انضاف ${fmtNumber(all)} شخص بآخر 12 شهر، ${share}% منهم من الفئات المستهدفة (A و B). ${share < 30 ? "ركّز دعواتك الجاية على ناس بأهدافك." : "نموك ماشي باتجاه أهدافك."}`;
  return chartCard("مين عم ينضاف لشبكتك", takeaway,
    columnChart("مين عم ينضاف لشبكتك", [{ name: "أولوية A و B", className: "s1" }, { name: "غيرهم", className: "s-muted" }],
      months.map((m) => ({ label: shortMonth(m.month), title: m.month, values: [m.targeted, m.other] })),
      { stacked: true, summary: takeaway, labelHeader: "الشهر" }));
}

function contentCard(ctx: Ctx, i: Insights): HTMLElement {
  const { content, weeks } = i;
  const recent = weeks.slice(-RECENT_WEEKS).reduce((s, w) => s + w.posts, 0);
  const next = content.nextScheduled ? ` المنشور الجاي مجدول ${shortDay(content.nextScheduled)}.` : content.ready > 0 ? ` عندك ${fmtNumber(content.ready)} جاهز للنشر.` : "";
  const takeaway = content.target > 0
    ? `نشرت ${fmtNumber(recent)} بآخر 4 أسابيع، وهدفك ${fmtNumber(content.target * RECENT_WEEKS)}.${next}`
    : `نشرت ${fmtNumber(recent)} بآخر 4 أسابيع. حط هدف أسبوعي من إعدادات المحتوى.${next}`;
  return chartCard("وتيرة النشر", takeaway,
    columnChart("وتيرة النشر", [{ name: "منشورات", className: "s1" }],
      weeks.map((w) => ({ label: shortDay(w.end), title: `${shortDay(w.start)} – ${shortDay(w.end)}`, values: [w.posts] })),
      { ...(content.target > 0 ? { reference: { value: content.target, label: `هدفك ${fmtNumber(content.target)} بالأسبوع` } } : {}), summary: takeaway, labelHeader: "الأسبوع" }),
    "", h("button", { type: "button", class: "link", onclick: () => ctx.go("content") }, "افتح المحتوى"));
}

function coverageCard(ctx: Ctx, i: Insights): HTMLElement {
  const { gaps, total, none, weak, ok } = i.coverage;
  const takeaway = total === 0
    ? "ما حددت شركات أو قطاعات أو تخصصات مستهدفة. حددها بملفك عشان تعرف وين شبكتك ناقصة."
    : `${fmtNumber(ok)} قوية، ${fmtNumber(weak)} ضعيفة، و ${fmtNumber(none)} ما فيها ولا شخص.`;
  const shown = gaps.filter((g) => g.level !== "ok").slice(0, GAP_LIST);
  return chartCard("وين شبكتك ناقصة", takeaway,
    total === 0
      ? h("div", { class: "row" }, h("button", { type: "button", class: "secondary small", onclick: () => ctx.go("profile") }, "حدّد أهدافك"))
      : shown.length === 0
        ? h("p", { class: "empty-line" }, "كل أهدافك فيها ناس و Recruiters وأصحاب قرار.")
        : h("ul", { class: "gap-list" }, shown.map((g) => h("li", {},
          h("span", { class: "gap-text" },
            h("span", { class: "gap-name" }, badge(GAP_LEVEL_LABEL[g.level], GAP_TONE[g.level]), h("strong", { dir: "auto" }, g.target), h("span", { class: "muted small" }, GAP_KIND_LABEL[g.kind])),
            h("span", { class: "gap-meta muted small" }, [`${fmtNumber(g.contacts)} شخص`, `${fmtNumber(g.recruiters)} Recruiter`, `${fmtNumber(g.decisionMakers)} صاحب قرار`].flatMap((part, n) => [n > 0 ? h("span", { "aria-hidden": "true" }, "·") : null, h("bdi", {}, part)]))),
          external(g.search, "دوّر")))),
    "span-all", total > 0 ? h("button", { type: "button", class: "link", onclick: () => ctx.go("opportunities") }, "كل الفجوات") : null);
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

  const state = ctx.store.state;
  const { contacts } = ctx.store.analysis;
  const insights = buildInsights({
    contacts,
    messages: state.dataset.messages,
    posts: state.content.posts,
    drafts: state.content.drafts,
    postsPerWeek: state.content.settings.postsPerWeek,
    profile: state.profile,
    dataAt: state.dataset.sync.lastSyncAt || state.dataset.importMeta.exportImportedAt,
    today: todayIso(),
  });
  const index = conversationIndex(state.dataset.messages);
  const lastFrom = (c: Contact): string => {
    const last = [...index.of(c)].reverse().find((m) => !m.outgoing);
    return last?.content ? `"${snippet(last.content)}"` : "";
  };
  const { backlog, followUps, starts } = insights;

  return h("div", { class: "view home" },
    nextStepCard(ctx, insights),
    pulseRow(ctx, insights),
    h("div", { class: "insight-grid" },
      activityCard(insights),
      funnelCard(ctx, insights),
      backlogCard(ctx, insights),
      growthCard(insights),
      contentCard(ctx, insights),
      coverageCard(ctx, insights),
    ),
    h("div", { class: "task-grid" },
      taskCard(ctx, "ردّ عليهم", "message", "آخر رسالة كانت منهم خلال آخر شهر. المهمين أول، وبعدهم الأحدث.",
        backlog.queue.slice(0, LIST_SIZE).map((c) => ({ contact: c, note: [ago(c.daysSinceContact), lastFrom(c)].filter(Boolean).join(" · ") })), backlog.fresh, "reply", "ما في حدا بستنى ردك. ممتاز!"),
      taskCard(ctx, "تابع معهم", "refresh", "بعتتلهم من أكثر من أسبوع وما ردوا. رسالة متابعة قصيرة بتكفي.",
        followUps.slice(0, LIST_SIZE).map((s) => ({ contact: s.contact, note: `بعتتله ${ago(s.contact.daysSinceContact)}` })), followUps.length, "waiting", "ما في متابعات مستحقة هلأ."),
      taskCard(ctx, "ابدأ معهم", "send", "أهم ناس بشبكتك حسب أهدافك، وما في تواصل قريب بينكم.",
        starts.slice(0, LIST_SIZE).map((s) => ({ contact: s.contact, note: s.action === "reconnect" ? `آخر تواصل ${ago(s.contact.daysSinceContact)}` : s.contact.archetypeLabel })), starts.length, "fresh", "عبّي أهدافك بملفك عشان تطلعلك اقتراحات."),
    ),
    setupCard(ctx, true),
  );
}
