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

export async function formatHtml(entry) {
  const source = fs.readFileSync(entry, "utf8");
  const php = pullPhp(source);
  const { html, svgs } = pullSvgs(php.html);
  try {
    const formatted = await prettier.format(html, {
      parser: "html",
      printWidth: 100,
      bracketSameLine: false,
      htmlWhitespaceSensitivity: "ignore",
    });
    const htmlOut = spaceBeforeAnalytics(
      compactOfferLines(putPhp(putSvgs(formatted, svgs), php.blocks)),
    );
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
