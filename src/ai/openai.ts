const API = "https://api.openai.com/v1";
const MAX_ATTEMPTS = 4;

export class OpenAiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "OpenAiError";
  }
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
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    detail = body.error?.message ?? detail;
  } catch {
    detail = response.statusText;
  }
  const hint = response.status === 401 ? "Invalid API key" : response.status === 429 ? "Rate limit or quota exceeded" : `OpenAI error ${response.status}`;
  return new OpenAiError(`${hint}: ${detail}`, response.status);
}

export async function verifyKey(key: string, model: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(`${API}/models/${encodeURIComponent(model)}`, { headers: headers(key), signal });
  if (!response.ok) throw await errorFrom(response);
}

export interface ChatRequest {
  key: string;
  model: string;
  system: string;
  user: string;
  signal?: AbortSignal;
}

export async function chatJson(req: ChatRequest): Promise<unknown> {
  const body = JSON.stringify({
    model: req.model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
  });
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`${API}/chat/completions`, { method: "POST", headers: headers(req.key), body, signal: req.signal });
    if (response.ok) {
      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content ?? "";
      try {
        return JSON.parse(content) as unknown;
      } catch {
        throw new OpenAiError("The model did not return valid JSON", 502);
      }
    }
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= MAX_ATTEMPTS) throw await errorFrom(response);
    const after = Number(response.headers.get("retry-after"));
    await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 1000 * 2 ** attempt, req.signal);
  }
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>, signal?: AbortSignal): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length && !signal?.aborted) {
      const index = next;
      next += 1;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index]!, index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
        if (reason instanceof OpenAiError && reason.status === 401) throw reason;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
