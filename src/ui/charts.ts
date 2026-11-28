import { fmtNumber, h } from "./dom";

const SVG = "http://www.w3.org/2000/svg";
const PAD = { top: 16, right: 12, bottom: 24, left: 34 };
const FALLBACK_WIDTH = 640;

type SvgAttrs = Record<string, string | number>;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: SvgAttrs = {}, ...children: Array<SVGElement | string>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const child of children) el.append(child);
  return el;
}

export interface ColumnSeries {
  name: string;
  className: string;
}

export interface ColumnPoint {
  label: string;
  title?: string;
  values: number[];
  className?: string;
}

export interface ChartOptions {
  stacked?: boolean;
  height?: number;
  reference?: { value: number; label: string };
  format?: (value: number) => string;
  summary?: string;
  labelHeader?: string;
}

interface Frame {
  width: number;
  height: number;
  plotW: number;
  plotH: number;
  max: number;
  ticks: number[];
  y(value: number): number;
}

function niceMax(value: number): number {
  if (value <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s * 4 >= value) ?? pow * 10;
  return step * 4;
}

function frame(width: number, height: number, top: number): Frame {
  const plotW = Math.max(40, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const max = niceMax(top);
  return { width, height, plotW, plotH, max, ticks: [0, max / 2, max], y: (v) => PAD.top + plotH - (v / max) * plotH };
}

function axes(f: Frame, format: (v: number) => string): SVGGElement {
  const g = svg("g", { "aria-hidden": "true" });
  for (const t of f.ticks) {
    const y = f.y(t);
    g.append(svg("line", { x1: PAD.left, x2: PAD.left + f.plotW, y1: y, y2: y, class: t === 0 ? "axis" : "grid" }));
    g.append(svg("text", { x: PAD.left - 6, y: y + 3, class: "tick", "text-anchor": "end" }, format(t)));
  }
  return g;
}

function xLabels(f: Frame, labels: string[], x: (i: number) => number): SVGGElement {
  const g = svg("g", { "aria-hidden": "true" });
  const room = Math.max(1, Math.floor(f.plotW / 52));
  const every = Math.max(1, Math.ceil(labels.length / room));
  labels.forEach((label, i) => {
    const last = i === labels.length - 1;
    if (i % every !== 0 && !last) return;
    if (!last && labels.length - 1 - i < every) return;
    g.append(svg("text", { x: x(i), y: f.height - 6, class: "tick", "text-anchor": "middle" }, label));
  });
  return g;
}

function reference(f: Frame, ref: ChartOptions["reference"]): SVGGElement | null {
  if (!ref || ref.value <= 0 || ref.value > f.max) return null;
  const y = f.y(ref.value);
  return svg("g", { "aria-hidden": "true" },
    svg("line", { x1: PAD.left, x2: PAD.left + f.plotW, y1: y, y2: y, class: "ref" }),
    svg("text", { x: PAD.left + f.plotW, y: y - 4, class: "ref-label", "text-anchor": "end" }, ref.label));
}

function topRounded(x: number, y: number, w: number, hgt: number, r: number): string {
  const rr = Math.min(r, w / 2, hgt);
  return `M${x},${y + hgt}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + hgt}Z`;
}

interface Interactive {
  xAt(i: number): number;
  indexAt(x: number): number;
  highlight(i: number | null): void;
}

function tooltipContent(title: string, series: ColumnSeries[], point: ColumnPoint, format: (v: number) => string): HTMLElement[] {
  return [
    h("strong", {}, point.title ?? point.label),
    ...series.map((s, i) => h("span", { class: "tip-row" }, h("i", { class: `swatch ${point.className && series.length === 1 ? point.className : s.className}` }), h("span", {}, s.name || title), h("b", {}, format(point.values[i] ?? 0)))),
  ];
}

function mount(title: string, series: ColumnSeries[], points: ColumnPoint[], options: ChartOptions, draw: (width: number) => { el: SVGSVGElement; ui: Interactive }): HTMLElement {
  const format = options.format ?? fmtNumber;
  const tip = h("div", { class: "chart-tip", role: "status", "aria-live": "polite", hidden: true });
  const box = h("div", { class: "chart-box", tabindex: 0, role: "group", "aria-label": `${title}. استخدم الأسهم لتتنقل بين النقاط.` });
  let current: Interactive | null = null;
  let active: number | null = null;
  let width = 0;

  const show = (i: number | null): void => {
    active = i;
    current?.highlight(i);
    const point = i === null ? undefined : points[i];
    if (!current || !point || i === null) {
      tip.hidden = true;
      return;
    }
    tip.replaceChildren(...tooltipContent(title, series, point, format));
    tip.hidden = false;
    const x = current.xAt(i);
    const half = tip.offsetWidth / 2;
    tip.style.left = `${Math.min(Math.max(x - half, 0), Math.max(0, width - tip.offsetWidth))}px`;
  };

  const render = (next: number): void => {
    if (next === width) return;
    width = next;
    const { el, ui } = draw(width);
    current = ui;
    box.replaceChildren(el, tip);
    if (active !== null) show(active);
  };

  box.addEventListener("pointermove", (e) => {
    if (!current) return;
    const rect = box.getBoundingClientRect();
    show(current.indexAt(e.clientX - rect.left));
  });
  box.addEventListener("pointerleave", () => show(null));
  box.addEventListener("blur", () => show(null));
  box.addEventListener("keydown", (e) => {
    if (!current || points.length === 0) return;
    const last = points.length - 1;
    const moves: Record<string, number> = { ArrowRight: (active ?? -1) + 1, ArrowLeft: (active ?? points.length) - 1, Home: 0, End: last };
    if (e.key === "Escape") return show(null);
    const target = moves[e.key];
    if (target === undefined) return;
    e.preventDefault();
    show(Math.min(last, Math.max(0, target)));
  });

  render(FALLBACK_WIDTH);
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver((entries) => {
      if (!box.isConnected) return observer.disconnect();
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (w > 0) render(w);
    });
    observer.observe(box);
  }

  const legend = series.length > 1
    ? h("div", { class: "legend" }, series.map((s) => h("span", {}, h("i", { class: `swatch ${s.className}` }), s.name)))
    : null;
  return h("div", { class: "chart-wrap" }, legend, box, dataTable(title, series, points, format, options.labelHeader));
}

