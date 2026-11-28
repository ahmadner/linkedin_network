import { fmtNumber, h } from "./dom";

const SVG = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...children: Array<SVGElement | string>): SVGElementTagNameMap[K] {
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
  values: number[];
}

export function columnChart(title: string, series: ColumnSeries[], points: ColumnPoint[]): HTMLElement {
  const height = 150;
  const top = 14;
  const bottom = 22;
  const group = Math.max(18 * series.length + 8, Math.floor(720 / Math.max(1, points.length)));
  const width = points.length * group + 8;
  const max = Math.max(1, ...points.flatMap((p) => p.values));
  const plot = height - top - bottom;
  const every = Math.max(1, Math.ceil(points.length / 12));
  const chart = svg("svg", { viewBox: `0 0 ${width} ${height}`, width, height, class: "chart", role: "img", "aria-label": title });
  chart.append(svg("line", { x1: 0, x2: width, y1: height - bottom, y2: height - bottom, class: "axis" }));
  chart.append(svg("text", { x: 2, y: 10, class: "tick" }, fmtNumber(max)));
  points.forEach((p, i) => {
    const x0 = i * group + (group - 18 * series.length) / 2;
    p.values.forEach((v, s) => {
      const hgt = (v / max) * plot;
      const rect = svg("rect", { x: x0 + s * 18, y: height - bottom - hgt, width: 14, height: Math.max(hgt, v > 0 ? 1 : 0), rx: 2, class: series[s]?.className ?? "" });
      rect.append(svg("title", {}, `${p.label} · ${series[s]?.name ?? ""}: ${fmtNumber(v)}`));
      chart.append(rect);
    });
    if (i % every === 0) chart.append(svg("text", { x: x0, y: height - 6, class: "tick" }, p.label));
  });
  const legend = series.length > 1
    ? h("div", { class: "legend" }, series.map((s) => h("span", {}, h("i", { class: `swatch ${s.className}` }), s.name)))
    : null;
  return h("div", { class: "chart-wrap" }, legend, h("div", { class: "chart-scroll", tabindex: 0, role: "region", "aria-label": title }, chart));
}

export function barFill(ratio: number): HTMLElement {
  const el = h("span", { class: "bar" });
  el.style.inlineSize = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
  return el;
}
