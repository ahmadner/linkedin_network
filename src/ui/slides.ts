import { zipSync } from "fflate";
import type { ContentLang, Slide } from "../core/content";
import { jpegPdf, type PdfPage } from "../io/pdf";

const WIDTH = 1080;
const HEIGHT = 1350;
const PAD = 96;
const FONT = 'system-ui, "Segoe UI", Tahoma, "Noto Sans Arabic", sans-serif';

const THEME = {
  dark: "#0b2545",
  darkText: "#ffffff",
  darkMuted: "#a9bdd8",
  light: "#f7f9fc",
  lightText: "#172033",
  lightMuted: "#5f6b80",
  accent: "#2f80ed",
};

function wrap(g: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (g.measureText(next).width <= max || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function fit(g: CanvasRenderingContext2D, text: string, weight: number, start: number, min: number, maxWidth: number, maxHeight: number): { lines: string[]; size: number } {
  for (let size = start; ; size -= 4) {
    g.font = `${weight} ${size}px ${FONT}`;
    const lines = wrap(g, text, maxWidth);
    if (lines.length * size * 1.35 <= maxHeight || size <= min) return { lines, size };
  }
}

function drawSlide(g: CanvasRenderingContext2D, slide: Slide, index: number, total: number, lang: ContentLang, author: string): void {
  const rtl = lang === "ar";
  const edge = index === 0 || index === total - 1;
  g.direction = rtl ? "rtl" : "ltr";
  g.textAlign = rtl ? "right" : "left";
  g.textBaseline = "top";
  const x = rtl ? WIDTH - PAD : PAD;
  const textWidth = WIDTH - PAD * 2;

  g.fillStyle = edge ? THEME.dark : THEME.light;
  g.fillRect(0, 0, WIDTH, HEIGHT);
  g.fillStyle = THEME.accent;
  g.fillRect(rtl ? WIDTH - PAD - 120 : PAD, PAD, 120, 12);

  const title = fit(g, slide.title, 800, edge ? 88 : 68, 40, textWidth, edge ? 560 : 360);
  g.fillStyle = edge ? THEME.darkText : THEME.lightText;
  let y = edge ? 300 : PAD + 80;
  for (const line of title.lines) {
    g.fillText(line, x, y);
    y += title.size * 1.35;
  }
  if (slide.body) {
    y += 40;
    const body = fit(g, slide.body, 400, edge ? 44 : 48, 28, textWidth, HEIGHT - y - 220);
    g.fillStyle = edge ? THEME.darkMuted : THEME.lightMuted;
    for (const line of body.lines) {
      g.fillText(line, x, y);
      y += body.size * 1.4;
    }
  }

  g.font = `600 30px ${FONT}`;
  g.fillStyle = edge ? THEME.darkMuted : THEME.lightMuted;
  g.textBaseline = "alphabetic";
  g.fillText(author, x, HEIGHT - PAD + 20);
  g.direction = "ltr";
  g.textAlign = rtl ? "left" : "right";
  g.fillText(`${index + 1} / ${total}`, rtl ? PAD : WIDTH - PAD, HEIGHT - PAD + 20);
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("ما قدرت أرسم الشريحة."));
      void blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject);
    }, "image/jpeg", 0.92);
  });
}

export async function renderSlides(slides: Slide[], lang: ContentLang, author: string): Promise<PdfPage[]> {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("المتصفح ما بيدعم الرسم.");
  const pages: PdfPage[] = [];
  for (const [i, slide] of slides.entries()) {
    drawSlide(g, slide, i, slides.length, lang, author);
    pages.push({ jpeg: await toJpeg(canvas), width: WIDTH, height: HEIGHT });
  }
  return pages;
}

export async function slidesPdf(slides: Slide[], lang: ContentLang, author: string): Promise<Uint8Array> {
  return jpegPdf(await renderSlides(slides, lang, author));
}

export async function slidesZip(slides: Slide[], lang: ContentLang, author: string): Promise<Uint8Array> {
  const pages = await renderSlides(slides, lang, author);
  return zipSync(Object.fromEntries(pages.map((p, i) => [`slide-${String(i + 1).padStart(2, "0")}.jpg`, [p.jpeg, { level: 0 }]])));
}
