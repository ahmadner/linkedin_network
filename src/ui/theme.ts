import { h } from "./dom";
import { icon } from "./icons";

export type Theme = "light" | "dark";

const KEY = "lnt.theme";
const DARK = "(prefers-color-scheme: dark)";

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return typeof matchMedia === "function" && matchMedia(DARK).matches ? "dark" : "light";
}

export function currentTheme(): Theme {
  return storedTheme() ?? systemTheme();
}

export function applyTheme(): void {
  const theme = storedTheme();
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function saveTheme(theme: Theme): void {
  try {
    if (theme === systemTheme()) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    document.documentElement.dataset.theme = theme;
    return;
  }
  applyTheme();
}

export function themeToggle(): HTMLElement {
  const button = h("button", { type: "button", class: "theme-toggle" });
  const paint = (): void => {
    const dark = currentTheme() === "dark";
    const label = dark ? "حوّل للوضع النهاري" : "حوّل للوضع الليلي";
    button.replaceChildren(icon(dark ? "sun" : "moon"));
    button.setAttribute("aria-label", label);
    button.title = label;
  };
  button.addEventListener("click", () => {
    saveTheme(currentTheme() === "dark" ? "light" : "dark");
    paint();
  });
  if (typeof matchMedia === "function") matchMedia(DARK).addEventListener("change", paint);
  paint();
  return button;
}
