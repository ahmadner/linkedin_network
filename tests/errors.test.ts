import { describe, expect, it } from "vitest";
import { OpenAiError } from "../src/ai/openai";
import { arabicError, errorText } from "../src/ui/errors";

describe("arabic error messages", () => {
  it("translates known extension and OpenAI errors", () => {
    expect(arabicError("Reached today's safe limit of 25. The rest stays in the list for tomorrow.")).toContain("الحد الآمن لليوم");
    expect(arabicError("The extension is not installed in this browser.")).toContain("الإضافة مش مركّبة");
    expect(arabicError("The extension did not answer.")).toContain("الإضافة مش مركّبة");
    expect(arabicError("Invalid API key: Incorrect API key provided")).toContain("مفتاح OpenAI");
    expect(arabicError("The model returned an empty post")).toContain("نتيجة فاضية");
    expect(arabicError("The model returned no slides")).toContain("نتيجة فاضية");
  });

  it("keeps numbers from the original message", () => {
    expect(arabicError("LinkedIn answered 429 for https://www.linkedin.com/voyager/api/x")).toBe("LinkedIn رد بخطأ (429). جرّب بعد شوي.");
    expect(arabicError("OpenAI error 503: Service Unavailable")).toContain("503");
  });

  it("returns messages it does not know as they are", () => {
    expect(arabicError("ما قدرت أقرأ الصورة.")).toBe("ما قدرت أقرأ الصورة.");
  });

  it("reads errors of any kind", () => {
    expect(errorText(new OpenAiError("Invalid API key: x", 401))).toContain("مفتاح OpenAI");
    expect(errorText("Failed to fetch")).toContain("اتصال بالإنترنت");
    expect(errorText(new DOMException("Aborted", "AbortError"))).toContain("وقّفت");
  });
});
