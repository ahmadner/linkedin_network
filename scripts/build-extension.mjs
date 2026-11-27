import { build } from "esbuild";
import { zipSync } from "fflate";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "extension");
const out = join(root, "dist-extension");
const toolUrl = process.env.TOOL_URL || "https://ahmadner.github.io/linkedin_network/";
const toolOrigin = new URL(toolUrl).origin;
const origins = [toolOrigin, "http://localhost:5173", "http://localhost:4173"];
const matches = [`${toolOrigin}/*`, "http://localhost/*"];

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
manifest.externally_connectable.matches = matches;
await writeFile(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
await writeFile(join(out, "popup.html"), await readFile(join(source, "popup.html")));

const files = {};
for (const name of ["manifest.json", "background.js", "popup.js", "popup.html"]) files[name] = new Uint8Array(await readFile(join(out, name)));
const zipTarget = process.argv[2];
if (zipTarget) {
  await mkdir(join(root, zipTarget), { recursive: true });
  await writeFile(join(root, zipTarget, "linkedin-network-extension.zip"), zipSync(files, { level: 9 }));
}
console.log(`extension built for ${origins.join(", ")}${zipTarget ? ` -> ${zipTarget}/linkedin-network-extension.zip` : ""}`);

