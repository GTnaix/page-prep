import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findCssFile, posix, uniqueDest, walkFiles, resolveJob } from "../../scripts/lib.js";
import { fixCssUrls } from "./fix-css-urls.js";

const IMAGE_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".svg",
  ".gif",
  ".ico",
  ".avif",
  ".bmp",
]);
const FONT_EXT = new Set([".woff", ".woff2", ".ttf", ".otf", ".eot"]);
const VIDEO_EXT = new Set([".mp4", ".webm", ".mov", ".ogg"]);

function destDirFor(file, pageDir) {
  const ext = path.extname(file).toLowerCase();
  const rel = posix(path.relative(pageDir, file));
  if (path.basename(file) === "style.css" && !rel.startsWith("assets/")) {
    return path.join(pageDir, "assets", "css");
  }
  if (IMAGE_EXT.has(ext)) return path.join(pageDir, "assets", "images");
  if (FONT_EXT.has(ext)) return path.join(pageDir, "assets", "fonts");
  if (VIDEO_EXT.has(ext)) return path.join(pageDir, "assets", "video");
  if (ext === ".js") return path.join(pageDir, "assets", "js");
  return null;
}

function alreadyPlaced(file, destFolder) {
  return path.resolve(path.dirname(file)) === path.resolve(destFolder);
}

function removeEmptyDirs(dir, pageDir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      removeEmptyDirs(path.join(dir, entry.name), pageDir);
    }
  }
  if (path.resolve(dir) === path.resolve(pageDir)) return;
  if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

function replacePathInText(text, fromRel, toRel) {
  const variants = [`./${fromRel}`, fromRel];
  let result = text;
  for (const from of variants) {
    let next = "";
    let index = 0;
    while (index < result.length) {
      const found = result.indexOf(from, index);
      if (found === -1) {
        next += result.slice(index);
        break;
      }
      next += result.slice(index, found);
      const before = found > 0 ? result[found - 1] : "";
      if (from === fromRel && (before === "/" || before === ".")) {
        next += from;
        index = found + from.length;
        continue;
      }
      next += toRel;
      index = found + from.length;
    }
    result = next;
  }
  return result;
}

function skipUrl(value) {
  return (
    !value ||
    value.startsWith("#") ||
    value.startsWith("data:") ||
    value.startsWith("{") ||
    value.startsWith("/") ||
    /^https?:/i.test(value) ||
    value.startsWith("//")
  );
}

function hrefFor(htmlDir, abs) {
  let rel = posix(path.relative(htmlDir, abs));
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel.replace(/^\.\/\.\//, "./");
}

function findByBasename(pageDir, base) {
  if (!base) return null;
  for (const folder of ["images", "js", "fonts", "css", "video"]) {
    const candidate = path.join(pageDir, "assets", folder, base);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function fixLocalUrl(url, htmlDir, pageDir) {
  const raw = url.trim();
  if (skipUrl(raw)) return raw;
  const filePart = raw.split(/[?#]/)[0];
  const suffix = raw.slice(filePart.length);
  const abs = path.resolve(htmlDir, filePart);
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return raw;
  const found = findByBasename(pageDir, path.basename(filePart));
  if (!found) return raw;
  return `${hrefFor(htmlDir, found)}${suffix}`;
}

function fixSrcset(value, htmlDir, pageDir) {
  return value
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      const space = trimmed.search(/\s/);
      const url = space === -1 ? trimmed : trimmed.slice(0, space);
      const rest = space === -1 ? "" : trimmed.slice(space);
      return `${fixLocalUrl(url, htmlDir, pageDir)}${rest}`;
    })
    .join(", ");
}

function fixOrphanAssetUrls(html, htmlDir, pageDir) {
  return html.replace(
    /\b(src|href|poster|srcset)\s*=\s*(["'])([^"']*)\2/gi,
    (full, name, quote, value) => {
      const next =
        name.toLowerCase() === "srcset"
          ? fixSrcset(value, htmlDir, pageDir)
          : fixLocalUrl(value, htmlDir, pageDir);
      return next === value ? full : `${name}=${quote}${next}${quote}`;
    },
  );
}

export function layoutAssets(pageDir, entry, cssFile) {
  const htmlDir = path.dirname(entry);
  const moves = [];

  const currentCss = findCssFile(pageDir, cssFile);

  if (currentCss) {
    const cssDestDir = path.join(pageDir, "assets", "css");
    const cssDest = path.join(cssDestDir, "style.css");
    if (path.resolve(currentCss) !== path.resolve(cssDest)) {
      moves.push({ from: currentCss, to: cssDest });
    }
  }

  for (const file of walkFiles(pageDir)) {
    if (currentCss && path.resolve(file) === path.resolve(currentCss)) continue;
    const destFolder = destDirFor(file, pageDir);
    if (!destFolder || alreadyPlaced(file, destFolder)) continue;
    const to = uniqueDest(destFolder, path.basename(file));
    if (path.resolve(file) === path.resolve(to)) continue;
    moves.push({ from: file, to });
  }

  for (const { from, to } of moves) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
  }

  const cssDest = path.join(pageDir, "assets", "css", "style.css");
  let html = fs.readFileSync(entry, "utf8");
  html = html.replace(
    /href=(["'])[^"']*style\.css\1/i,
    'href=$1./assets/css/style.css$1',
  );

  for (const { from, to } of moves) {
    if (path.resolve(to) === path.resolve(cssDest)) continue;
    const fromRel = posix(path.relative(htmlDir, from));
    const toRel = posix(path.relative(htmlDir, to));
    html = replacePathInText(html, fromRel, `./${toRel}`.replace(/^\.\/\.\//, "./"));
  }
  html = fixOrphanAssetUrls(html, htmlDir, pageDir);
  fs.writeFileSync(entry, html);

  removeEmptyDirs(pageDir, pageDir);
  fixCssUrls(pageDir, cssDest);
  if (moves.length === 0) console.log("Assets already in assets/");
  else console.log(`Moved ${moves.length} files into assets/`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { pageDir, entry, cssFile } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/steps/shared/layout-assets.js work/<folder>",
  );
  layoutAssets(pageDir, entry, cssFile);
}
