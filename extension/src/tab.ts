export type TabOwner = "sync" | "outbox" | "posts";

export class StopError extends Error {}
export class AuthError extends Error {}
export class ChallengeError extends Error {}
export class RateLimitError extends Error {}

export const isFatal = (error: unknown): boolean =>
  error instanceof StopError || error instanceof AuthError || error instanceof ChallengeError || error instanceof RateLimitError;

export const FEED_URL = "https://www.linkedin.com/feed/";
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const MAX_RETRIES = 3;
const openedTabs = new Map<number, TabOwner>();

async function waitForTab(tabId: number): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return;
    await sleep(500);
  }
}

export async function openTab(url: string, owner: TabOwner): Promise<number> {
  const tab = await chrome.tabs.create({ url, active: false });
  if (tab.id === undefined) throw new Error("Could not open a LinkedIn tab");
  openedTabs.set(tab.id, owner);
  await waitForTab(tab.id);
  await sleep(3000);
  return tab.id;
}

export async function linkedinTab(url: string, owner: TabOwner): Promise<number> {
  const tabs = await chrome.tabs.query({ url: "https://www.linkedin.com/*" });
  const existing = tabs.find((t) => t.id !== undefined && t.status === "complete" && (url === FEED_URL || (t.url ?? "").startsWith(url)));
  return existing?.id ?? openTab(url, owner);
}

export async function closeTabs(owner: TabOwner): Promise<void> {
  const ids = [...openedTabs].filter(([, o]) => o === owner).map(([id]) => id);
  for (const id of ids) openedTabs.delete(id);
  await Promise.all(ids.map((id) => chrome.tabs.remove(id).catch(() => undefined)));
}

interface PageResult {
  status: number;
  url: string;
  body: unknown;
}

export interface RequestOptions {
  method?: "GET" | "POST";
  body?: string;
  stop?: () => boolean;
  retry?: boolean;
}

export async function pageRequest(tabId: number, url: string, options: RequestOptions = {}): Promise<unknown> {
  const method = options.method ?? "GET";
  for (let attempt = 0; ; attempt += 1) {
    if (options.stop?.()) throw new StopError("cancelled");
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [url, method, options.body ?? null],
      func: async (target: string, verb: string, payload: string | null): Promise<PageResult> => {
        const token = /JSESSIONID="?([^";]+)/.exec(document.cookie)?.[1];
        if (!token) return { status: 401, url: target, body: null };
        const graphql = target.includes("/graphql");
        const headers: Record<string, string> = {
          "csrf-token": token,
          "x-restli-protocol-version": "2.0.0",
          "x-li-lang": "en_US",
          accept: graphql ? "application/graphql" : verb === "POST" ? "application/json" : "application/vnd.linkedin.normalized+json+2.1",
        };
        if (payload !== null) headers["content-type"] = "text/plain;charset=UTF-8";
        const response = await fetch(target, { method: verb, credentials: "include", headers, body: payload ?? undefined });
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }
        return { status: response.status, url: response.url, body };
      },
    });
    const result = injection?.result as PageResult | undefined;
    if (!result) throw new Error("LinkedIn tab did not answer");
    if (result.status === 999 || result.url.includes("/checkpoint/") || result.url.includes("/authwall")) {
      throw new ChallengeError("LinkedIn asked for a security check. Open linkedin.com, finish the check, and wait a day before sending again.");
    }
    if (result.status >= 200 && result.status < 300) return result.body;
    if (result.status === 401 || result.status === 403) throw new AuthError("Not signed in to LinkedIn in this browser (or the session expired). Sign in and try again.");
    const canRetry = options.retry !== false && method === "GET";
    if ((result.status === 429 || result.status >= 500) && canRetry && attempt < MAX_RETRIES) {
      await sleep(30_000 * (attempt + 1));
      continue;
    }
    if (result.status === 429) throw new RateLimitError("LinkedIn says there are too many requests. Wait a day before trying again.");
    throw new Error(`LinkedIn answered ${result.status} for ${url.split("?")[0]}`);
  }
}

export async function resourceUrls(tabId: number): Promise<string[]> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => performance.getEntriesByType("resource").map((e) => e.name),
  });
  return (injection?.result as string[] | undefined) ?? [];
}
