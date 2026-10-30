import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fail, resolveJob } from "../../scripts/lib.js";
import { normalizeForms } from "./form.js";

const SNIPPETS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "snippets",
  "offer",
);
const HEAD_START = "<!-- analytics -->";
const HEAD_END = "<!-- /analytics -->";
const HEAD_BLOCK = /<!--\s*\/?analytics\s*-->[\s\S]*?<!--\s*\/analytics\s*-->/g;
const HEAD_MARK = /<!--\s*\/?analytics\s*-->/g;

function readSnippet(name) {
  return fs.readFileSync(path.join(SNIPPETS, name), "utf8").trim();
}

function stripLeadingPhp(html) {
  return html.replace(/^\uFEFF?\s*(?:<\?(?:php)?[\s\S]*?\?>\s*)+/i, "");
}

function stripScripts(html, shouldDrop) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) =>
    shouldDrop(tag) ? "" : tag,
  );
}

function stripAnalytics(html) {
  let next = html.replace(HEAD_BLOCK, "").replace(HEAD_MARK, "");

  next = stripScripts(next, (tag) => {
    if (/window\.BINOM_CLICKID|window\.TRK|CLICKID_MACRO/i.test(tag)) return true;
    if (/googletagmanager|offer_preland|gtm\.js|window\.source\s*=\s*['"]google['"]/i.test(tag)) {
      return true;
    }
    if (/ajax\.googleapis\.com\/ajax\/libs\/jquery\/2\.2\.0\/jquery\.min\.js/i.test(tag)) return true;
    if (/<script\b[^>]*\bsrc\s*=/i.test(tag)) {
      const src = tag.match(/\bsrc\s*=\s*["']([^"']*)["']/i);
      if (src && /events-stat\.js|fbevents\.js/i.test(src[1])) return true;
    }
    return /<script\b[^>]*\basync\b[^>]*>\s*<\/script>/i.test(tag);
  });

  next = next.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, (tag) =>
    /facebook\.com\/tr/i.test(tag) ? "" : tag,
  );

  return next.replace(/\n{3,}/g, "\n\n");
}

function isFormAsset(tag) {
  return /intl-tel-input|loader\.holder\.css|working-pro\/form\/form\.css|form\.prod\.js/i.test(
    tag,
  );
}

function stripFormLibs(html) {
  let next = html.replace(/<link\b[^>]*>/gi, (tag) => (isFormAsset(tag) ? "" : tag));
  next = stripScripts(next, (tag) => {
    if (isFormAsset(tag)) return true;
    if (/countryCode/.test(tag) && /name=["']country["']/.test(tag)) return true;
    if (/_fbp/.test(tag) && /getElementsByName\(["']fbp["']\)/.test(tag)) return true;
    return false;
  });
  next = next.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (tag) =>
    /error-input/.test(tag) && /\.hide/.test(tag) ? "" : tag,
  );
  return next.replace(/\n{3,}/g, "\n\n");
}

function injectHead(html, analytics) {
  const block = `${HEAD_START}\n${analytics}\n${HEAD_END}`;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `  ${block}\n  </head>`);
  }
  return `${html}\n${block}\n`;
}

function injectBody(html, libs) {
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${libs}\n</body>`);
  }
  return `${html}\n${libs}\n`;
}

export function apply(entry) {
  let html = fs.readFileSync(entry, "utf8");
  html = stripLeadingPhp(html);
  html = `${readSnippet("boot.php")}\n\n${html.replace(/^\s+/, "")}`;
  html = stripAnalytics(html);
  html = injectHead(html, readSnippet("head.html"));
  html = stripFormLibs(html);
  html = injectBody(html, readSnippet("form.html"));
  const forms = normalizeForms(html);
  html = forms.html;
  fs.writeFileSync(entry, html);
  console.log(
    `PHP: offer bootstrap, analytics, form libs replaced, form ${forms.count ? "normalized" : "none"}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--google")) fail("Offer Google snippets are not ready");
  const { entry } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/steps/offer/apply.js work/<folder>",
  );
  apply(entry);
}
