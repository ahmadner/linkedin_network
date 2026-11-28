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
const tool = new URL(toolUrl);
const toolPath = tool.pathname.endsWith("/") ? tool.pathname : `${tool.pathname}/`;
const origins = [...new Set([tool.origin, ...target.origins])];
const prefixes = [...new Set([`${tool.origin}${toolPath}`, ...target.origins.map((origin) => `${new URL(origin).origin}/`)])];
const matches = [`${tool.protocol}//${tool.hostname}${toolPath}*`, ...target.origins.map((origin) => `${new URL(origin).protocol}//${new URL(origin).hostname}/*`)];
const FILES = { chrome: ["manifest.json", "background.js", "popup.js", "popup.html"], firefox: ["manifest.json", "background.js", "popup.js", "popup.html", "bridge.js"] };
const ZIPS = { chrome: "linkedin-network-extension.zip", firefox: "linkedin-network-extension-firefox.zip" };
const base = JSON.parse(await readFile(join(source, "manifest.json"), "utf8"));
const define = { __TOOL_ORIGINS__: JSON.stringify(origins), __TOOL_PREFIXES__: JSON.stringify(prefixes), __TOOL_URL__: JSON.stringify(toolUrl) };

function chromeManifest() {
  const manifest = structuredClone(base);
  manifest.name = target.name;
  manifest.action.default_title = target.name;
  manifest.key = target.key;
  manifest.externally_connectable.matches = [...new Set(matches)];
  return manifest;
}

function firefoxManifest() {
  const { minimum_chrome_version, externally_connectable, background, ...manifest } = structuredClone(base);
  manifest.name = target.name;
  manifest.action.default_title = target.name;
  manifest.background = { scripts: [background.service_worker], type: "module" };
  manifest.content_scripts = [{ matches: [...new Set(matches)], js: ["bridge.js"], run_at: "document_start" }];
  manifest.browser_specific_settings = { gecko: { id: target.geckoId, strict_min_version: "128.0", data_collection_permissions: { required: ["none"] } } };
  return manifest;
}

const built = [];
for (const browser of ["chrome", "firefox"]) {
  const out = join(root, "dist-extension", browser === "chrome" ? mode : `${mode}-firefox`);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const firefox = browser === "firefox";
  await build({
    entryPoints: { background: join(source, "src/background.ts"), popup: join(source, "src/popup.ts") },
    outdir: out,
    bundle: true,
    format: "esm",
    target: firefox ? "firefox128" : "chrome116",
    minify: true,
    legalComments: "none",
    define: firefox ? { ...define, chrome: "browser" } : define,
  });
  if (firefox) {
    await build({
      entryPoints: { bridge: join(source, "src/pageBridge.ts") },
      outdir: out,
      bundle: true,
      format: "iife",
      target: "firefox128",
      minify: true,
      legalComments: "none",
      define: { chrome: "browser" },
    });
  }
  await writeFile(join(out, "manifest.json"), JSON.stringify(firefox ? firefoxManifest() : chromeManifest(), null, 2));
  await writeFile(join(out, "popup.html"), await readFile(join(source, "popup.html")));
  if (zipTarget) {
    const files = {};
    for (const name of FILES[browser]) files[name] = new Uint8Array(await readFile(join(out, name)));
    await mkdir(join(root, zipTarget), { recursive: true });
    await writeFile(join(root, zipTarget, ZIPS[browser]), zipSync(files, { level: 9 }));
  }
  built.push(`${browser} -> ${out.slice(root.length)}${zipTarget ? ` + ${zipTarget}/${ZIPS[browser]}` : ""}`);
}

console.log(`extension "${mode}" (${target.id}, ${target.geckoId}) built for ${origins.join(", ")}\n  ${built.join("\n  ")}`);
