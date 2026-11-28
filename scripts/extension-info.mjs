import { readFile, writeFile } from "node:fs/promises";

const [file, action, from] = process.argv.slice(2);
const info = JSON.parse(await readFile(file, "utf8"));

if (action === "is-signed") process.exit(info.firefox?.signed === true ? 0 : 1);

if (action === "signed") info.firefox.signed = true;
else if (action === "copy-firefox" && from) info.firefox = JSON.parse(await readFile(from, "utf8")).firefox;
else {
  console.error(`usage: extension-info.mjs <file> signed | is-signed | copy-firefox <from>`);
  process.exit(2);
}

await writeFile(file, `${JSON.stringify(info, null, 2)}\n`);
