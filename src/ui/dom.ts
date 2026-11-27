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

export function replace(parent: Element, ...children: Array<Child | Child[]>): void {
  parent.replaceChildren();
  append(parent, children);
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
