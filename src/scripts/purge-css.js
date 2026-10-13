import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import safeParser from "postcss-safe-parser";
import selectorParser from "postcss-selector-parser";
import { PurgeCSS } from "purgecss";
import { ROOT, fail, resolveJob } from "./lib.js";

function selectorOk(selector) {
  if (!String(selector || "").trim()) return false;
  try {
    selectorParser().processSync(selector);
    return true;
  } catch {
    return false;
  }
}

function dropBrokenSelectors(css) {
  const root = postcss.parse(css);
  root.walkRules((rule) => {
    if (!selectorOk(rule.selector)) rule.remove();
  });
  return root.toResult().css;
}

async function recoverCss(raw) {
  const recovered = await postcss().process(raw, {
    parser: safeParser,
    from: undefined,
  });
  return dropBrokenSelectors(recovered.css);
}

export async function purgeCss(entry, cssFile) {
  if (!fs.existsSync(cssFile)) {
    fail(`No style.css in ${path.dirname(cssFile)}. Run merge-css first.`);
  }

  const before = fs.statSync(cssFile).size;
  const raw = fs.readFileSync(cssFile, "utf8");
  let source = raw;
  try {
    source = await recoverCss(raw);
  } catch (error) {
    const detail = String(error.reason || error.message || "invalid CSS")
      .split("\n")[0]
      .slice(0, 200);
    console.log(`Purge skipped: ${detail}`);
    return;
  }

  let purged;
  try {
    [purged] = await new PurgeCSS().purge({
      content: [{ raw: fs.readFileSync(entry, "utf8"), extension: "html" }],
      css: [{ raw: source }],
    });
  } catch (error) {
    if (source !== raw) fs.writeFileSync(cssFile, source);
    const detail = String(error.reason || error.message || "invalid CSS")
      .split("\n")[0]
      .slice(0, 200);
    console.log(`Purge skipped: ${detail}`);
    return;
  }
  fs.writeFileSync(cssFile, purged.css);

  const after = fs.statSync(cssFile).size;
  console.log(`Purged ${path.relative(ROOT, cssFile)}`);
  console.log(
    `Size: ${(before / 1024).toFixed(1)} KB -> ${(after / 1024).toFixed(1)} KB`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { entry, cssFile } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/scripts/purge-css.js work/<folder>",
  );
  purgeCss(entry, cssFile).catch((error) => fail(error.message || error));
}
