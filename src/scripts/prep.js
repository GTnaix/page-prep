import { ensureIndexHtml, findCssFile, resolveJob } from "./lib.js";
import { mergeCss } from "../steps/shared/merge-css.js";
import { purgeCss } from "../steps/shared/purge-css.js";
import { layoutAssets } from "../steps/shared/layout-assets.js";
import { localizeFonts } from "../steps/shared/localize-fonts.js";
import { optimizeImages } from "../steps/shared/optimize-images.js";
import { optimizeVideo } from "../steps/shared/optimize-video.js";
import { ensureVideoAttrs } from "../steps/shared/ensure-video-attrs.js";
import { cleanFiles } from "../steps/shared/clean-files.js";
import { fixCssUrls } from "../steps/shared/fix-css-urls.js";
import { ensureImgRatio } from "../steps/shared/ensure-img-ratio.js";
import { formatCss } from "../steps/shared/format-css.js";
import { cleanHtml } from "../steps/shared/clean-html.js";
import { imageAttrs } from "../steps/shared/image-attrs.js";
import { formatHtml } from "../steps/shared/format-html.js";
import { backupHtml } from "../steps/shared/backup-html.js";
import { ensureFavicon } from "../steps/landing/ensure-favicon.js";
import { apply as applyLanding } from "../steps/landing/apply.js";
import { ensureApp } from "../steps/landing/ensure-app.js";
import { apply as applyOffer } from "../steps/offer/apply.js";
import { ensureApp as ensureOfferApp } from "../steps/offer/ensure-app.js";
import { disableForeignFormFile, normalizeFormFile } from "../steps/offer/form.js";

let { pageDir, entry, cssFile, google, offer } = resolveJob(
  process.argv.slice(2),
  "Usage: npm run prep -- work/<folder> --landing [--google] | --offer",
  { requirePage: true },
);

entry = ensureIndexHtml(pageDir, entry);

mergeCss(entry, cssFile);
await purgeCss(entry, cssFile);
layoutAssets(pageDir, entry, cssFile);
cssFile = findCssFile(pageDir) ?? cssFile;
await localizeFonts(pageDir, entry);
if (!offer) ensureFavicon(pageDir, entry);
await optimizeImages(pageDir, entry);
optimizeVideo(pageDir);
await ensureVideoAttrs(pageDir, entry);
cleanFiles(pageDir, entry);
fixCssUrls(pageDir, cssFile);
ensureImgRatio(pageDir, cssFile);
await formatCss(pageDir, cssFile);
cleanHtml(entry);
imageAttrs(entry);
if (offer) {
  applyOffer(entry);
  ensureOfferApp(pageDir, entry);
}
else {
  applyLanding(entry, google);
  ensureApp(pageDir, entry);
}
await formatHtml(entry);
if (offer) normalizeFormFile(entry);
else disableForeignFormFile(entry);
backupHtml(entry);
