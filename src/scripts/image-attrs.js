import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveJob } from "./lib.js";

const RASTER_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp"]);
const IMG_RE = /<img\b[^>]*>/gi;

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match ? match[1] : "";
}

function setAttr(tag, name, value) {
  const re = new RegExp(`(\\s)${name}\\s*=\\s*["'][^"']*["']`, "i");
  if (re.test(tag)) return tag.replace(re, `$1${name}="${value}"`);
  return tag.replace(/(\s*\/?>)$/, ` ${name}="${value}"$1`);
}

function removeAttr(tag, name) {
  return tag.replace(new RegExp(`\\s${name}\\s*=\\s*["'][^"']*["']`, "i"), "");
}

function resolveSrc(htmlDir, src) {
  const raw = (src || "").trim().split("?")[0];
  if (!raw || /^https?:/i.test(raw) || raw.startsWith("//") || /^data:/i.test(raw)) {
    return null;
  }
  return path.resolve(htmlDir, raw);
}

function isRaster(file) {
  return RASTER_EXT.has(path.extname(file).toLowerCase());
}

export function imageAttrs(entry) {
  const htmlDir = path.dirname(entry);
  const html = fs.readFileSync(entry, "utf8");
  const bodyAt = html.search(/<body\b/i);
  let lcpSet = false;
  let updated = 0;

  let out = "";
  let cursor = 0;
  for (const match of html.matchAll(IMG_RE)) {
    let tag = match[0];
    const file = resolveSrc(htmlDir, attr(tag, "src"));
    const inBody = bodyAt === -1 || match.index >= bodyAt;
    const lcp = !lcpSet && inBody && file && isRaster(file);

    if (lcp) {
      tag = setAttr(tag, "loading", "eager");
      tag = setAttr(tag, "fetchpriority", "high");
      tag = removeAttr(tag, "decoding");
      lcpSet = true;
    } else if (!lcpSet) {
      tag = removeAttr(tag, "loading");
      tag = removeAttr(tag, "fetchpriority");
      tag = removeAttr(tag, "decoding");
    } else {
      tag = setAttr(tag, "loading", "lazy");
      tag = setAttr(tag, "decoding", "async");
      tag = removeAttr(tag, "fetchpriority");
    }

    if (tag !== match[0]) updated += 1;
    out += html.slice(cursor, match.index) + tag;
    cursor = match.index + match[0].length;
  }
  out += html.slice(cursor);

  fs.writeFileSync(entry, out);
  if (updated === 0) console.log("Image attrs already set");
  else console.log(`Image attrs updated on ${updated} tags`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { entry } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/scripts/image-attrs.js work/<folder>",
  );
  imageAttrs(entry);
}
