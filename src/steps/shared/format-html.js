import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";
import { fail, findCssFile, resolveJob } from "../../scripts/lib.js";
import { compactOfferLines } from "../offer/form.js";
import { formatCss } from "./format-css.js";
import { purgeCss } from "./purge-css.js";

function compactSvg(svg) {
  return svg
    .replace(/\s*\n\s*/g, " ")
    .replace(/>\s+</g, "><")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function pullPhp(html) {
  const blocks = [];
  const next = html.replace(/<\?(?:php)?[\s\S]*?\?>/gi, (block) => {
    const index = blocks.length;
    blocks.push(block);
    return `___PHP_${index}___`;
  });
  return { html: next, blocks };
}

function putPhp(html, blocks) {
  const next = html.replace(
    /___PHP_(\d+)___/g,
    (_, index) => blocks[Number(index)] ?? "",
  );
  return next.replace(/(\?>)[ \t]*\r?\n*(?=<(?:!DOCTYPE|html)\b)/i, "$1\n\n");
}

function spaceBeforeAnalytics(html) {
  return html.replace(/([^\n])\r?\n([ \t]*<!-- analytics -->)/g, "$1\n\n$2");
}

function splitAioMacros(html) {
  return html.replace(
    /([ \t]*)\{\{aio\}\}[ \t]+(\{\{aio:macros:(?:number_link|form_loader)\}\})/g,
    "$1{{aio}}\n$1$2",
  );
}

function pullSvgs(html) {
  const svgs = [];
  const next = html.replace(/<svg\b[\s\S]*?<\/svg>/gi, (svg) => {
    const index = svgs.length;
    svgs.push(compactSvg(svg));
    return `<!--__SVG_${index}__-->`;
  });
  return { html: next, svgs };
}

function putSvgs(html, svgs) {
  return html.replace(/<!--__SVG_(\d+)__-->/g, (_, index) => svgs[Number(index)] ?? "");
}

function repairVueTags(html) {
  return html.replace(/(data-v-[\w-]+)=<(?=[A-Za-z])/g, "$1><");
}

function classTokens(tag) {
  const match = tag.match(/\bclass\s*=\s*(["'])([^"']*)\1/i);
  return match ? match[2].split(/\s+/).filter(Boolean) : [];
}

function isWidgetOpen(tag, name) {
  if (name.toLowerCase() === "vf-widget") return true;
  if (/\bid\s*=\s*(["'])comments\1/i.test(tag)) return true;
  const tokens = classTokens(tag).map((token) => token.toLowerCase());
  return tokens.includes("viafoura") || tokens.includes("cbcvf-comments");
}

function matchElement(html, start, tagName) {
  const openMatch = new RegExp(`^<${tagName}\\b[^>]*>`, "i").exec(html.slice(start));
  if (!openMatch) return null;
  const open = openMatch[0];
  if (/\/>\s*$/.test(open)) return { end: start + open.length };
  const tokenRe = new RegExp(`</?${tagName}\\b[^>]*>`, "gi");
  tokenRe.lastIndex = start + open.length;
  let depth = 1;
  let match;
  while ((match = tokenRe.exec(html))) {
    if (/^<\//.test(match[0])) depth -= 1;
    else if (!/\/>\s*$/.test(match[0])) depth += 1;
    if (depth === 0) return { end: match.index + match[0].length };
  }
  return null;
}

function pullWidgets(html) {
  const blocks = [];
  const openRe = /<(div|section|article|vf-widget)\b[^>]*>/gi;
  let out = "";
  let cursor = 0;
  let match;
  while ((match = openRe.exec(html))) {
    if (match.index < cursor) continue;
    const name = match[1];
    if (!isWidgetOpen(match[0], name)) continue;
    const el = matchElement(html, match.index, name);
    if (!el) continue;
    blocks.push(html.slice(match.index, el.end));
    out += `${html.slice(cursor, match.index)}<!--__WIDGET_${blocks.length - 1}__-->`;
    cursor = el.end;
    openRe.lastIndex = el.end;
  }
  out += html.slice(cursor);
  return { html: out, blocks };
}

function putWidgets(html, blocks) {
  return html.replace(
    /<!--__WIDGET_(\d+)__-->/g,
    (_, index) => blocks[Number(index)] ?? "",
  );
}

export async function formatHtml(entry) {
  const source = fs.readFileSync(entry, "utf8");
  const php = pullPhp(source);
  const widgets = pullWidgets(repairVueTags(php.html));
  const { html, svgs } = pullSvgs(widgets.html);
  try {
    const formatted = await prettier.format(html, {
      parser: "html",
      printWidth: 100,
      bracketSameLine: false,
      htmlWhitespaceSensitivity: "ignore",
    });
    const htmlOut = splitAioMacros(spaceBeforeAnalytics(
      compactOfferLines(putPhp(putWidgets(putSvgs(formatted, svgs), widgets.blocks), php.blocks)),
    ));
    fs.writeFileSync(entry, htmlOut);
    console.log("Formatted HTML");
  } catch {
    console.log("Format skipped: invalid HTML");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { pageDir, entry, cssFile } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/steps/shared/format-html.js work/<folder>",
  );
  const cssPath = findCssFile(pageDir, cssFile);
  Promise.resolve()
    .then(() => (cssPath ? purgeCss(entry, cssPath) : undefined))
    .then(() => formatCss(pageDir, cssFile))
    .then(() => formatHtml(entry))
    .catch((error) => fail(error.message || error));
}
