import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findCssFile, posix, uniqueDest, resolveJob } from "./lib.js";

const FONT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CSS_HREF_RE =
  /https:\/\/fonts\.googleapis\.com\/css2?[^"'>\s]*/gi;
const FONT_URL_RE = /url\((\s*['"]?)(https:\/\/fonts\.gstatic\.com\/[^'")\s]+)(['"]?\s*)\)/gi;
const LOCAL_FONT_URL_RE = /url\((?:\s*['"]?)(\.\.?\/fonts\/[^'")\s]+)/i;
const FONT_FACE_BLOCK_RE = /(?:\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\/\s*)*@font-face\s*\{[^}]*\}/gi;
const FONT_FAMILY_RE = /font-family\s*:\s*(?:['"]([^'"]+)['"]|([^;}\n]+))/i;
const FONT_WEIGHT_RE = /font-weight\s*:\s*(\d+)/i;
const FONT_STYLE_RE = /font-style\s*:\s*italic/i;
const SUBSET_RE = /\/\*\s*([^*]+?)\s*\*\//;
const WEIGHT_NAMES = {
  100: "Thin",
  200: "ExtraLight",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "SemiBold",
  700: "Bold",
  800: "ExtraBold",
  900: "Black",
};
const GOOGLE_FONT_LINK_RE =
  /<link\b[^>]*(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*>\s*/gi;
const GOOGLE_FONT_NOSCRIPT_RE =
  /<noscript>\s*(?:<link\b[^>]*fonts\.googleapis\.com[^>]*>\s*)+<\/noscript>\s*/gi;

function normalizeFamily(name) {
  return String(name || "")
    .replace(/['"]/g, "")
    .trim()
    .toLowerCase();
}

function rawFamily(block) {
  const match = block.match(FONT_FAMILY_RE);
  return String(match?.[1] || match?.[2] || "").trim();
}

function familyFromBlock(block) {
  return normalizeFamily(rawFamily(block));
}

function familySlug(block) {
  return rawFamily(block).replace(/[^a-zA-Z0-9]+/g, "") || "Font";
}

function styleLabel(block) {
  const weight = Number(block.match(FONT_WEIGHT_RE)?.[1] || 400);
  const italic = FONT_STYLE_RE.test(block);
  const name = WEIGHT_NAMES[weight] || String(weight);
  if (!italic) return name;
  return weight === 400 ? "Italic" : `${name}Italic`;
}

function subsetName(block) {
  const raw = (block.match(SUBSET_RE)?.[1] || "").trim().toLowerCase();
  return raw.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "latin";
}

function subsetSlug(block) {
  const name = subsetName(block);
  return name === "latin" ? "" : name;
}

function fontFileName(block, ext) {
  const parts = [familySlug(block), styleLabel(block)];
  const subset = subsetSlug(block);
  if (subset) parts.push(subset);
  return `${parts.join("-")}${ext}`;
}

function fontUrlFromBlock(block) {
  FONT_URL_RE.lastIndex = 0;
  return FONT_URL_RE.exec(block)?.[2] || "";
}

function localFontRel(block) {
  return block.match(LOCAL_FONT_URL_RE)?.[1] || "";
}

function isRangedFace(block) {
  return /unicode-range/i.test(block);
}

function familiesFromCss(css) {
  const families = new Set();
  for (const block of css.match(FONT_FACE_BLOCK_RE) || []) {
    const family = familyFromBlock(block);
    if (family) families.add(family);
  }
  return families;
}

function allFaces(css) {
  FONT_FACE_BLOCK_RE.lastIndex = 0;
  return css.match(FONT_FACE_BLOCK_RE) || [];
}

function takeFaces(css) {
  const faces = allFaces(css);
  const rest = css.replace(FONT_FACE_BLOCK_RE, "").replace(/^\s+/, "");
  return { faces, rest };
}

function visibleText(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function weightToken(token) {
  const value = String(token).toLowerCase();
  if (value === "bold" || value === "bolder") return 700;
  if (value === "normal") return 400;
  if (value === "lighter") return 300;
  const num = Number(token);
  return Number.isFinite(num) ? num : 0;
}

function collectNeeds(html, css) {
  const weights = new Set([400]);
  for (const match of css.matchAll(/font-weight\s*:\s*(bold|bolder|normal|lighter|\d+)/gi)) {
    const weight = weightToken(match[1]);
    if (weight) weights.add(weight);
  }
  for (const match of css.matchAll(/(?:^|[^-])font\s*:[^;}{]+/gi)) {
    const num = match[0].match(/\b(100|200|300|400|500|600|700|800|900)\b/);
    if (num) weights.add(Number(num[1]));
    if (/\bbold\b/i.test(match[0])) weights.add(700);
  }
  if (/<\s*(strong|b)\b/i.test(html)) weights.add(700);

  const italic =
    /font-style\s*:\s*(italic|oblique)/i.test(css) ||
    /(?:^|[^-])font\s*:[^;}{]*\bitalic\b/i.test(css) ||
    /<\s*(em|i)\b/i.test(html);

  const text = `${html}\n${css}`;
  const subsets = new Set(["latin", "latin-ext"]);
  if (/[\u0400-\u052F]/.test(text)) {
    subsets.add("cyrillic");
    subsets.add("cyrillic-ext");
  }
  if (/[\u0370-\u03FF\u1F00-\u1FFF]/.test(text)) {
    subsets.add("greek");
    subsets.add("greek-ext");
  }
  if (/[\u1EA0-\u1EF9]/.test(text)) subsets.add("vietnamese");
  return { weights, italic, subsets };
}

function keepBlock(block, needs) {
  if (!isRangedFace(block)) return true;
  if (!needs.subsets.has(subsetName(block))) return false;
  const weight = Number(block.match(FONT_WEIGHT_RE)?.[1] || 400);
  if (!needs.weights.has(weight)) return false;
  if (FONT_STYLE_RE.test(block) && !needs.italic) return false;
  return true;
}

async function fetchBuffer(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": FONT_UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": FONT_UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

function collectCssHrefs(html) {
  const hrefs = [...html.matchAll(CSS_HREF_RE)].map((match) => match[0]);
  return [...new Set(hrefs)];
}

function stripGoogleFontTags(html) {
  return html
    .replace(GOOGLE_FONT_NOSCRIPT_RE, "")
    .replace(GOOGLE_FONT_LINK_RE, "")
    .replace(/\n{3,}/g, "\n\n");
}

function resolveLocalFont(cssDir, rel) {
  return path.normalize(path.join(cssDir, rel));
}

function deleteDroppedFonts(cssDir, before, after) {
  const kept = new Set();
  for (const block of after) {
    const rel = localFontRel(block);
    if (rel) kept.add(resolveLocalFont(cssDir, rel));
  }
  let removed = 0;
  for (const block of before) {
    if (!isRangedFace(block)) continue;
    const rel = localFontRel(block);
    if (!rel) continue;
    const file = resolveLocalFont(cssDir, rel);
    if (kept.has(file) || !fs.existsSync(file)) continue;
    fs.unlinkSync(file);
    removed += 1;
  }
  return removed;
}

export async function localizeFonts(landingDir, entry) {
  const html = fs.readFileSync(entry, "utf8");
  const cssPath = findCssFile(landingDir);
  if (!cssPath) {
    console.log("Fonts: skipped, no style.css");
    return;
  }

  const localCss = fs.readFileSync(cssPath, "utf8");
  const { faces, rest } = takeFaces(localCss);
  const needs = collectNeeds(visibleText(html), rest);
  let nextFaces = faces.filter((block) => keepBlock(block, needs));
  const already = familiesFromCss(nextFaces.join("\n"));
  const hrefs = collectCssHrefs(html);
  const cssDir = path.dirname(cssPath);
  let downloaded = 0;
  let fetched = false;

  if (hrefs.length > 0) {
    try {
      const remoteCss = [];
      for (const href of hrefs) remoteCss.push(await fetchText(href));
      fetched = true;
      const remoteBlocks = (remoteCss.join("\n\n").match(FONT_FACE_BLOCK_RE) || []).filter(
        (block) => {
          const family = familyFromBlock(block);
          return family && !already.has(family) && keepBlock(block, needs);
        },
      );

      if (remoteBlocks.length > 0) {
        const fontDir = path.join(landingDir, "assets", "fonts");
        const urlToRel = new Map();
        const urlToBlock = new Map();
        for (const block of remoteBlocks) {
          const fontUrl = fontUrlFromBlock(block);
          if (!fontUrl || urlToBlock.has(fontUrl)) continue;
          urlToBlock.set(fontUrl, block);
        }
        fs.mkdirSync(fontDir, { recursive: true });
        for (const [fontUrl, block] of urlToBlock) {
          const ext = path.extname(fontUrl.split("?")[0]) || ".woff2";
          const dest = uniqueDest(fontDir, fontFileName(block, ext));
          fs.writeFileSync(dest, await fetchBuffer(fontUrl));
          let rel = posix(path.relative(cssDir, dest));
          if (!rel.startsWith(".")) rel = `./${rel}`;
          urlToRel.set(fontUrl, rel);
        }
        downloaded = urlToRel.size;
        const inject = remoteBlocks
          .join("\n\n")
          .replace(FONT_URL_RE, (full, q1, url, q2) => {
            const local = urlToRel.get(url);
            return local ? `url(${q1}${local}${q2})` : full;
          });
        nextFaces = [...(inject.match(FONT_FACE_BLOCK_RE) || []), ...nextFaces];
      }
    } catch (error) {
      console.log(`Fonts: skipped download (${String(error.message || error).slice(0, 120)})`);
    }
  }

  const dropped = deleteDroppedFonts(cssDir, faces, nextFaces);
  const inject = nextFaces.join("\n\n");
  const nextCss = inject ? `${inject}\n\n${rest}` : rest;
  if (nextCss !== localCss) fs.writeFileSync(cssPath, nextCss);
  if (fetched) fs.writeFileSync(entry, stripGoogleFontTags(html));

  if (downloaded) console.log(`Fonts: ${downloaded} files -> assets/fonts`);
  else if (dropped) console.log(`Fonts: dropped ${dropped} unused files`);
  else if (hrefs.length === 0) console.log("Fonts: no Google Fonts links");
  else console.log("Fonts: already local, google links removed");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { landingDir, entry } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/scripts/localize-fonts.js work/<folder>",
  );
  localizeFonts(landingDir, entry).catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
