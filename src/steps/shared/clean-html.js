import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findCssFile, resolveJob } from "../../scripts/lib.js";

const IMG_RE = /<img\b[^>]*>/gi;
const CSP_RE = /<meta\b[^>]*\bhttp-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>/gi;

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match ? match[1] : "";
}

function isTrackerImg(tag) {
  const src = attr(tag, "src");
  if (/delivered/i.test(src) || /\.bin(?:\?|$)/i.test(src)) return true;
  const style = attr(tag, "style");
  return /opacity\s*:\s*0(?:\.0+)?/i.test(style) && /visibility\s*:\s*hidden/i.test(style);
}

function strip(html, re) {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const global = new RegExp(re.source, flags);
  const matches = html.match(global);
  return {
    html: html.replace(global, ""),
    count: matches ? matches.length : 0,
  };
}

function stripHtmlComments(html) {
  let count = 0;
  const next = html.replace(/<!--[\s\S]*?-->/g, (comment) => {
    if (/<!--\s*\/?analytics\s*-->/.test(comment)) return comment;
    count += 1;
    return "";
  });
  return { html: next, count };
}

function stripTrackerImgs(html) {
  let count = 0;
  const next = html.replace(IMG_RE, (tag) => {
    if (!isTrackerImg(tag)) return tag;
    count += 1;
    return "";
  });
  return { html: next, count };
}

function stripEmptyStyles(html) {
  const re =
    /\s+style\s*=\s*(["'])(?:\s*|filter\s*:\s*hue-rotate\s*\([^)]*\)\s*;?)\1/gi;
  const matches = html.match(re);
  return {
    html: html.replace(re, ""),
    count: matches ? matches.length : 0,
  };
}

const KEEP_EMPTY = new Set([
  "href",
  "alt",
  "value",
  "src",
  "class",
  "id",
  "action",
  "name",
  "placeholder",
  "content",
  "type",
  "rel",
  "target",
  "method",
  "for",
  "role",
  "title",
  "lang",
  "charset",
  "media",
  "sizes",
  "srcset",
  "poster",
  "width",
  "height",
  "colspan",
  "rowspan",
  "span",
  "hidden",
  "disabled",
  "checked",
  "selected",
  "readonly",
  "required",
  "multiple",
  "autofocus",
  "controls",
  "autoplay",
  "loop",
  "muted",
  "playsinline",
  "open",
  "defer",
  "async",
  "nomodule",
  "novalidate",
  "download",
  "allowfullscreen",
  "itemscope",
]);

function cssAttrNames(pageDir) {
  const names = new Set();
  const cssPath = findCssFile(pageDir);
  if (!cssPath) return names;
  const css = fs.readFileSync(cssPath, "utf8");
  for (const match of css.matchAll(/\[\s*([a-zA-Z_:][\w:.-]*)/g)) {
    names.add(match[1].toLowerCase());
  }
  return names;
}

function keepEmptyAttr(name, styled) {
  const key = name.toLowerCase();
  if (KEEP_EMPTY.has(key)) return true;
  if (key.startsWith("data-js-")) return true;
  if (key.startsWith("aria-")) return true;
  if (styled.has(key)) return true;
  return false;
}

function stripJunkAttrs(html, styled) {
  let count = 0;
  const next = html.replace(
    /<([a-zA-Z][\w:-]*)(\s[\s\S]*?)(\s*\/?)>/g,
    (full, name, attrs, slash) => {
      const cleaned = attrs.replace(
        /\s+([^\s=\/<>]+)(?:\s*=\s*(["'])([\s\S]*?)\2)?/g,
        (attr, attrName, quote, value) => {
          if (quote == null) return attr;
          if (styled.has(attrName.toLowerCase())) return attr;
          if (value === "{" || (value.trim() === "" && !keepEmptyAttr(attrName, styled))) {
            count += 1;
            return "";
          }
          return attr;
        },
      );
      return `<${name}${cleaned}${slash}>`;
    },
  );
  return { html: next, count };
}

export function cleanHtml(entry) {
  let html = fs.readFileSync(entry, "utf8");
  const styled = cssAttrNames(path.dirname(entry));

  const comments = stripHtmlComments(html);
  html = comments.html;
  const imgs = stripTrackerImgs(html);
  html = imgs.html;
  const csp = strip(html, CSP_RE);
  html = csp.html;
  const styles = stripEmptyStyles(html);
  html = styles.html;
  const attrs = stripJunkAttrs(html, styled);
  html = attrs.html;

  html = html.replace(/\n{3,}/g, "\n\n");
  fs.writeFileSync(entry, html);

  if (comments.count + imgs.count + csp.count + styles.count + attrs.count === 0) {
    console.log("HTML already clean");
    return;
  }
  console.log(
    `HTML: ${comments.count} comments, ${imgs.count} tracker imgs, ${csp.count} CSP metas, ${styles.count} empty style="", ${attrs.count} junk attrs removed`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { entry } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/steps/shared/clean-html.js work/<folder>",
  );
  cleanHtml(entry);
}
