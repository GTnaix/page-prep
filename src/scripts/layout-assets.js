import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findCssFile, posix, uniqueDest, walkFiles, resolveJob } from "./lib.js";
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

function destDirFor(file, landingDir) {
  const ext = path.extname(file).toLowerCase();
  const rel = posix(path.relative(landingDir, file));
  if (path.basename(file) === "style.css" && !rel.startsWith("assets/")) {
    return path.join(landingDir, "assets", "css");
  }
  if (IMAGE_EXT.has(ext)) return path.join(landingDir, "assets", "images");
  if (FONT_EXT.has(ext)) return path.join(landingDir, "assets", "fonts");
  if (VIDEO_EXT.has(ext)) return path.join(landingDir, "assets", "video");
  if (ext === ".js") return path.join(landingDir, "assets", "js");
  return null;
}

function alreadyPlaced(file, destFolder) {
  return path.resolve(path.dirname(file)) === path.resolve(destFolder);
}

function removeEmptyDirs(dir, landingDir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      removeEmptyDirs(path.join(dir, entry.name), landingDir);
    }
  }
  if (path.resolve(dir) === path.resolve(landingDir)) return;
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

export function layoutAssets(landingDir, entry, cssFile) {
  const htmlDir = path.dirname(entry);
  const moves = [];

  const currentCss = findCssFile(landingDir, cssFile);

  if (currentCss) {
    const cssDestDir = path.join(landingDir, "assets", "css");
    const cssDest = path.join(cssDestDir, "style.css");
    if (path.resolve(currentCss) !== path.resolve(cssDest)) {
      moves.push({ from: currentCss, to: cssDest });
    }
  }

  for (const file of walkFiles(landingDir)) {
    if (currentCss && path.resolve(file) === path.resolve(currentCss)) continue;
    const destFolder = destDirFor(file, landingDir);
    if (!destFolder || alreadyPlaced(file, destFolder)) continue;
    const to = uniqueDest(destFolder, path.basename(file));
    if (path.resolve(file) === path.resolve(to)) continue;
    moves.push({ from: file, to });
  }

  for (const { from, to } of moves) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
  }

  const cssDest = path.join(landingDir, "assets", "css", "style.css");
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
  fs.writeFileSync(entry, html);

  removeEmptyDirs(landingDir, landingDir);
  fixCssUrls(landingDir, cssDest);
  if (moves.length === 0) console.log("Assets already in assets/");
  else console.log(`Moved ${moves.length} files into assets/`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { landingDir, entry, cssFile } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/scripts/layout-assets.js work/<folder>",
  );
  layoutAssets(landingDir, entry, cssFile);
}
