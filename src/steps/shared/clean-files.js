import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertInsideWork, posix, resolveJob, walkFiles } from "../../scripts/lib.js";

const TEXT_EXT = new Set([".html", ".htm", ".php", ".css", ".js", ".svg"]);
const LOCAL_FILE_RE =
  /['"](?!https?:|\/\/|data:)([^'"?#]+\.(?:css|js|png|jpe?g|webp|svg|gif|ico|avif|bmp|woff2?|ttf|otf|eot|mp4|webm|mov|ogg))(?:[?#][^'"]*)?['"]/gi;

function isInside(parent, file) {
  const root = path.resolve(parent);
  const abs = path.resolve(file);
  return abs === root || abs.startsWith(root + path.sep);
}

function isIconFile(file) {
  const name = path.basename(file).toLowerCase();
  return name.endsWith(".ico") || name.startsWith("favicon");
}

function alwaysKeep(pageDir, file) {
  const rel = posix(path.relative(pageDir, file)).toLowerCase();
  return (
    rel === "style.css" ||
    rel === "assets/css/style.css" ||
    rel === "assets/js/app.js"
  );
}

function stripQuery(raw) {
  const value = raw.trim();
  const hashIndex = value.search(/[?#]/);
  return hashIndex === -1 ? value : value.slice(0, hashIndex);
}

function isSkippableUrl(value) {
  if (!value) return true;
  if (
    value.startsWith("#") ||
    value.startsWith("data:") ||
    value.startsWith("javascript:") ||
    value.startsWith("mailto:") ||
    value.startsWith("{")
  ) {
    return true;
  }
  return /^https?:/i.test(value) || value.startsWith("//");
}

function resolveLocal(pageDir, fromFile, raw) {
  const value = stripQuery(raw);
  if (isSkippableUrl(value)) return null;

  const candidates = [];
  if (value.startsWith("/")) {
    candidates.push(path.resolve(pageDir, value.replace(/^\/+/, "")));
  } else {
    candidates.push(path.resolve(path.dirname(fromFile), value));
    candidates.push(path.resolve(pageDir, value.replace(/^\.\/+/, "")));
  }

  for (const candidate of candidates) {
    if (!isInside(pageDir, candidate)) continue;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.resolve(candidate);
    }
  }
  return null;
}

function addRef(keep, queue, seenParse, pageDir, fromFile, raw) {
  const abs = resolveLocal(pageDir, fromFile, raw);
  if (!abs) return;
  if (!keep.has(abs)) keep.add(abs);
  if (!seenParse.has(abs)) queue.push(abs);
}

function collectAttrRefs(keep, queue, seenParse, pageDir, fromFile, text) {
  const ATTR_RE =
    /\b(?:href|src|poster|data-src|data-poster|data-background)\s*=\s*["']([^"']+)["']/gi;
  for (const match of text.matchAll(ATTR_RE)) {
    addRef(keep, queue, seenParse, pageDir, fromFile, match[1]);
  }

  const SRCSET_RE = /\bsrcset\s*=\s*["']([^"']+)["']/gi;
  for (const match of text.matchAll(SRCSET_RE)) {
    for (const part of match[1].split(",")) {
      addRef(
        keep,
        queue,
        seenParse,
        pageDir,
        fromFile,
        part.trim().split(/\s+/)[0],
      );
    }
  }
}

function collectCssRefs(keep, queue, seenParse, pageDir, fromFile, text) {
  const URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  for (const match of text.matchAll(URL_RE)) {
    addRef(keep, queue, seenParse, pageDir, fromFile, match[2]);
  }

  const IMPORT_RE =
    /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)/gi;
  for (const match of text.matchAll(IMPORT_RE)) {
    addRef(
      keep,
      queue,
      seenParse,
      pageDir,
      fromFile,
      match[2] || match[4] || "",
    );
  }
}

function collectQuotedRefs(keep, queue, seenParse, pageDir, fromFile, text) {
  for (const match of text.matchAll(LOCAL_FILE_RE)) {
    addRef(keep, queue, seenParse, pageDir, fromFile, match[1]);
  }
}

function collectReferencedFiles(pageDir, entry) {
  const keep = new Set();
  const queue = [];
  const seenParse = new Set();

  const entryAbs = path.resolve(entry);
  keep.add(entryAbs);
  queue.push(entryAbs);

  while (queue.length) {
    const file = queue.shift();
    if (seenParse.has(file)) continue;
    seenParse.add(file);
    if (!TEXT_EXT.has(path.extname(file).toLowerCase())) continue;
    if (!fs.existsSync(file)) continue;

    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    collectAttrRefs(keep, queue, seenParse, pageDir, file, text);
    collectCssRefs(keep, queue, seenParse, pageDir, file, text);
    collectQuotedRefs(keep, queue, seenParse, pageDir, file, text);
  }

  return keep;
}

function removeEmptyDirs(dir, pageDir, assetsDir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      removeEmptyDirs(path.join(dir, entry.name), pageDir, assetsDir);
    }
  }
  const abs = path.resolve(dir);
  if (abs === path.resolve(pageDir) || abs === path.resolve(assetsDir)) {
    return;
  }
  if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

function tryRemove(file) {
  for (let i = 0; i < 3; i += 1) {
    try {
      fs.chmodSync(file, 0o666);
    } catch {
      // still try rm
    }
    try {
      fs.rmSync(file, { force: true });
      return true;
    } catch {
      if (i === 2) return false;
    }
  }
  return false;
}

export function cleanFiles(pageDir, entry) {
  assertInsideWork(pageDir);

  const assetsDir = path.join(pageDir, "assets");
  const referenced = collectReferencedFiles(pageDir, entry);
  const removed = [];
  const skipped = [];

  for (const file of walkFiles(pageDir)) {
    const full = path.resolve(file);
    if (referenced.has(full)) continue;
    if (alwaysKeep(pageDir, full)) continue;
    if (isIconFile(full)) continue;
    if (path.basename(full).toLowerCase().endsWith(".bak")) continue;
    const rel = posix(path.relative(pageDir, full));
    if (tryRemove(full)) removed.push(rel);
    else skipped.push(rel);
  }

  removeEmptyDirs(pageDir, pageDir, assetsDir);

  if (removed.length === 0 && skipped.length === 0) {
    console.log("No leftover files");
    return;
  }
  if (removed.length) {
    const preview = removed.slice(0, 20).join(", ");
    const extra = removed.length > 20 ? ` … +${removed.length - 20}` : "";
    console.log(`Removed ${removed.length} leftover: ${preview}${extra}`);
  }
  if (skipped.length) {
    console.log(`Kept locked leftover: ${skipped.join(", ")}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { pageDir, entry } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/steps/shared/clean-files.js work/<folder>",
  );
  cleanFiles(pageDir, entry);
}
