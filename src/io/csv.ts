export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text.charCodeAt(i);
    if (quoted) {
      if (ch === 34) {
        if (text.charCodeAt(i + 1) === 34) {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      const next = text.indexOf('"', i);
      const end = next === -1 ? n : next;
      field += text.slice(i, end);
      i = end;
      continue;
    }
    if (ch === 34 && field === "") {
      quoted = true;
      i += 1;
    } else if (ch === 44) {
      row.push(field);
      field = "";
      i += 1;
    } else if (ch === 10 || ch === 13) {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += ch === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1;
    } else {
      let j = i + 1;
      while (j < n) {
        const c = text.charCodeAt(j);
        if (c === 44 || c === 10 || c === 13) break;
        j += 1;
      }
      field += text.slice(i, j);
      i = j;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface Table {
  header: string[];
  rows: string[][];
  rowNumbers: number[];
  column(name: string, ...aliases: string[]): number;
}

const normalizeHeader = (h: string): string => h.replace(/^﻿/, "").trim().toLowerCase().replace(/\s+/g, " ");

export function tableFrom(text: string, isHeader: (cells: string[]) => boolean): Table | null {
  const all = parseCsv(text);
  const start = all.findIndex((cells) => isHeader(cells.map(normalizeHeader)));
  if (start < 0) return null;
  const header = all[start]!.map(normalizeHeader);
  const kept = all.map((r, i) => [r, i + 1] as const).slice(start + 1).filter(([r]) => r.some((c) => c.trim() !== ""));
  return {
    header,
    rows: kept.map(([r]) => r),
    rowNumbers: kept.map(([, n]) => n),
    column(name: string, ...aliases: string[]): number {
      for (const n of [name, ...aliases]) {
        const idx = header.indexOf(n.toLowerCase());
        if (idx >= 0) return idx;
      }
      return -1;
    },
  };
}

export function cell(row: string[], index: number): string {
  return index >= 0 ? (row[index] ?? "").trim() : "";
}

export function toCsv(header: string[], rows: Array<Array<string | number | null>>): string {
  const esc = (v: string | number | null): string => {
    const s = v === null ? "" : String(v);
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return "﻿" + [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

export function decodeBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1256").decode(bytes);
  }
}
