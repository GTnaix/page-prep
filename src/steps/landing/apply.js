import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveJob } from "../../scripts/lib.js";

const SNIPPETS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "snippets",
  "landing",
);
const HEAD_START = "<!-- analytics -->";
const HEAD_END = "<!-- /analytics -->";
const HEAD_BLOCK = /<!--\s*\/?analytics\s*-->[\s\S]*?<!--\s*\/analytics\s*-->/g;
const HEAD_MARK = /<!--\s*\/?analytics\s*-->/g;

function readSnippet(tracker, name) {
  const dir = tracker === "binom" ? SNIPPETS : path.join(SNIPPETS, tracker);
  return fs.readFileSync(path.join(dir, name), "utf8").trim();
}

function stripAio(html) {
  return html
    .replace(/\{\{aio:head\}\}/g, "")
    .replace(/\{\{aio:macros:number_link\}\}/g, "")
    .replace(/\{\{aio:macros:form_loader\}\}/g, "")
    .replace(/\{\{aio\}\}/g, "");
}

function stripLeadingPhp(html) {
  return html.replace(/^\uFEFF?\s*(?:<\?(?:php)?[\s\S]*?\?>\s*)+/i, "");
}

function stripScripts(html, shouldDrop) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) =>
    shouldDrop(tag) ? "" : tag,
  );
}

function stripSpyAndOldAnalytics(html) {
  let next = html.replace(HEAD_BLOCK, "").replace(HEAD_MARK, "");

  next = stripScripts(next, (tag) => {
    if (/window\.BINOM_CLICKID|window\.TRK|CLICKID_MACRO/i.test(tag)) return true;
    if (/googletagmanager|offer_preland|gtm\.js|window\.source\s*=\s*['"]google['"]/i.test(tag)) {
      return true;
    }
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

function injectHead(html, analytics) {
  const block = `${HEAD_START}\n${analytics}\n${HEAD_END}`;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `  ${block}\n  </head>`);
  }
  return `${html}\n${block}\n`;
}

function applyAio(html) {
  let next = stripAio(stripSpyAndOldAnalytics(html));
  next = injectHead(next, readSnippet("aio", "head.html"));
  return injectBody(next, readSnippet("aio", "body.html"));
}

function injectBody(html, block) {
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${block}\n</body>`);
  }
  return `${html}\n${block}\n`;
}

export function apply(entry, tracker = "binom", google = false) {
  let html = fs.readFileSync(entry, "utf8");
  html = stripLeadingPhp(html);

  if (tracker === "aio") {
    html = applyAio(html);
    fs.writeFileSync(entry, html);
    console.log("AIO macros placed");
    return;
  }

  const suffix = tracker === "binom" && google ? "-google" : "";
  html = `${readSnippet(tracker, `boot${suffix}.php`)}\n\n${html.replace(/^\s+/, "")}`;

  html = stripSpyAndOldAnalytics(html);
  html = injectHead(html, readSnippet(tracker, `head${suffix}.html`));

  fs.writeFileSync(entry, html);
  const direction = tracker === "keitaro" ? "keitaro" : google ? "google" : "facebook";
  console.log(`PHP: bootstrap replaced, analytics replaced (${direction})`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { entry, google, tracker } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/steps/landing/apply.js work/<folder> [--google | --keitaro | --aio]",
  );
  apply(entry, tracker, google);
}
