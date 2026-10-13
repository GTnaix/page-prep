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

export function findCssFile(landingDir, cssFile) {
  const nested = path.join(landingDir, "assets", "css", "style.css");
  if (fs.existsSync(nested)) return nested;
  if (cssFile && fs.existsSync(cssFile)) return cssFile;
  const root = path.join(landingDir, "style.css");
  return fs.existsSync(root) ? root : null;
}

export function assertInsideWork(landingDir) {
  const workDir = path.resolve(ROOT, "work");
  const abs = path.resolve(landingDir);
  if (abs !== workDir && !abs.startsWith(workDir + path.sep)) {
    fail(`Safety: ${landingDir} is not inside work/`);
  }
}

function parseArgs(argv, usage) {
  const flags = new Set(
    argv.filter((arg) => arg.startsWith("--")).map((arg) => arg.slice(2)),
  );
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  const target = positional[0];
  if (!target) fail(usage);
  return { target, google: flags.has("google") };
}

function resolveLandingDir(target) {
  const abs = path.isAbsolute(target) ? target : path.resolve(ROOT, target);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    fail(`Folder not found: ${abs}`);
  }
  return abs;
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

export function resolveJob(argv, usage) {
  const { target, google } = parseArgs(argv, usage);
  const landingDir = resolveLandingDir(target);
  const entry = findEntryFile(landingDir);
  if (!entry) fail(`No index.html / index.php in ${landingDir}`);
  const cssFile = findCssFile(landingDir) ?? path.join(landingDir, "style.css");
  return { landingDir, entry, cssFile, google };
}
