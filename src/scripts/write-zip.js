import fs from "node:fs";
import path from "node:path";
import { ZipArchive } from "archiver";
import { posix, walkFiles } from "./lib.js";

export function writeZip(zipPath, files) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);

    for (const { name, abs } of files) {
      archive.file(abs, { name });
    }
    archive.finalize();
  });
}

export function collectZipFiles(phpFile, assetsDir) {
  const files = [{ name: posix(path.basename(phpFile)), abs: phpFile }];
  for (const abs of walkFiles(assetsDir)) {
    const rel = posix(path.relative(path.dirname(assetsDir), abs));
    files.push({ name: rel, abs });
  }
  return files;
}
