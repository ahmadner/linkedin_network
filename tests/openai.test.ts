import { afterEach, describe, expect, it, vi } from "vitest";
import { chatJson, DEFAULT_MODEL, isFatalError, mapLimit, OpenAiError, type AiConfig } from "../src/ai/openai";

const VERIFY_ERROR = {
  error: { message: "Your organization must be verified to use the model `gpt-5-mini`.", code: "model_not_found" },
};

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function ok(content: unknown): Response {
  return reply(200, { choices: [{ message: { content: JSON.stringify(content) } }] });
}

function modelOf(init: RequestInit | undefined): string {
  return (JSON.parse(String(init?.body)) as { model: string }).model;
}

afterEach(() => vi.unstubAllGlobals());

describe("openai client", () => {
  it("falls back to the default model once when the chosen model is not available", async () => {
    const models: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const model = modelOf(init);
      models.push(model);
      return model === "gpt-5-mini" ? reply(404, VERIFY_ERROR) : ok({ answer: 1 });
    }));
    const cfg: AiConfig = { key: "sk-test", model: "gpt-5-mini" };
    const first = await chatJson(cfg, "system", "user");
    const second = await chatJson(cfg, "system", "user");
    expect(first).toEqual({ data: { answer: 1 }, model: DEFAULT_MODEL });
    expect(second.model).toBe(DEFAULT_MODEL);
    expect(cfg.model).toBe(DEFAULT_MODEL);
    expect(models).toEqual(["gpt-5-mini", DEFAULT_MODEL, DEFAULT_MODEL]);
  });

  it("does not retry an invalid key and treats it as fatal", async () => {
    const fetchMock = vi.fn(async () => reply(401, { error: { message: "Incorrect API key provided" } }));
    vi.stubGlobal("fetch", fetchMock);
    const error = await chatJson({ key: "sk-bad", model: DEFAULT_MODEL }, "s", "u").catch((e: unknown) => e);
    expect(isFatalError(error)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops a batch after the first fatal error", async () => {
    let calls = 0;
    const results = await mapLimit(Array.from({ length: 18 }, (_, i) => i), 3, async () => {
      calls += 1;
      await Promise.resolve();
      throw new OpenAiError("OpenAI error 404: model not available", 404, "model_not_found");
    });
    expect(calls).toBe(3);
    expect(results).toHaveLength(3);
  });

  it("keeps going after an error that is not fatal", async () => {
    const results = await mapLimit([1, 2, 3, 4], 2, async (n) => {
      if (n === 2) throw new OpenAiError("The model did not return valid JSON", 502);
      return n;
    });
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
  });
});
