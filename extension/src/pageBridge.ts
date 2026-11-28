import { EXTENSION_CHANNEL, PAGE_CHANNEL, type BridgedRequest, type ErrorResponse, type ExtensionEnvelope, type PageEnvelope } from "./protocol";

function isEnvelope(value: unknown): value is PageEnvelope {
  const v = value as Partial<PageEnvelope> | null;
  return typeof v === "object" && v !== null && v.channel === PAGE_CHANNEL && typeof v.id === "number" && typeof v.request?.type === "string";
}

function reply(id: number, response: unknown): void {
  window.postMessage({ channel: EXTENSION_CHANNEL, id, response } satisfies ExtensionEnvelope, location.origin);
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin || !isEnvelope(event.data)) return;
  const { id, request } = event.data;
  chrome.runtime.sendMessage({ bridge: true, request } satisfies BridgedRequest)
    .then((response: unknown) => reply(id, response))
    .catch((error: unknown) => reply(id, { ok: false, error: error instanceof Error ? error.message : String(error) } satisfies ErrorResponse));
});
