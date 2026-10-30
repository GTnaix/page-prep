import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveJob } from "../../scripts/lib.js";

function dropOtherBackups(dir, dest) {
  const keep = path.resolve(dest);
  const skipped = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().endsWith(".bak")) continue;
    const full = path.join(dir, name);
    if (path.resolve(full) === keep) continue;
    try {
      fs.rmSync(full, { force: true });
      console.log(`Removed ${name}`);
    } catch {
      skipped.push(name);
    }
  }
  if (skipped.length) console.log(`Kept locked leftover: ${skipped.join(", ")}`);
}

export function backupHtml(entry) {
  const dest = `${entry}.bak`;
  fs.copyFileSync(entry, dest);
  console.log(`Backup: ${path.basename(dest)}`);
  dropOtherBackups(path.dirname(entry), dest);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { entry } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/steps/shared/backup-html.js work/<folder>",
  );
  backupHtml(entry);
}
