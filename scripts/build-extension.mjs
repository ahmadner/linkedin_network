import { build } from "esbuild";
import { zipSync } from "fflate";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "extension");
const targets = JSON.parse(await readFile(join(source, "targets.json"), "utf8"));

const [mode = "production", zipTarget] = process.argv.slice(2);
const target = targets[mode];
if (!target) {
  console.error(`unknown extension target "${mode}", expected one of: ${Object.keys(targets).join(", ")}`);
  process.exit(1);
}

function extensionId(key) {
  const hash = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
  return [...hash].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join("");
}

if (extensionId(target.key) !== target.id) {
  console.error(`extension target "${mode}": id does not match its key`);
  process.exit(1);
}

const toolUrl = mode === "production" && process.env.TOOL_URL ? process.env.TOOL_URL : target.toolUrl;
const origins = [...new Set([new URL(toolUrl).origin, ...target.origins])];
const matches = origins.map((origin) => `${new URL(origin).protocol}//${new URL(origin).hostname}/*`);
const out = join(root, "dist-extension", mode);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: { background: join(source, "src/background.ts"), popup: join(source, "src/popup.ts") },
  outdir: out,
  bundle: true,
  format: "esm",
  target: "chrome116",
  minify: true,
  legalComments: "none",
  define: { __TOOL_ORIGINS__: JSON.stringify(origins), __TOOL_URL__: JSON.stringify(toolUrl) },
});

const manifest = JSON.parse(await readFile(join(source, "manifest.json"), "utf8"));
manifest.name = target.name;
manifest.action.default_title = target.name;
manifest.key = target.key;
manifest.externally_connectable.matches = [...new Set(matches)];
await writeFile(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
await writeFile(join(out, "popup.html"), await readFile(join(source, "popup.html")));

if (zipTarget) {
  const files = {};
  for (const name of ["manifest.json", "background.js", "popup.js", "popup.html"]) files[name] = new Uint8Array(await readFile(join(out, name)));
  await mkdir(join(root, zipTarget), { recursive: true });
  await writeFile(join(root, zipTarget, "linkedin-network-extension.zip"), zipSync(files, { level: 9 }));
}

console.log(`extension "${mode}" (${target.id}) built for ${origins.join(", ")} -> dist-extension/${mode}${zipTarget ? `, ${zipTarget}/linkedin-network-extension.zip` : ""}`);
