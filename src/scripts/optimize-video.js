import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolveJob, walkFiles } from "./lib.js";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static");

const VIDEO_EXT = new Set([".mp4", ".webm", ".mov"]);
const MIN_BYTES = 1.5 * 1024 * 1024;
const MAX_EDGE = 1280;

function hasFfmpeg() {
  return Boolean(ffmpegPath) && fs.existsSync(ffmpegPath);
}

function runFfmpeg(args) {
  return spawnSync(ffmpegPath, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5 * 60 * 1000,
  });
}

function encodeArgs(input, output, ext) {
  const scale =
    `scale=${MAX_EDGE}:${MAX_EDGE}:force_original_aspect_ratio=decrease:force_divisible_by=2`;
  const common = ["-hide_banner", "-y", "-i", input, "-vf", scale];
  if (ext === ".webm") {
    return [
      ...common,
      "-c:v",
      "libvpx-vp9",
      "-crf",
      "32",
      "-b:v",
      "0",
      "-c:a",
      "libopus",
      "-b:a",
      "96k",
      output,
    ];
  }
  return [
    ...common,
    "-c:v",
    "libx264",
    "-crf",
    "30",
    "-preset",
    "medium",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    output,
  ];
}

function encodeWithoutAudio(input, output, ext) {
  const args = encodeArgs(input, output, ext);
  const next = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "-c:a" || args[i] === "-b:a" || args[i] === "-ac") {
      i += 1;
      continue;
    }
    next.push(args[i]);
  }
  next.splice(next.length - 1, 0, "-an");
  return next;
}

function compressFile(file) {
  const ext = path.extname(file).toLowerCase();
  const tmp = `${file}.prep-tmp${ext}`;
  let result = runFfmpeg(encodeArgs(file, tmp, ext));
  if (result.status !== 0 || !fs.existsSync(tmp) || fs.statSync(tmp).size === 0) {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    result = runFfmpeg(encodeWithoutAudio(file, tmp, ext));
  }
  if (result.status !== 0 || !fs.existsSync(tmp) || fs.statSync(tmp).size === 0) {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    return { skip: "ffmpeg-failed", detail: (result.stderr || "").slice(-400) };
  }

  const originalSize = fs.statSync(file).size;
  const nextSize = fs.statSync(tmp).size;
  if (nextSize >= originalSize) {
    fs.unlinkSync(tmp);
    return { skip: "larger", originalSize, nextSize };
  }

  fs.unlinkSync(file);
  fs.renameSync(tmp, file);
  return { originalSize, nextSize };
}

export function optimizeVideo(landingDir) {
  const files = walkFiles(landingDir).filter((file) =>
    VIDEO_EXT.has(path.extname(file).toLowerCase()),
  );

  if (files.length === 0) {
    console.log("No video");
    return;
  }

  if (!hasFfmpeg()) {
    console.log("Video skipped: no ffmpeg");
    return;
  }

  let compressed = 0;
  let skippedSmall = 0;
  let skippedLarger = 0;
  let failed = 0;
  let saved = 0;

  for (const file of files) {
    const originalSize = fs.statSync(file).size;
    if (originalSize < MIN_BYTES) {
      skippedSmall += 1;
      continue;
    }

    const result = compressFile(file);
    if (result.skip === "larger") {
      skippedLarger += 1;
      continue;
    }
    if (result.skip) {
      failed += 1;
      console.warn(`Skip ${path.basename(file)}: ffmpeg failed`);
      continue;
    }

    compressed += 1;
    saved += result.originalSize - result.nextSize;
  }

  console.log(
    `Video: ${compressed} compressed, ${skippedSmall} small skipped, ${skippedLarger} kept (larger), ${failed} failed`,
  );
  if (saved) console.log(`Video saved ${(saved / 1024 / 1024).toFixed(1)} MB`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { landingDir } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/scripts/optimize-video.js work/<folder>",
  );
  optimizeVideo(landingDir);
}
