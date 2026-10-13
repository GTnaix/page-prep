import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import prettier from "prettier";
import { fail, findCssFile, resolveJob } from "./lib.js";

export async function formatCss(landingDir, cssFile) {
  const cssPath = findCssFile(landingDir, cssFile);
  if (!cssPath) {
    console.log("Format skipped: no style.css");
    return;
  }

  try {
    let css = fs.readFileSync(cssPath, "utf8");
    try {
      const root = postcss.parse(css);
      root.walkComments((comment) => comment.remove());
      css = root.toResult({ from: undefined }).css;
    } catch {
      // keep original; prettier may still format it
    }
    const formatted = await prettier.format(css, {
      parser: "css",
      printWidth: 100,
    });
    fs.writeFileSync(cssPath, formatted);
    console.log("Formatted CSS");
  } catch {
    console.log("Format skipped: invalid CSS");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { landingDir, cssFile } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/scripts/format-css.js work/<folder>",
  );
  formatCss(landingDir, cssFile).catch((error) => fail(error.message || error));
}
