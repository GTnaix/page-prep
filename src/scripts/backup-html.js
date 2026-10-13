import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveJob } from "./lib.js";

export function backupHtml(entry) {
  const dest = `${entry}.bak`;
  fs.copyFileSync(entry, dest);
  console.log(`Backup: ${path.basename(dest)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { entry } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/scripts/backup-html.js work/<folder>",
  );
  backupHtml(entry);
}
