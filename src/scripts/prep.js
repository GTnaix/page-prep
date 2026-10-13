import { findCssFile, resolveJob } from "./lib.js";
import { mergeCss } from "./merge-css.js";
import { purgeCss } from "./purge-css.js";
import { layoutAssets } from "./layout-assets.js";
import { optimizeImages } from "./optimize-images.js";
import { optimizeVideo } from "./optimize-video.js";
import { cleanFiles } from "./clean-files.js";
import { fixCssUrls } from "./fix-css-urls.js";
import { cleanHtml } from "./clean-html.js";
import { imageAttrs } from "./image-attrs.js";
import { formatHtml } from "./format-html.js";
import { formatCss } from "./format-css.js";
import { applyPhp } from "./apply-php.js";
import { ensureApp } from "./ensure-app.js";
import { ensureFavicon } from "./ensure-favicon.js";
import { ensureImgRatio } from "./ensure-img-ratio.js";
import { ensureVideoAttrs } from "./ensure-video-attrs.js";
import { backupHtml } from "./backup-html.js";
import { localizeFonts } from "./localize-fonts.js";

let { landingDir, entry, cssFile, google } = resolveJob(
  process.argv.slice(2),
  "Usage: npm run prep -- work/<folder> [--google]",
);

mergeCss(entry, cssFile);
await purgeCss(entry, cssFile);
layoutAssets(landingDir, entry, cssFile);
cssFile = findCssFile(landingDir) ?? cssFile;
await localizeFonts(landingDir, entry);
ensureFavicon(landingDir, entry);
await optimizeImages(landingDir, entry);
optimizeVideo(landingDir);
await ensureVideoAttrs(landingDir, entry);
cleanFiles(landingDir, entry);
fixCssUrls(landingDir, cssFile);
ensureImgRatio(landingDir, cssFile);
await formatCss(landingDir, cssFile);
cleanHtml(entry);
imageAttrs(entry);
applyPhp(entry, google);
ensureApp(landingDir, entry);
await formatHtml(entry);
backupHtml(entry);
