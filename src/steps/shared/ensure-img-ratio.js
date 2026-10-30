import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findCssFile, resolveJob } from "../../scripts/lib.js";

const RULE = `img,
video {
  max-width: 100%;
  height: auto;
}
`;
const HAS_RULE =
  /(?:img\s*,\s*video|video\s*,\s*img)\s*\{[^}]*(?:max-width\s*:\s*100%[^}]*height\s*:\s*auto|height\s*:\s*auto[^}]*max-width\s*:\s*100%)/s;

export function ensureImgRatio(pageDir, cssFile) {
  const cssPath = findCssFile(pageDir, cssFile);
  if (!cssPath) {
    console.log("Img ratio: no style.css");
    return;
  }

  const css = fs.readFileSync(cssPath, "utf8");
  if (HAS_RULE.test(css)) {
    console.log("Img ratio: kept");
    return;
  }

  fs.writeFileSync(cssPath, `${css.trimEnd()}\n\n${RULE}`);
  console.log("Img ratio: added height auto");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { pageDir, cssFile } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/steps/shared/ensure-img-ratio.js work/<folder>",
  );
  ensureImgRatio(pageDir, cssFile);
}
