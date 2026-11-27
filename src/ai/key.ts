const KEY = "lnt.openai.key";

function storage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function getApiKey(): string {
  return storage("session")?.getItem(KEY) ?? storage("local")?.getItem(KEY) ?? "";
}

export function isKeyRemembered(): boolean {
  return Boolean(storage("local")?.getItem(KEY));
}

export function setApiKey(key: string, remember: boolean): void {
  const value = key.trim();
  storage("local")?.removeItem(KEY);
  storage("session")?.removeItem(KEY);
  if (!value) return;
  storage(remember ? "local" : "session")?.setItem(KEY, value);
}

export function looksLikeKey(value: string): boolean {
  return /^sk-[A-Za-z0-9_-]{20,}$/.test(value.trim());
}
