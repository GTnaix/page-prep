import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findCssFile, resolveJob } from "./lib.js";

const MARK = "prep-img-ratio";
const RULE = `/* ${MARK} */
img,
video {
  max-width: 100%;
  height: auto;
}
`;

export function ensureImgRatio(landingDir, cssFile) {
  const cssPath = findCssFile(landingDir, cssFile);
  if (!cssPath) {
    console.log("Img ratio: no style.css");
    return;
  }

  const css = fs.readFileSync(cssPath, "utf8");
  if (css.includes(MARK) && /\/\* prep-img-ratio \*\/\s*img,\s*video\s*\{/s.test(css)) {
    console.log("Img ratio: kept");
    return;
  }

  const replaced = css.replace(
    /\/\* prep-img-ratio \*\/\s*img\s*\{[\s\S]*?\}\s*/m,
    RULE,
  );
  const next = replaced === css ? `${css.trimEnd()}\n\n${RULE}` : replaced;
  fs.writeFileSync(cssPath, next);
  console.log("Img ratio: added height auto");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { landingDir, cssFile } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/scripts/ensure-img-ratio.js work/<folder>",
  );
  ensureImgRatio(landingDir, cssFile);
}
