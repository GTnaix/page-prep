import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveJob } from "../../scripts/lib.js";
import { disableForeignForms, normalizeForms } from "./form.js";

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

function readSnippet(tracker, name) {
  return fs.readFileSync(path.join(SNIPPETS, tracker, name), "utf8").trim();
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

const FORM_RE = /<form\b[^>]*>[\s\S]*?<\/form>/gi;

function isLeadForm(form) {
  return /name\s*=\s*["'](?:first_name|last_name|sendingmail|phone-num)["']/i.test(form)
    || /type\s*=\s*["']tel["']/i.test(form)
    || /id\s*=\s*["'](?:phone|buttonSbmt)["']/i.test(form);
}

function stripAio(html) {
  return html
    .replace(/\{\{aio:head\}\}/g, "")
    .replace(/\{\{aio:macros:number_link\}\}/g, "")
    .replace(/\{\{aio:macros:form_loader\}\}/g, "")
    .replace(/\{\{form\}\}/g, "")
    .replace(/\{\{aio\}\}/g, "");
}

function replaceLeadForms(html) {
  let count = 0;
  const next = html.replace(FORM_RE, (form) => {
    if (!isLeadForm(form)) return form;
    count += 1;
    return "{{form}}";
  });
  return { html: next, count };
}

function injectBody(html, libs) {
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${libs}\n</body>`);
  }
  return `${html}\n${libs}\n`;
}

function applyAio(html) {
  let next = stripFormLibs(stripAio(stripAnalytics(html)));
  const forms = replaceLeadForms(next);
  next = disableForeignForms(forms.html);
  next = injectHead(next, readSnippet("aio", "head.html"));
  const body = forms.count
    ? readSnippet("aio", "body.html")
    : `{{form}}\n${readSnippet("aio", "body.html")}`;
  return injectBody(next, body);
}

export function apply(entry, tracker = "binom", google = false) {
  let html = fs.readFileSync(entry, "utf8");
  html = stripLeadingPhp(html);
  if (tracker === "aio") {
    html = applyAio(html);
    fs.writeFileSync(entry, html);
    console.log("AIO macros placed, form replaced");
    return;
  }
  const suffix = tracker === "binom" && google ? "-google" : "";
  html = `${readSnippet(tracker, `boot${suffix}.php`)}\n\n${html.replace(/^\s+/, "")}`;
  html = stripAnalytics(html);
  html = injectHead(html, readSnippet(tracker, `head${suffix}.html`));
  html = stripFormLibs(html);
  html = injectBody(html, readSnippet(tracker, "form.html"));
  const forms = normalizeForms(html, tracker, google);
  html = forms.html;
  fs.writeFileSync(entry, html);
  const direction = tracker === "keitaro" ? "keitaro" : google ? "google" : "facebook";
  console.log(
    `PHP: offer bootstrap, analytics, form libs replaced (${direction}), form ${forms.count ? "normalized" : "none"}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { entry, google, tracker } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/steps/offer/apply.js work/<folder> [--google | --keitaro | --aio]",
  );
  apply(entry, tracker, google);
}
