import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, assertInsideWork, fail, resolveJob } from "./lib.js";
import { collectZipFiles, writeZip } from "./write-zip.js";

function removeBackups(pageDir) {
  for (const name of fs.readdirSync(pageDir)) {
    if (!name.toLowerCase().endsWith(".bak")) continue;
    fs.rmSync(path.join(pageDir, name), { force: true });
    console.log(`Removed ${name}`);
  }
}

function renameToPhp(entry) {
  const ext = path.extname(entry).toLowerCase();
  if (ext === ".php") {
    console.log(`Already ${path.basename(entry)}`);
    return entry;
  }
  const dest = path.join(path.dirname(entry), `${path.basename(entry, ext)}.php`);
  if (fs.existsSync(dest) && path.resolve(dest) !== path.resolve(entry)) {
    fs.rmSync(dest, { force: true });
  }
  fs.renameSync(entry, dest);
  console.log(`Renamed ${path.basename(entry)} -> ${path.basename(dest)}`);
  return dest;
}

export async function packPage(pageDir, entry) {
  assertInsideWork(pageDir);
  removeBackups(pageDir);
  const phpFile = renameToPhp(entry);
  const assetsDir = path.join(pageDir, "assets");
  if (!fs.existsSync(assetsDir)) fail("No assets/ folder");

  const zipPath = `${pageDir}.zip`;
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
  await writeZip(zipPath, collectZipFiles(phpFile, assetsDir));
  console.log(`Zip: ${path.relative(ROOT, zipPath)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { pageDir, entry } = resolveJob(
    process.argv.slice(2),
    "Usage: npm run pack -- work/<folder>",
  );
  packPage(pageDir, entry).catch((error) => fail(error.message || error));
}
