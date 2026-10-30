import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const SKIP_DIRS = new Set(["node_modules", ".git"]);

export function fail(message) {
  console.error(message);
  process.exit(1);
}

export function posix(rel) {
  return rel.replaceAll("\\", "/");
}

export function walkFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

export function uniqueDest(dir, basename) {
  let dest = path.join(dir, basename);
  if (!fs.existsSync(dest)) return dest;
  const ext = path.extname(basename);
  const stem = path.basename(basename, ext);
  let i = 2;
  while (fs.existsSync(dest)) {
    dest = path.join(dir, `${stem}-${i}${ext}`);
    i += 1;
  }
  return dest;
}

export function findCssFile(pageDir, cssFile) {
  const nested = path.join(pageDir, "assets", "css", "style.css");
  if (fs.existsSync(nested)) return nested;
  if (cssFile && fs.existsSync(cssFile)) return cssFile;
  const root = path.join(pageDir, "style.css");
  return fs.existsSync(root) ? root : null;
}

export function assertInsideWork(pageDir) {
  const workDir = path.resolve(ROOT, "work");
  const abs = path.resolve(pageDir);
  if (abs !== workDir && !abs.startsWith(workDir + path.sep)) {
    fail(`Safety: ${pageDir} is not inside work/`);
  }
}

function parseArgs(argv, usage, options = {}) {
  const flags = new Set(
    argv.filter((arg) => arg.startsWith("--")).map((arg) => arg.slice(2)),
  );
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  const target = positional[0];
  if (!target) fail(usage);
  const landing = flags.has("landing");
  const offer = flags.has("offer");
  if (options.requirePage) {
    for (const flag of flags) {
      if (flag !== "landing" && flag !== "offer" && flag !== "google") fail(usage);
    }
    if (landing === offer) fail(usage);
    if (offer && flags.has("google")) fail("Offer Google snippets are not ready");
  }
  return { target, google: flags.has("google"), landing, offer };
}

function resolvePageDir(target) {
  const abs = path.isAbsolute(target) ? target : path.resolve(ROOT, target);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    fail(`Folder not found: ${abs}`);
  }
  return abs;
}

export function ensureIndexHtml(pageDir, entry) {
  const base = path.basename(entry);
  if (/^index\.html$/i.test(base) || /^index\.php$/i.test(base)) return entry;
  const dest = path.join(pageDir, "index.html");
  if (fs.existsSync(dest)) fail(`Both ${base} and index.html`);
  fs.renameSync(entry, dest);
  console.log(`Renamed ${base} -> index.html`);
  return dest;
}

function findEntryFile(dir) {
  const names = ["index.html", "index.php"];
  for (const name of names) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) return file;
  }
  const html = fs.readdirSync(dir).find((name) => /\.html$/i.test(name));
  return html ? path.join(dir, html) : null;
}

export function resolveJob(argv, usage, options) {
  const { target, google, landing, offer } = parseArgs(argv, usage, options);
  const pageDir = resolvePageDir(target);
  const entry = findEntryFile(pageDir);
  if (!entry) fail(`No index.html / index.php in ${pageDir}`);
  const cssFile = findCssFile(pageDir) ?? path.join(pageDir, "style.css");
  return { pageDir, entry, cssFile, google, landing, offer };
}
