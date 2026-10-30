import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { fail, posix, resolveJob } from "../../scripts/lib.js";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static");

const VIDEO_OPEN = /<video\b[^>]*>/gi;
const MAX_EDGE = 1280;

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match ? match[1] : "";
}

function hasFlag(tag, name) {
  return new RegExp(`\\s${name}(?:\\s|=|/|>)`, "i").test(` ${tag}`);
}

function setAttr(tag, name, value) {
  const re = new RegExp(`(\\s)${name}\\s*=\\s*["'][^"']*["']`, "i");
  if (re.test(tag)) return tag.replace(re, `$1${name}="${value}"`);
  if (hasFlag(tag, name) && value === "") return tag;
  return tag.replace(/(\s*\/?>)$/, ` ${name}="${value}"$1`);
}

function setFlag(tag, name) {
  if (hasFlag(tag, name)) return tag;
  return tag.replace(/(\s*\/?>)$/, ` ${name}$1`);
}

function resolveLocal(htmlDir, src) {
  const raw = (src || "").trim().split("?")[0];
  if (!raw || /^https?:/i.test(raw) || raw.startsWith("//") || /^data:/i.test(raw)) {
    return null;
  }
  return path.resolve(htmlDir, raw);
}

function videoSrc(html, tag, index) {
  const fromTag = attr(tag, "src");
  if (fromTag) return fromTag;
  const slice = html.slice(index, index + 1200);
  const source = slice.match(/<source\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
  return source ? source[1] : "";
}

function posterExists(htmlDir, poster) {
  const file = resolveLocal(htmlDir, poster);
  return Boolean(file && fs.existsSync(file));
}

function runFfmpeg(args) {
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) return { status: 1 };
  return spawnSync(ffmpegPath, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60 * 1000,
  });
}

async function makePoster(videoFile, destWebp) {
  const tmp = `${videoFile}.poster-tmp.png`;
  let ok = false;
  for (const ss of ["0.5", "0"]) {
    const result = runFfmpeg([
      "-y",
      "-ss",
      ss,
      "-i",
      videoFile,
      "-frames:v",
      "1",
      tmp,
    ]);
    if (result.status === 0 && fs.existsSync(tmp) && fs.statSync(tmp).size > 0) {
      ok = true;
      break;
    }
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
  if (!ok) return false;

  fs.mkdirSync(path.dirname(destWebp), { recursive: true });
  await sharp(tmp)
    .resize({
      width: MAX_EDGE,
      height: MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toFile(destWebp);
  fs.unlinkSync(tmp);
  return fs.existsSync(destWebp);
}

export async function ensureVideoAttrs(pageDir, entry) {
  const htmlDir = path.dirname(entry);
  const html = fs.readFileSync(entry, "utf8");
  const imagesDir = path.join(pageDir, "assets", "images");
  let posters = 0;
  let updated = 0;
  let cursor = 0;
  let out = "";

  for (const match of html.matchAll(VIDEO_OPEN)) {
    let tag = match[0];
    const src = videoSrc(html, tag, match.index);
    const file = resolveLocal(htmlDir, src);
    if (!file || !fs.existsSync(file)) {
      out += html.slice(cursor, match.index) + tag;
      cursor = match.index + match[0].length;
      continue;
    }

    tag = setAttr(tag, "preload", "none");
    tag = setFlag(tag, "playsinline");

    const poster = attr(tag, "poster");
    if (!posterExists(htmlDir, poster)) {
      const dest = path.join(
        imagesDir,
        `${path.basename(file, path.extname(file))}-poster.webp`,
      );
      if (!fs.existsSync(dest)) {
        const made = await makePoster(file, dest);
        if (made) posters += 1;
      }
      if (fs.existsSync(dest)) {
        const href = `./${posix(path.relative(htmlDir, dest))}`.replace(
          /^\.\/\.\//,
          "./",
        );
        tag = setAttr(tag, "poster", href);
      }
    }

    if (tag !== match[0]) updated += 1;
    out += html.slice(cursor, match.index) + tag;
    cursor = match.index + match[0].length;
  }
  out += html.slice(cursor);

  if (updated) fs.writeFileSync(entry, out);
  if (updated === 0) console.log("Video attrs: none");
  else console.log(`Video attrs: ${updated} tags, ${posters} posters`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { pageDir, entry } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/steps/shared/ensure-video-attrs.js work/<folder>",
  );
  ensureVideoAttrs(pageDir, entry).catch((error) => fail(error.message || error));
}
