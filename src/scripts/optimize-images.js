import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { ROOT, fail, findCssFile, resolveJob, uniqueDest, walkFiles } from "./lib.js";

const CONVERT_EXT = new Set([".jpg", ".jpeg", ".png", ".gif"]);
const MAX_EDGE = 1440;
const QUALITY = 82;

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

export async function optimizeImages(landingDir, entry) {
  const html = fs.readFileSync(entry, "utf8");
  const caps = collectImgCaps(html);
  const files = walkFiles(landingDir).filter((file) =>
    CONVERT_EXT.has(path.extname(file).toLowerCase()),
  );

  if (files.length === 0) {
    console.log("No raster images to convert");
    return;
  }

  let htmlOut = html;
  const cssFile = findCssFile(landingDir);
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
  const { landingDir, entry } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/scripts/optimize-images.js work/<folder>",
  );
  optimizeImages(landingDir, entry).catch((error) => fail(error.message || error));
}
