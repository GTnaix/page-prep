import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveJob } from "./lib.js";

const SNIPPET = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "snippets",
  "landing",
  "app.js",
);

function ensureAppFile(landingDir) {
  const dest = path.join(landingDir, "assets", "js", "app.js");
  const snippet = fs.readFileSync(SNIPPET, "utf8");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!fs.existsSync(dest)) {
    fs.writeFileSync(dest, snippet);
    return "copied";
  }
  const current = fs.readFileSync(dest, "utf8");
  if (current.includes("data-js-short-date")) return "kept";
  fs.writeFileSync(dest, `${snippet}\n${current}`);
  return "prepended";
}

function ensureScriptTag(html) {
  if (/<script\b[^>]*src=["'][^"']*assets\/js\/app\.js["']/i.test(html)) {
    return html;
  }
  const tag = '<script src="./assets/js/app.js"></script>';
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${tag}\n</body>`);
  }
  return `${html}\n${tag}\n`;
}

export function ensureApp(landingDir, entry) {
  const file = ensureAppFile(landingDir);
  let html = fs.readFileSync(entry, "utf8");
  const before = html;
  html = ensureScriptTag(html);
  if (html !== before) fs.writeFileSync(entry, html);
  console.log(`app.js ${file}, script ${html !== before ? "added" : "kept"}`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { landingDir, entry } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/scripts/ensure-app.js work/<folder>",
  );
  ensureApp(landingDir, entry);
}
