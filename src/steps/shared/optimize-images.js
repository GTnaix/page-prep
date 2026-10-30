import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { ROOT, fail, findCssFile, resolveJob, uniqueDest, walkFiles } from "../../scripts/lib.js";

const CONVERT_EXT = new Set([".jpg", ".jpeg", ".png", ".gif"]);
const CHECK_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".bmp"]);
const MAX_EDGE = 1440;
const QUALITY = 82;

const DENSITY_NAME = /(?:@|[-_])[1-9](?:\.\d+)?x(?=\.[^.]+$)/i;

function resolveSrc(fromDir, src) {
  const raw = (src || "").trim().split("?")[0];
  if (
    !raw ||
    /^https?:/i.test(raw) ||
    raw.startsWith("//") ||
    /^data:/i.test(raw) ||
    raw.startsWith("{")
  ) {
    return null;
  }
  return path.resolve(fromDir, raw);
}

async function isBrokenRaster(file) {
  if (fs.statSync(file).size === 0) return true;
  try {
    const meta = await sharp(file).metadata();
    return !meta.width || !meta.height;
  } catch {
    return true;
  }
}

function findFile(htmlDir, pageDir, url) {
  const abs = resolveSrc(htmlDir, url);
  if (abs && fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  const base = path.basename(String(url || "").split("?")[0]);
  if (!base) return null;
  for (const file of walkFiles(pageDir)) {
    if (path.basename(file) === base && fs.statSync(file).isFile()) return file;
  }
  return null;
}

function srcsetParts(value) {
  return value
    .split(",")
    .map((part) => {
      const bits = part.trim().split(/\s+/).filter(Boolean);
      if (!bits.length) return null;
      return { url: bits[0], desc: (bits[1] || "1x").toLowerCase() };
    })
    .filter(Boolean);
}

function hrefFor(htmlDir, file) {
  const rel = path.relative(htmlDir, file).replaceAll("\\", "/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

function densitySiblings(url, htmlDir, pageDir) {
  const base = path.basename(String(url || "").split("?")[0]);
  const ext = path.extname(base);
  const stem = path.basename(base, ext);
  if (!stem || DENSITY_NAME.test(base)) return [];
  const names = [`${stem}@2x${ext}`, `${stem}@3x${ext}`, `${stem}-2x${ext}`, `${stem}_2x${ext}`];
  const found = [];
  for (const name of names) {
    const file = findFile(htmlDir, pageDir, name);
    if (file) found.push(file);
  }
  return found;
}

async function chooseImage(src, srcsetValue, htmlDir, pageDir) {
  const srcFile = src ? findFile(htmlDir, pageDir, src) : null;
  if (srcFile && !(await isBrokenRaster(srcFile))) {
    return { href: src, file: srcFile, drop: null, swapped: false };
  }

  const candidates = [];
  for (const part of srcsetParts(srcsetValue || "")) {
    if (part.desc === "1x") continue;
    const file = findFile(htmlDir, pageDir, part.url);
    if (file) candidates.push(file);
  }
  candidates.push(...densitySiblings(src, htmlDir, pageDir));

  const seen = new Set();
  for (const file of candidates) {
    const abs = path.resolve(file);
    if (seen.has(abs)) continue;
    seen.add(abs);
    if (await isBrokenRaster(file)) continue;
    return {
      href: hrefFor(htmlDir, file),
      file,
      drop: srcFile && path.resolve(srcFile) !== abs ? srcFile : null,
      swapped: true,
    };
  }

  return { href: src, file: srcFile, drop: null, swapped: false };
}

async function collapseSrcset(html, htmlDir, pageDir) {
  const kept = new Set();
  const drops = [];
  let removed = 0;
  let swapped = 0;
  const matches = [...html.matchAll(/<img\b[^>]*>/gi)];
  let next = html;
  for (const match of matches.reverse()) {
    const tag = match[0];
    const srcset = tag.match(/\ssrcset\s*=\s*(["'])([\s\S]*?)\1/i);
    const srcMatch = tag.match(/\ssrc\s*=\s*(["'])([\s\S]*?)\1/i);
    const src = srcMatch ? srcMatch[2].trim() : "";
    if (srcset) removed += 1;
    const choice = await chooseImage(src, srcset?.[2] || "", htmlDir, pageDir);
    if (choice.file) kept.add(path.resolve(choice.file));
    if (choice.drop) drops.push(path.resolve(choice.drop));
    if (choice.swapped) swapped += 1;
    let out = tag;
    if (choice.href && choice.href !== src) {
      if (srcMatch) out = out.replace(srcMatch[0], ` src="${choice.href}"`);
      else out = out.replace(/<img\b/i, `<img src="${choice.href}"`);
    }
    out = out.replace(/\s(?:srcset|sizes)\s*=\s*(["'])[\s\S]*?\1/gi, "");
    next = next.slice(0, match.index) + out + next.slice(match.index + tag.length);
  }
  next = next.replace(/<source\b[^>]*\bsrcset\b[^>]*>/gi, "");
  return { html: next, removed, swapped, kept, drops };
}

function dropDensityFiles(pageDir, kept) {
  let dropped = 0;
  for (const file of walkFiles(pageDir)) {
    if (!DENSITY_NAME.test(path.basename(file))) continue;
    if (kept.has(path.resolve(file))) continue;
    fs.unlinkSync(file);
    dropped += 1;
  }
  return dropped;
}

function referencedFiles(html, fromDir) {
  const refs = new Set();
  for (const match of html.matchAll(/\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    const file = resolveSrc(fromDir, match[1]);
    if (file) refs.add(path.resolve(file));
  }
  return refs;
}

async function dropBrokenRasters(pageDir, entry, html) {
  const refs = referencedFiles(html, path.dirname(entry));
  for (const file of walkFiles(pageDir)) {
    if (!CHECK_EXT.has(path.extname(file).toLowerCase())) continue;
    if (!(await isBrokenRaster(file))) continue;
    const abs = path.resolve(file);
    if (refs.has(abs) && fs.statSync(file).size > 0) {
      console.log(`Image kept, could not read: ${path.relative(ROOT, file)}`);
      continue;
    }
    fs.unlinkSync(file);
    console.log(`Broken image dropped: ${path.relative(ROOT, file)}`);
  }
  return html;
}

function collectImgCaps(html) {
  const caps = new Map();
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const srcMatch = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (!srcMatch) continue;
    const base = path.basename(srcMatch[1].split("?")[0]);
    const width = tag.match(/\bwidth\s*=\s*["']?(\d+)/i);
    const height = tag.match(/\bheight\s*=\s*["']?(\d+)/i);
    const dims = [];
    if (width) dims.push(Number(width[1]) * 2);
    if (height) dims.push(Number(height[1]) * 2);
    if (!dims.length) continue;
    const cap = Math.max(...dims);
    caps.set(base, Math.max(caps.get(base) || 0, cap));
  }
  return caps;
}

function rewriteName(text, fromBase, toBase) {
  if (!text.includes(fromBase)) return text;
  return text.split(fromBase).join(toBase);
}

function targetMaxEdge(width, height, attrCap) {
  let maxEdge = MAX_EDGE;
  if (attrCap) maxEdge = Math.min(maxEdge, attrCap);
  const longest = Math.max(width, height);
  return Math.min(longest, maxEdge);
}

async function convertFile(file, attrCap) {
  const meta = await sharp(file).metadata();
  if ((meta.pages || 1) > 1) {
    return { skip: "animated" };
  }
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (!width || !height) return { skip: "no-size" };

  const longest = Math.max(width, height);
  const maxEdge = targetMaxEdge(width, height, attrCap);
  let pipeline = sharp(file);
  if (longest > maxEdge) {
    const scale = maxEdge / longest;
    pipeline = pipeline.resize(Math.round(width * scale), Math.round(height * scale), {
      withoutEnlargement: true,
    });
  }

  const buffer = await pipeline.webp({ quality: QUALITY, effort: 4 }).toBuffer();
  const originalSize = fs.statSync(file).size;
  if (buffer.length >= originalSize) {
    return { skip: "larger", originalSize, webpSize: buffer.length };
  }

  const dest = uniqueDest(path.dirname(file), `${path.basename(file, path.extname(file))}.webp`);
  fs.writeFileSync(dest, buffer);
  fs.unlinkSync(file);
  return {
    dest,
    originalSize,
    webpSize: buffer.length,
  };
}

export async function optimizeImages(pageDir, entry) {
  const htmlDir = path.dirname(entry);
  const collapsed = await collapseSrcset(fs.readFileSync(entry, "utf8"), htmlDir, pageDir);
  let replaced = 0;
  for (const file of collapsed.drops) {
    if (collapsed.kept.has(file) || !fs.existsSync(file)) continue;
    fs.unlinkSync(file);
    replaced += 1;
  }
  const density = dropDensityFiles(pageDir, collapsed.kept);
  if (collapsed.removed || collapsed.swapped || density) {
    console.log(
      `Srcset removed: ${collapsed.removed}, replaced with density: ${collapsed.swapped}, broken files deleted: ${replaced}, density files deleted: ${density}`,
    );
  }
  let htmlOut = await dropBrokenRasters(pageDir, entry, collapsed.html);
  const caps = collectImgCaps(htmlOut);
  const files = walkFiles(pageDir).filter((file) =>
    CONVERT_EXT.has(path.extname(file).toLowerCase()),
  );

  if (files.length === 0) {
    fs.writeFileSync(entry, htmlOut);
    console.log("No raster images to convert");
    return;
  }
  const cssFile = findCssFile(pageDir);
  let cssOut = cssFile ? fs.readFileSync(cssFile, "utf8") : null;
  let converted = 0;
  let saved = 0;
  let skippedLarger = 0;
  let skippedAnimated = 0;

  for (const file of files) {
    const attrCap = caps.get(path.basename(file));
    let result;
    try {
      result = await convertFile(file, attrCap);
    } catch (error) {
      console.warn(`Skip ${path.relative(ROOT, file)}: ${error.message}`);
      continue;
    }

    if (result.skip === "animated") {
      skippedAnimated += 1;
      continue;
    }
    if (result.skip === "larger") {
      skippedLarger += 1;
      continue;
    }
    if (result.skip) continue;

    const fromBase = path.basename(file);
    const toBase = path.basename(result.dest);
    htmlOut = rewriteName(htmlOut, fromBase, toBase);
    if (cssOut !== null) cssOut = rewriteName(cssOut, fromBase, toBase);
    converted += 1;
    saved += result.originalSize - result.webpSize;
  }

  fs.writeFileSync(entry, htmlOut);
  if (cssFile && cssOut !== null) fs.writeFileSync(cssFile, cssOut);

  console.log(
    `WebP: ${converted} converted, ${skippedLarger} kept (webp larger), ${skippedAnimated} animated skipped`,
  );
  console.log(`Saved ${(saved / 1024).toFixed(1)} KB`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { pageDir, entry } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/steps/shared/optimize-images.js work/<folder>",
  );
  optimizeImages(pageDir, entry).catch((error) => fail(error.message || error));
}
