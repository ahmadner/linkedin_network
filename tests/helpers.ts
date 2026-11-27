import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { NamedFile } from "../src/io/exportImport";

export const ROOT = join(import.meta.dirname, "..");

export function sampleFiles(dir = "samples/export_example"): NamedFile[] {
  const folder = join(ROOT, dir);
  return readdirSync(folder).map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(folder, name))) }));
}

export function sampleProfile(): unknown {
  return JSON.parse(readFileSync(join(ROOT, "samples/my_profile.sample.json"), "utf8"));
}
