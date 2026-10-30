import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveJob } from "../../scripts/lib.js";

const SNIPPET = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "snippets",
  "offer",
  "app.js",
);

function ensureAppFile(pageDir) {
  const dest = path.join(pageDir, "assets", "js", "app.js");
  const snippet = fs.readFileSync(SNIPPET, "utf8");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!fs.existsSync(dest)) {
    fs.writeFileSync(dest, snippet);
    return "copied";
  }
  const current = fs.readFileSync(dest, "utf8");
  if (current.includes('a[href^="#"]')) return "kept";
  fs.writeFileSync(dest, `${snippet}\n${current}`);
  return "prepended";
}

function stripAppTag(html) {
  return html
    .replace(
      /[ \t]*<script\b[^>]*src=["'][^"']*assets\/js\/app\.js["'][^>]*>\s*<\/script>[ \t]*\r?\n?/gi,
      "",
    )
    .replace(/\n{3,}/g, "\n\n");
}

function ensureScriptTag(html) {
  const next = stripAppTag(html);
  const tag = '<script src="./assets/js/app.js"></script>';
  const form = next.match(/^([ \t]*)<style\b[^>]*>\s*[\s\S]*?error-input/im);
  if (form) {
    const at = form.index ?? 0;
    let head = next.slice(0, at).replace(/\s*$/, "");
    if (head) head += "\n";
    return `${head}${form[1]}${tag}\n\n${next.slice(at)}`;
  }
  if (/<\/body>/i.test(next)) {
    return next.replace(/<\/body>/i, `${tag}\n</body>`);
  }
  return `${next}\n${tag}\n`;
}

export function ensureApp(pageDir, entry) {
  const file = ensureAppFile(pageDir);
  let html = fs.readFileSync(entry, "utf8");
  const before = html;
  html = ensureScriptTag(html);
  if (html !== before) fs.writeFileSync(entry, html);
  console.log(`app.js ${file}, script ${html !== before ? "added" : "kept"}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { pageDir, entry } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/steps/offer/ensure-app.js work/<folder>",
  );
  ensureApp(pageDir, entry);
}
