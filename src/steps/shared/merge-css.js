import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, resolveJob } from "../../scripts/lib.js";

function isInsideHtmlComment(html, index) {
  const before = html.lastIndexOf("<!--", index);
  if (before === -1) return false;
  const close = html.indexOf("-->", before);
  return close === -1 || close > index;
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match ? match[1] : "";
}

function isLocalCssHref(href) {
  if (!href) return false;
  if (/^https?:/i.test(href) || href.startsWith("//")) return false;
  return true;
}

function isCssLink(tag) {
  const rel = attr(tag, "rel").toLowerCase();
  const as = attr(tag, "as").toLowerCase();
  const href = attr(tag, "href");
  if (/\bstylesheet\b/.test(rel)) return isLocalCssHref(href);
  if (as === "style" && /\.css(\?|$)/i.test(href)) return isLocalCssHref(href);
  return false;
}

function isPrintOnlyMedia(media) {
  const value = (media || "").trim().toLowerCase();
  if (!value || value === "all") return false;
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  return !parts.some((part) => {
    if (/\bscreen\b/.test(part) || /\ball\b/.test(part)) return true;
    if (/\bprint\b/.test(part) || /\bspeech\b/.test(part) || /\baural\b/.test(part)) {
      return false;
    }
    return true;
  });
}

function isPrintStylesheet(tag, href) {
  if (isPrintOnlyMedia(attr(tag, "media"))) return true;
  const name = path.basename((href || "").split("?")[0]).toLowerCase();
  return /(?:^|[._-])print(?:[._-]|$)/.test(name);
}

function collectCssSources(html, htmlFile) {
  const STYLE_TAG_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  const LINK_RE = /<link\b[^>]*>/gi;
  const htmlDir = path.dirname(htmlFile);
  const tokens = [];

  for (const match of html.matchAll(STYLE_TAG_RE)) {
    if (isInsideHtmlComment(html, match.index)) continue;
    const open = match[0].match(/^<style\b[^>]*>/i)?.[0] || "";
    tokens.push({
      index: match.index,
      length: match[0].length,
      type: isPrintOnlyMedia(attr(open, "media")) ? "skip" : "inline",
      css: match[1],
    });
  }

  for (const match of html.matchAll(LINK_RE)) {
    if (isInsideHtmlComment(html, match.index)) continue;
    if (!isCssLink(match[0])) continue;
    const href = attr(match[0], "href").trim();
    const file = path.resolve(htmlDir, href.split("?")[0]);
    tokens.push({
      index: match.index,
      length: match[0].length,
      type: isPrintStylesheet(match[0], href) ? "skip" : "file",
      file,
    });
  }

  tokens.sort((a, b) => a.index - b.index);
  return tokens;
}

function rewriteCssUrls(css, fromFile, cssOutFile) {
  const fromDir = path.dirname(fromFile);
  const outDir = path.dirname(cssOutFile);
  return css.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (full, quote, raw) => {
      const value = raw.trim();
      if (
        !value ||
        /^data:/i.test(value) ||
        /^https?:/i.test(value) ||
        value.startsWith("/")
      ) {
        return full;
      }
      const hashIndex = value.search(/[?#]/);
      const filePart = hashIndex === -1 ? value : value.slice(0, hashIndex);
      const suffix = hashIndex === -1 ? "" : value.slice(hashIndex);
      const abs = path.resolve(fromDir, filePart);
      let rel = path.relative(outDir, abs).replaceAll("\\", "/");
      if (!rel.startsWith(".")) rel = `./${rel}`;
      return `url(${quote}${rel}${suffix}${quote})`;
    },
  );
}

function flattenCss(css, fromFile, cssOutFile, seen, mergedFiles, trackFile = true) {
  const absFrom = path.resolve(fromFile);
  if (trackFile) {
    if (seen.has(absFrom)) return "";
    seen.add(absFrom);
  }

  const IMPORT_RE =
    /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)\s*[^;]*;/gi;

  const expanded = css.replace(IMPORT_RE, (full, q1, url1, q2, url2) => {
    const raw = (url1 || url2 || "").trim();
    if (!raw || /^https?:/i.test(raw) || raw.startsWith("//") || raw.startsWith("/")) {
      return full;
    }
    const filePart = raw.split(/[?#]/)[0];
    const importedFile = path.resolve(path.dirname(fromFile), filePart);
    const absImported = path.resolve(importedFile);
    if (!fs.existsSync(importedFile)) return full;
    if (absImported === path.resolve(cssOutFile) || seen.has(absImported)) return "";
    mergedFiles.push(importedFile);
    const imported = fs.readFileSync(importedFile, "utf8");
    return flattenCss(imported, importedFile, cssOutFile, seen, mergedFiles);
  });

  return rewriteCssUrls(expanded, fromFile, cssOutFile);
}

function stripLocalStyles(html, sources) {
  let result = "";
  let cursor = 0;
  let injected = false;
  const linkTag = '<link rel="stylesheet" href="./style.css">';

  for (const source of sources) {
    result += html.slice(cursor, source.index);
    if (!injected) {
      result += linkTag;
      injected = true;
    }
    cursor = source.index + source.length;
  }
  result += html.slice(cursor);

  if (!injected) {
    result = result.replace(/<\/head>/i, `  ${linkTag}\n  </head>`);
  }

  return result.replace(/\n{3,}/g, "\n\n");
}

export function mergeCss(entry, cssOut) {
  const html = fs.readFileSync(entry, "utf8");
  const sources = collectCssSources(html, entry);

  const parts = [];
  const mergedFiles = [];
  const seen = new Set();
  let skippedPrint = 0;
  for (const source of sources) {
    if (source.type === "skip") {
      skippedPrint += 1;
      if (source.file && fs.existsSync(source.file)) mergedFiles.push(source.file);
      continue;
    }
    if (source.type === "inline") {
      parts.push(flattenCss(source.css, entry, cssOut, seen, mergedFiles, false));
      continue;
    }
    if (!fs.existsSync(source.file)) {
      console.warn(`Skip missing CSS: ${source.file}`);
      continue;
    }
    const css = fs.readFileSync(source.file, "utf8");
    parts.push(flattenCss(css, source.file, cssOut, seen, mergedFiles));
    if (path.resolve(source.file) !== path.resolve(cssOut)) {
      mergedFiles.push(source.file);
    }
  }

  fs.writeFileSync(cssOut, parts.join("\n\n"));
  fs.writeFileSync(entry, stripLocalStyles(html, sources));

  for (const file of new Set(mergedFiles.map((item) => path.resolve(item)))) {
    if (path.resolve(file) === path.resolve(cssOut)) continue;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  const size = fs.statSync(cssOut).size;
  console.log(`Merged ${sources.length} CSS sources -> ${path.relative(ROOT, cssOut)}`);
  if (skippedPrint) console.log(`Skipped ${skippedPrint} print stylesheets`);
  console.log(`Size: ${(size / 1024).toFixed(1)} KB`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { entry, cssFile } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/steps/shared/merge-css.js work/<folder>",
  );
  mergeCss(entry, cssFile);
}
