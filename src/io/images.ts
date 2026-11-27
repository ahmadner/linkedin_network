import { deleteImageBlob, getImageBlob, putImageBlob } from "./db";

export { getImageBlob as imageBlob };

const MAX_SIDE = 1600;
const QUALITY = 0.88;
const urls = new Map<string, string>();

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
}

export function base64Blob(b64: string, type: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

export async function prepareImage(source: Blob): Promise<PreparedImage> {
  if (!source.type.startsWith("image/")) throw new Error("الملف مش صورة.");
  const bitmap = await createImageBitmap(source).catch(() => {
    throw new Error("ما قدرت أقرأ الصورة. جرّب PNG أو JPG أو WebP.");
  });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const webp = await canvasBlob(canvas, "image/webp");
  const blob = webp && webp.type === "image/webp" ? webp : await canvasBlob(canvas, "image/jpeg");
  if (!blob) throw new Error("ما قدرت أضغط الصورة.");
  return { blob: blob.size < source.size || scale < 1 ? blob : source, width, height };
}

export async function storeImage(id: string, blob: Blob): Promise<void> {
  await putImageBlob(id, blob);
  forgetImageUrl(id);
}

export async function removeImage(id: string): Promise<void> {
  forgetImageUrl(id);
  await deleteImageBlob(id);
}

export async function imageUrl(id: string): Promise<string> {
  const cached = urls.get(id);
  if (cached) return cached;
  const blob = await getImageBlob(id);
  if (!blob) return "";
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

export function forgetImageUrl(id: string): void {
  const url = urls.get(id);
  if (url) URL.revokeObjectURL(url);
  urls.delete(id);
}

export function forgetAllImageUrls(): void {
  for (const id of [...urls.keys()]) forgetImageUrl(id);
}

export function imageExtension(type: string): string {
  return type === "image/webp" ? "webp" : type === "image/jpeg" ? "jpg" : "png";
}
