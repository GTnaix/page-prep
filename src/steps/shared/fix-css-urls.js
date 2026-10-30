import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findCssFile, posix, resolveJob } from "../../scripts/lib.js";

function findAsset(cssDir, pageDir, filePart) {
  const base = path.basename(filePart);
  const stem = path.basename(filePart, path.extname(filePart));
  const exact = [
    path.resolve(cssDir, filePart),
    path.resolve(pageDir, filePart),
    path.join(pageDir, "assets", "fonts", base),
    path.join(pageDir, "assets", "images", base),
  ];
  for (const candidate of exact) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }

  for (const dir of [
    path.join(pageDir, "assets", "fonts"),
    path.join(pageDir, "assets", "images"),
    cssDir,
  ]) {
    if (!fs.existsSync(dir)) continue;
    const names = fs.readdirSync(dir);
    const sameName = names.find((name) => name === base);
    if (sameName) return path.join(dir, sameName);
    const sameStem = names.find(
      (name) => path.basename(name, path.extname(name)) === stem,
    );
    if (sameStem) return path.join(dir, sameStem);
  }
  return null;
}

function rewriteOrDropUrls(css, cssPath, pageDir) {
  const cssDir = path.dirname(cssPath);
  let fixed = 0;
  let dropped = 0;
  const next = css.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (full, quote, raw) => {
      const value = raw.trim();
      if (
        !value ||
        /^data:/i.test(value) ||
        /^https?:/i.test(value) ||
        value.startsWith("//") ||
        value.startsWith("/")
      ) {
        return full;
      }
      const hashIndex = value.search(/[?#]/);
      const filePart = hashIndex === -1 ? value : value.slice(0, hashIndex);
      const suffix = hashIndex === -1 ? "" : value.slice(hashIndex);
      const abs = findAsset(cssDir, pageDir, filePart);
      if (!abs) {
        dropped += 1;
        return "url()";
      }
      let rel = posix(path.relative(cssDir, abs));
      if (!rel.startsWith(".")) rel = `./${rel}`;
      const before = value.split(/[?#]/)[0].replace(/\\/g, "/");
      if (posix(before) !== rel) fixed += 1;
      return `url(${quote}${rel}${suffix}${quote})`;
    },
  );
  return { css: next, fixed, dropped };
}

function hasFontFileUrl(block) {
  return /url\s*\(\s*(?!\)|['"]\s*['"])/i.test(block);
}

function tidyEmptyUrls(css) {
  let droppedFaces = 0;
  let next = css
    .replace(/url\(\s*\)/gi, "")
    .replace(/,\s*,+/g, ",")
    .replace(/:\s*,+/g, ":")
    .replace(/,\s*;/g, ";")
    .replace(/(?:src|background(?:-image)?)\s*:\s*;/gi, "");

  next = next.replace(/@font-face\s*\{[^{}]*\}/gi, (block) => {
    if (hasFontFileUrl(block)) return block;
    droppedFaces += 1;
    return "";
  });

  return { css: next.replace(/\n{3,}/g, "\n\n"), droppedFaces };
}

export function fixCssUrls(pageDir, cssFile) {
  const cssPath = findCssFile(pageDir, cssFile);
  if (!cssPath) {
    console.log("CSS urls: no style.css");
    return;
  }

  const source = fs.readFileSync(cssPath, "utf8");
  const rewritten = rewriteOrDropUrls(source, cssPath, pageDir);
  const tidied = tidyEmptyUrls(rewritten.css);
  fs.writeFileSync(cssPath, tidied.css);

  if (rewritten.fixed + rewritten.dropped + tidied.droppedFaces === 0) {
    console.log("CSS urls already ok");
    return;
  }
  console.log(
    `CSS urls: ${rewritten.fixed} fixed, ${rewritten.dropped} missing dropped, ${tidied.droppedFaces} empty @font-face removed`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { pageDir, cssFile } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/steps/shared/fix-css-urls.js work/<folder>",
  );
  fixCssUrls(pageDir, cssFile);
}
