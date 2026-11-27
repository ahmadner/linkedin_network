import type { JobResponse, JobStatus } from "./protocol";

declare const __TOOL_URL__: string;

const STATE_TEXT: Record<JobStatus["state"], string> = {
  running: "المزامنة شغّالة…",
  done: "آخر مزامنة خلصت بنجاح",
  error: "المزامنة وقفت بسبب خطأ",
  cancelled: "تم إيقاف المزامنة",
};

const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

function render(job: JobStatus | null): void {
  if (!job) {
    el("status").textContent = "ما في مزامنة لسا. افتح الأداة واضغط مزامنة.";
    return;
  }
  el("status").textContent = job.error ? `${STATE_TEXT[job.state]}: ${job.error}` : STATE_TEXT[job.state];
  el("counts").textContent = `أشخاص: ${job.counts.connections} · محادثات: ${job.counts.conversations} · رسائل: ${job.counts.messages}`;
  el("notes").textContent = job.notes.join(" ");
  el("cancel").hidden = job.state !== "running";
}

async function refresh(): Promise<void> {
  const response = (await chrome.runtime.sendMessage({ type: "status" })) as JobResponse | undefined;
  render(response?.job ?? null);
}

el("open").addEventListener("click", () => void chrome.tabs.create({ url: __TOOL_URL__ }));
el("cancel").addEventListener("click", () => void chrome.runtime.sendMessage({ type: "cancel" }).then(refresh));
void refresh();
setInterval(() => void refresh(), 2000);
