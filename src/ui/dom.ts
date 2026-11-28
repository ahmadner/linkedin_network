type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Array<Child | Child[]>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "class") el.className = String(value);
    else if (key === "value" && "value" in el) (el as HTMLInputElement).value = String(value);
    else if (key === "checked" && "checked" in el) (el as HTMLInputElement).checked = Boolean(value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: Array<Child | Child[]>): void {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

const FOCUSABLE = "a[href], button, input, select, textarea, summary, [tabindex]";

interface FocusMark {
  signature: string;
  index: number;
  path: number[];
  selection: [number, number] | null;
}

function signature(el: Element): string {
  const text = /^(BUTTON|A|SUMMARY)$/.test(el.tagName) || el.getAttribute("role") === "tab" ? (el.textContent ?? "").trim().slice(0, 60) : "";
  return [el.tagName, el.id, el.getAttribute("type"), el.getAttribute("role"), el.getAttribute("name"), el.getAttribute("aria-label"), el.getAttribute("placeholder"), el.getAttribute("data-key"), text].join("|");
}

function pathOf(root: Element, el: Element): number[] {
  const path: number[] = [];
  for (let node: Element | null = el; node && node !== root; node = node.parentElement) {
    path.unshift(node.parentElement ? [...node.parentElement.children].indexOf(node) : 0);
  }
  return path;
}

function atPath(root: Element, path: number[]): Element | null {
  let node: Element | null = root;
  for (const i of path) node = node?.children[i] ?? null;
  return node;
}

function markFocus(root: Element): FocusMark | null {
  const active = document.activeElement;
  if (!active || active === root || !root.contains(active)) return null;
  const sig = signature(active);
  const same = [...root.querySelectorAll(FOCUSABLE)].filter((el) => signature(el) === sig);
  const field = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null;
  let selection: [number, number] | null = null;
  try {
    selection = field && field.selectionStart !== null ? [field.selectionStart, field.selectionEnd ?? field.selectionStart] : null;
  } catch {
    selection = null;
  }
  return { signature: sig, index: same.indexOf(active), path: pathOf(root, active), selection };
}

function restoreFocus(root: Element, mark: FocusMark): void {
  if (root.contains(document.activeElement) && document.activeElement !== root) return;
  const same = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => signature(el) === mark.signature);
  const byPath = atPath(root, mark.path);
  const target = same[mark.index] ?? same[0] ?? (byPath instanceof HTMLElement && byPath.matches(FOCUSABLE) ? byPath : null);
  if (!target) {
    if (root instanceof HTMLElement && root.hasAttribute("tabindex")) root.focus({ preventScroll: true });
    return;
  }
  target.focus({ preventScroll: true });
  if (mark.selection && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    try {
      target.setSelectionRange(...mark.selection);
    } catch {
      return;
    }
  }
}

export function replace(parent: Element, ...children: Array<Child | Child[]>): void {
  const mark = markFocus(parent);
  parent.replaceChildren();
  append(parent, children);
  if (mark) restoreFocus(parent, mark);
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = h("a", { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = h("input", { type: "file", accept, multiple });
    input.addEventListener("change", () => resolve([...(input.files ?? [])]));
    input.click();
  });
}

export function field(label: string, control: HTMLElement, hint?: string): HTMLLabelElement {
  return h("label", { class: "field" }, h("span", { class: "field-label" }, label), control, hint ? h("small", { class: "hint" }, hint) : null);
}

export function textInput(value: string, onChange: (v: string) => void, attrs: Attrs = {}): HTMLInputElement {
  const input = h("input", { type: "text", value, ...attrs });
  input.addEventListener("change", () => onChange(input.value));
  return input;
}

export function numberInput(value: number, onChange: (v: number) => void, attrs: Attrs = {}): HTMLInputElement {
  const input = h("input", { type: "number", value: String(value), ...attrs });
  input.addEventListener("change", () => {
    const n = Number(input.value);
    if (Number.isFinite(n)) onChange(n);
  });
  return input;
}

export function textArea(value: string, onChange: (v: string) => void, attrs: Attrs = {}): HTMLTextAreaElement {
  const area = h("textarea", { rows: 3, ...attrs });
  area.value = value;
  area.addEventListener("change", () => onChange(area.value));
  return area;
}

export function select(options: Array<[string, string]>, value: string, onChange: (v: string) => void, attrs: Attrs = {}): HTMLSelectElement {
  const el = h("select", attrs, options.map(([v, label]) => h("option", { value: v, selected: v === value }, label)));
  el.addEventListener("change", () => onChange(el.value));
  return el;
}

export function fmtNumber(n: number): string {
  return n.toLocaleString("en-US");
}