export function dataTable(title: string, series: ColumnSeries[], points: ColumnPoint[], format: (v: number) => string = fmtNumber, labelHeader = "الفترة"): HTMLElement {
  return h("details", { class: "chart-table" },
    h("summary", {}, "الأرقام كجدول"),
    h("div", { class: "table-scroll" },
      h("table", {},
        h("caption", { class: "sr-only" }, title),
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, labelHeader), series.map((s) => h("th", { scope: "col" }, s.name || title)))),
        h("tbody", {}, points.map((p) => h("tr", {}, h("th", { scope: "row" }, p.title ?? p.label), p.values.map((v) => h("td", {}, format(v)))))),
      ),
    ),
  );
}

export function columnChart(title: string, series: ColumnSeries[], points: ColumnPoint[], options: ChartOptions = {}): HTMLElement {
  const format = options.format ?? fmtNumber;
  const height = options.height ?? 170;
  const sum = (p: ColumnPoint): number => p.values.reduce((a, b) => a + b, 0);
  const top = Math.max(1, options.reference?.value ?? 0, ...points.map((p) => (options.stacked ? sum(p) : Math.max(0, ...p.values))));
  const draw = (width: number): { el: SVGSVGElement; ui: Interactive } => {
    const f = frame(width, height, top);
    const step = f.plotW / Math.max(1, points.length);
    const lanes = options.stacked ? 1 : series.length;
    const barW = Math.max(3, Math.min(24, (step * 0.7) / lanes - (lanes > 1 ? 2 : 0)));
    const groupW = lanes * barW + (lanes - 1) * 2;
    const center = (i: number): number => PAD.left + step * i + step / 2;
    const el = svg("svg", { width, height, viewBox: `0 0 ${width} ${height}`, class: "chart", role: "img", "aria-label": options.summary ? `${title}. ${options.summary}` : title });
    const hover = svg("rect", { x: 0, y: PAD.top, width: step, height: f.plotH, class: "hover-band", visibility: "hidden" });
    el.append(axes(f, format), hover);
    const marks = svg("g", { "aria-hidden": "true" });
    points.forEach((p, i) => {
      const x0 = center(i) - groupW / 2;
      let base = 0;
      const lastFilled = p.values.reduce((at, v, s) => (v > 0 ? s : at), -1);
      p.values.forEach((v, s) => {
        if (v <= 0) return;
        const cls = p.className && series.length === 1 ? p.className : series[s]?.className ?? "";
        if (options.stacked) {
          const y1 = f.y(base);
          const y2 = f.y(base + v);
          const gap = base > 0 ? 2 : 0;
          const hgt = Math.max(1, y1 - y2 - gap);
          marks.append(svg("path", { d: s === lastFilled ? topRounded(x0, y2, barW, hgt, 4) : `M${x0},${y2}h${barW}v${hgt}h${-barW}Z`, class: `mark ${cls}` }));
          base += v;
        } else {
          const y = f.y(v);
          marks.append(svg("path", { d: topRounded(x0 + s * (barW + 2), y, barW, Math.max(1, f.y(0) - y), 4), class: `mark ${cls}` }));
        }
      });
    });
    el.append(marks);
    const ref = reference(f, options.reference);
    if (ref) el.append(ref);
    el.append(xLabels(f, points.map((p) => p.label), center));
    return {
      el,
      ui: {
        xAt: center,
        indexAt: (x) => Math.min(points.length - 1, Math.max(0, Math.floor((x - PAD.left) / step))),
        highlight: (i) => {
          hover.setAttribute("visibility", i === null ? "hidden" : "visible");
          if (i !== null) hover.setAttribute("x", String(PAD.left + step * i));
        },
      },
    };
  };
  return mount(title, series, points, options, draw);
}

