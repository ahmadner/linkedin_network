export interface PdfPage {
  jpeg: Uint8Array;
  width: number;
  height: number;
}

const encoder = new TextEncoder();

export function jpegPdf(pages: PdfPage[], pageWidth = 540): Uint8Array {
  if (pages.length === 0) throw new Error("A PDF needs at least one page");
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (part: string | Uint8Array): void => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    chunks.push(bytes);
    size += bytes.length;
  };
  const object = (id: number, body: string, stream?: Uint8Array): void => {
    offsets[id] = size;
    push(`${id} 0 obj\n${body}\n`);
    if (stream) {
      push("stream\n");
      push(stream);
      push("\nendstream\n");
    }
    push("endobj\n");
  };

  push("%PDF-1.4\n%âãÏÓ\n");
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  pages.forEach((page, i) => {
    const id = 3 + i * 3;
    const w = pageWidth;
    const hgt = Math.round((page.height / page.width) * pageWidth);
    const content = encoder.encode(`q ${w} 0 0 ${hgt} 0 0 cm /Im0 Do Q`);
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${hgt}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`);
    object(id + 1, `<< /Length ${content.length} >>`, content);
    object(id + 2, `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>`, page.jpeg);
  });
  const count = 3 + pages.length * 3;
  const xref = size;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id += 1) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
