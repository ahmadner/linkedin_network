const API = "https://api.openai.com/v1";
const MAX_ATTEMPTS = 4;

export const DEFAULT_MODEL = "gpt-4.1-mini";

export interface AiConfig {
  key: string;
  model: string;
  signal?: AbortSignal;
}

export class OpenAiError extends Error {
  constructor(message: string, readonly status: number, readonly code = "") {
    super(message);
    this.name = "OpenAiError";
  }
}

export function isModelAccessError(error: unknown): error is OpenAiError {
  return error instanceof OpenAiError && (error.status === 403 || error.status === 404) && /model|verif/i.test(error.message);
}

export function isFatalError(error: unknown): error is OpenAiError {
  return error instanceof OpenAiError && (error.status === 401 || error.code === "insufficient_quota" || isModelAccessError(error));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

function headers(key: string): HeadersInit {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function errorFrom(response: Response): Promise<OpenAiError> {
  let detail = response.statusText;
  let code = "";
  try {
    const body = (await response.json()) as { error?: { message?: string; code?: string } };
    detail = body.error?.message ?? detail;
    code = body.error?.code ?? "";
  } catch {
    detail = response.statusText;
  }
  const hint = response.status === 401 ? "Invalid API key" : response.status === 429 ? "Rate limit or quota exceeded" : `OpenAI error ${response.status}`;
  return new OpenAiError(`${hint}: ${detail}`, response.status, code);
}

export async function postJson(key: string, path: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const body = JSON.stringify(payload);
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`${API}${path}`, { method: "POST", headers: headers(key), body, signal: signal ?? null });
    if (response.ok) return (await response.json()) as unknown;
    const error = await errorFrom(response);
    const retryable = (response.status === 429 && error.code !== "insufficient_quota") || response.status >= 500;
    if (!retryable || attempt >= MAX_ATTEMPTS) throw error;
    const after = Number(response.headers.get("retry-after"));
    await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 1000 * 2 ** attempt, signal);
  }
}

async function complete(key: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const data = (await postJson(key, "/chat/completions", payload, signal)) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

async function completeJson(cfg: AiConfig, model: string, system: string, user: string): Promise<unknown> {
  const content = await complete(cfg.key, {
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  }, cfg.signal);
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new OpenAiError("The model did not return valid JSON", 502);
  }
}

export async function chatJson(cfg: AiConfig, system: string, user: string): Promise<{ data: unknown; model: string }> {
  const model = cfg.model;
  try {
    return { data: await completeJson(cfg, model, system, user), model };
  } catch (error) {
    if (!isModelAccessError(error) || model === DEFAULT_MODEL) throw error;
    cfg.model = DEFAULT_MODEL;
    return { data: await completeJson(cfg, DEFAULT_MODEL, system, user), model: DEFAULT_MODEL };
  }
}

export async function verifyModel(key: string, model: string, signal?: AbortSignal): Promise<void> {
  await complete(key, { model, max_completion_tokens: 16, messages: [{ role: "user", content: "ping" }] }, signal);
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>, signal?: AbortSignal): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = [];
  let next = 0;
  let stopped = false;
  const worker = async (): Promise<void> => {
    while (next < items.length && !stopped && !signal?.aborted) {
      const index = next;
      next += 1;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index]!, index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
        if (isFatalError(reason)) stopped = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results.filter(Boolean);
}