export function lineChart(title: string, series: ColumnSeries[], points: ColumnPoint[], options: ChartOptions = {}): HTMLElement {
  const format = options.format ?? fmtNumber;
  const height = options.height ?? 190;
  const top = Math.max(1, ...points.flatMap((p) => p.values));
  const draw = (width: number): { el: SVGSVGElement; ui: Interactive } => {
    const f = frame(width, height, top);
    const step = points.length > 1 ? f.plotW / (points.length - 1) : 0;
    const x = (i: number): number => PAD.left + step * i;
    const el = svg("svg", { width, height, viewBox: `0 0 ${width} ${height}`, class: "chart", role: "img", "aria-label": options.summary ? `${title}. ${options.summary}` : title });
    const cross = svg("line", { x1: 0, x2: 0, y1: PAD.top, y2: PAD.top + f.plotH, class: "crosshair", visibility: "hidden" });
    el.append(axes(f, format), cross);
    const dots: SVGCircleElement[][] = [];
    series.forEach((s, si) => {
      const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${f.y(p.values[si] ?? 0)}`).join("");
      el.append(svg("path", { d, class: `line ${s.className}`, "aria-hidden": "true" }));
      const lastIndex = points.length - 1;
      const last = points[lastIndex];
      if (last) {
        el.append(svg("circle", { cx: x(lastIndex), cy: f.y(last.values[si] ?? 0), r: 4, class: `dot ${s.className}`, "aria-hidden": "true" }));
      }
      dots.push(points.map((p, i) => {
        const c = svg("circle", { cx: x(i), cy: f.y(p.values[si] ?? 0), r: 5, class: `dot ${s.className}`, visibility: "hidden", "aria-hidden": "true" });
        el.append(c);
        return c;
      }));
    });
    el.append(xLabels(f, points.map((p) => p.label), x));
    return {
      el,
      ui: {
        xAt: x,
        indexAt: (px) => (step === 0 ? 0 : Math.min(points.length - 1, Math.max(0, Math.round((px - PAD.left) / step)))),
        highlight: (i) => {
          cross.setAttribute("visibility", i === null ? "hidden" : "visible");
          if (i !== null) {
            cross.setAttribute("x1", String(x(i)));
            cross.setAttribute("x2", String(x(i)));
          }
          for (const row of dots) row.forEach((c, j) => c.setAttribute("visibility", j === i ? "visible" : "hidden"));
        },
      },
    };
  };
  return mount(title, series, points, options, draw);
}

export function barFill(ratio: number, className = ""): HTMLElement {
  const el = h("span", { class: className ? `bar ${className}` : "bar" });
  el.style.inlineSize = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
  return el;
}
