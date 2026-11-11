import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fail, pageDirFromArgs } from "./lib.js";

function renameBak(pageDir) {
  const htmlBak = path.join(pageDir, "index.html.bak");
  const phpBak = path.join(pageDir, "index.php.bak");
  if (!fs.existsSync(phpBak)) return;
  if (fs.existsSync(htmlBak)) fail("Both index.php.bak and index.html.bak");
  fs.renameSync(phpBak, htmlBak);
  console.log("Renamed index.php.bak -> index.html.bak");
}

function toHtml(pageDir) {
  const html = path.join(pageDir, "index.html");
  const php = path.join(pageDir, "index.php");
  const hasHtml = fs.existsSync(html);
  const hasPhp = fs.existsSync(php);
  if (hasHtml && hasPhp) fail("Both index.php and index.html");
  if (!hasHtml && !hasPhp) fail(`No index.php in ${pageDir}`);
  renameBak(pageDir);
  if (!hasPhp) {
    console.log("Already index.html");
    return;
  }
  fs.renameSync(php, html);
  console.log("Renamed index.php -> index.html");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pageDir = pageDirFromArgs(
    process.argv.slice(2),
    "Usage: npm run to-html -- work/<folder>",
  );
  toHtml(pageDir);
}
