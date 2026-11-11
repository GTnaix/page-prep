import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import safeParser from "postcss-safe-parser";
import selectorParser from "postcss-selector-parser";
import { PurgeCSS } from "purgecss";
import { ROOT, fail, resolveJob } from "../../scripts/lib.js";

function selectorOk(selector) {
  if (!String(selector || "").trim()) return false;
  try {
    selectorParser().processSync(selector);
    return true;
  } catch {
    return false;
  }
}

function dropBrokenSelectors(css) {
  const root = postcss.parse(css);
  root.walkRules((rule) => {
    if (!selectorOk(rule.selector)) rule.remove();
  });
  return root.toResult().css;
}

async function recoverCss(raw) {
  const recovered = await postcss().process(raw, {
    parser: safeParser,
    from: undefined,
  });
  return dropBrokenSelectors(recovered.css);
}

function decodeHtml(value) {
  let token = String(value || "");
  for (let i = 0; i < 2; i += 1) {
    const next = token
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'");
    if (next === token) break;
    token = next;
  }
  return token;
}

function extractUsedSelectors(content) {
  const found = new Set();
  const add = (value) => {
    const token = decodeHtml(value).trim();
    if (token) found.add(token);
  };
  for (const match of content.matchAll(/class\s*=\s*(["'])([\s\S]*?)\1/gi)) {
    for (const token of match[2].split(/\s+/)) add(token);
  }
  for (const token of content.match(/[^<>"'`\s]*[^<>"'`\s:]/g) || []) add(token);
  for (const token of content.match(/[^<>"'`\s.()]*[^<>"'`\s.():]/g) || []) add(token);
  return [...found];
}

const INDEX_ICON_BASE_CSS = `[class^="index-"]:before,
[class*=" index-"]:before {
  font-family: index-font, sans-serif !important;
  speak: none;
  font-style: normal;
  font-weight: normal;
  font-variant: normal;
  text-transform: none;
  line-height: 1;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
`;

function pageUsesIndexIcons(html) {
  return /\bclass\s*=\s*["'][^"']*\bindex-[\w-]*/.test(html);
}

function cssHasIndexIconBase(css) {
  return /\[class\^=["']index-["']\][^{]*\{[^}]*font-family:\s*index-font/i.test(css);
}

const CONTAINER_BASE_CSS = `[class*="__container"] {
  margin-left: auto;
  margin-right: auto;
  padding-left: 0.9375rem;
  padding-right: 0.9375rem;
}
`;

const POPUP_ACTIVE_CSS = `.popup_show {
  visibility: visible;
  pointer-events: auto;
  z-index: 150;
}
.popup_show .popup__content {
  visibility: visible;
  -webkit-transform: scale(1);
  transform: scale(1);
}
html.popup-show body::after {
  opacity: 1;
  pointer-events: auto;
}
html.lock {
  overflow: hidden;
  touch-action: none;
}
html.lock body {
  position: fixed;
  left: 0;
  right: 0;
  width: 100%;
}
`;

function pageUsesContainers(html) {
  return /\bclass\s*=\s*["'][^"']*__container\b/.test(html);
}

function cssHasContainerBase(css) {
  return /\[class\*=["']__container["']\][^{]*\{[^}]*margin-left:\s*auto/i.test(css);
}

function pageUsesPopup(html) {
  return /\bclass\s*=\s*["'][^"']*\bpopup\b/.test(html) || /\bid\s*=\s*["']popup["']/.test(html);
}

function cssHasPopupActive(css) {
  return /\.popup_show\s*\{[^}]*visibility:\s*visible/i.test(css);
}

const LOADED_BODY_CSS = `html.loaded body {
  opacity: 1;
}
`;

function cssHidesBody(css) {
  return /body[^{]*\{[^}]*opacity\s*:\s*0(?:\s*;|\s*\})/i.test(css);
}

function cssShowsLoadedBody(css) {
  return /(?:html\s*)?\.loaded\s+body[^{]*\{[^}]*opacity\s*:\s*1/i.test(css);
}

export async function purgeCss(entry, cssFile) {
  if (!fs.existsSync(cssFile)) {
    fail(`No style.css in ${path.dirname(cssFile)}. Run merge-css first.`);
  }

  const before = fs.statSync(cssFile).size;
  const raw = fs.readFileSync(cssFile, "utf8");
  let source = raw;
  try {
    source = await recoverCss(raw);
  } catch (error) {
    const detail = String(error.reason || error.message || "invalid CSS")
      .split("\n")[0]
      .slice(0, 200);
    console.log(`Purge skipped: ${detail}`);
    return;
  }

  let purged;
  try {
    [purged] = await new PurgeCSS().purge({
      content: [{ raw: fs.readFileSync(entry, "utf8"), extension: "html" }],
      css: [{ raw: source }],
      defaultExtractor: extractUsedSelectors,
      safelist: {
        greedy: [/index-/, /__container/, /animate__/, /popup/],
        standard: ["loaded", "loading", "popup_show", "popup-show", "lock"],
      },
    });
  } catch (error) {
    if (source !== raw) fs.writeFileSync(cssFile, source);
    const detail = String(error.reason || error.message || "invalid CSS")
      .split("\n")[0]
      .slice(0, 200);
    console.log(`Purge skipped: ${detail}`);
    return;
  }
  let css = purged.css;
  const html = fs.readFileSync(entry, "utf8");
  if (pageUsesIndexIcons(html) && !cssHasIndexIconBase(css)) {
    css = `${css.trimEnd()}\n\n${INDEX_ICON_BASE_CSS}`;
    console.log("Index icon font restored");
  }
  if (pageUsesContainers(html) && !cssHasContainerBase(css)) {
    css = `${css.trimEnd()}\n\n${CONTAINER_BASE_CSS}`;
    console.log("Container layout restored");
  }
  if (pageUsesPopup(html) && !cssHasPopupActive(css)) {
    css = `${css.trimEnd()}\n\n${POPUP_ACTIVE_CSS}`;
    console.log("Popup styles restored");
  }
  if (cssHidesBody(css) && !cssShowsLoadedBody(css)) {
    css = `${css.trimEnd()}\n\n${LOADED_BODY_CSS}`;
    console.log("Loaded body reveal restored");
  }
  fs.writeFileSync(cssFile, css);

  const after = fs.statSync(cssFile).size;
  console.log(`Purged ${path.relative(ROOT, cssFile)}`);
  console.log(
    `Size: ${(before / 1024).toFixed(1)} KB -> ${(after / 1024).toFixed(1)} KB`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { entry, cssFile } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/steps/shared/purge-css.js work/<folder>",
  );
  purgeCss(entry, cssFile).catch((error) => fail(error.message || error));
}
