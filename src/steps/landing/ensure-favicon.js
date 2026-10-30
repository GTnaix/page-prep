import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { posix, resolveJob, walkFiles } from "../../scripts/lib.js";

function isIconFile(file) {
  const name = path.basename(file).toLowerCase();
  const ext = path.extname(name);
  return ext === ".ico" || name.startsWith("favicon");
}

function pickFavicon(files) {
  const icons = files.filter(isIconFile);
  const ranked = [...icons].sort((a, b) => {
    const an = path.basename(a).toLowerCase();
    const bn = path.basename(b).toLowerCase();
    const score = (name) => {
      if (name === "favicon.ico") return 0;
      if (name.startsWith("favicon")) return 1;
      if (name.endsWith(".ico")) return 2;
      return 3;
    };
    return score(an) - score(bn);
  });
  return ranked[0] || null;
}

function hasIconLink(html) {
  const links = html.match(/<link\b[^>]*>/gi) || [];
  return links.some((tag) => {
    const value = (tag.match(/\brel\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!value) return false;
    const normalized = value.toLowerCase().trim();
    if (normalized.includes("apple-touch")) return false;
    return (
      normalized === "icon" ||
      normalized === "shortcut icon" ||
      /(^|\s)icon(\s|$)/.test(normalized)
    );
  });
}

function hrefFor(pageDir, file) {
  const rel = posix(path.relative(pageDir, file));
  return `./${rel}`.replace(/^\.\/\.\//, "./");
}

function injectLink(html, tag) {
  if (/<!-- analytics -->/.test(html)) {
    return html.replace(
      /<!-- analytics -->/,
      `  ${tag}\n    <!-- analytics -->`,
    );
  }
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `    ${tag}\n  </head>`);
  }
  return `${tag}\n${html}`;
}

export function ensureFavicon(pageDir, entry) {
  const favicon = pickFavicon(walkFiles(pageDir));
  if (!favicon) {
    console.log("Favicon: none");
    return;
  }

  let html = fs.readFileSync(entry, "utf8");
  if (hasIconLink(html)) {
    console.log(`Favicon: ${path.basename(favicon)}, link kept`);
    return;
  }

  html = injectLink(
    html,
    `<link rel="icon" href="${hrefFor(pageDir, favicon)}" />`,
  );
  fs.writeFileSync(entry, html);
  console.log(`Favicon: ${path.basename(favicon)}, link added`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { pageDir, entry } = resolveJob(
    process.argv.slice(2),
    "Usage: node src/steps/landing/ensure-favicon.js work/<folder>",
  );
  ensureFavicon(pageDir, entry);
}
