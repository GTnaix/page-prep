import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIELDS = fs
  .readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "snippets", "offer", "fields.html"),
    "utf8",
  )
  .trim();

const ACTION = "../../landers/include/working-pro-valid2/send.php";
const FORM_RE = /<form\b[^>]*>[\s\S]*?<\/form>/gi;
const INPUT_RE = /<(?:input|textarea|select)\b[^>]*>/gi;
const HIDDEN_NAMES = new Set([
  "affiliate_id",
  "language",
  "country",
  "creative",
  "tpl",
  "subid",
  "sub4",
  "f",
  "fbp",
  "names",
  "land",
  "campaign_id",
  "offer_id",
  "dial_code",
  "funnel",
  "ip",
]);
const NAMED_FIELDS = new Set(["first_name", "last_name", "sendingmail"]);
const SPANS = `<span id="valid-msg" style="color: green; font-weight: 600;" class="hide">✓ valid</span>
<span id="error-msg" style="color: red; font-weight: 600;" class="hide"></span>`;

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${escapeRe(name)}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match ? match[2] : "";
}

function setAttr(tag, name, value) {
  const re = new RegExp(`\\s${escapeRe(name)}\\s*=\\s*(["'])[\\s\\S]*?\\1`, "i");
  if (re.test(tag)) return tag.replace(re, ` ${name}="${value}"`);
  return tag.replace(/\s*\/?>$/, (end) => ` ${name}="${value}"${end.includes("/") ? " />" : ">"}`);
}

function removeAttr(tag, name) {
  return tag.replace(new RegExp(`\\s${escapeRe(name)}\\s*=\\s*(["'])[\\s\\S]*?\\1`, "i"), "");
}

function classTokens(open) {
  return attr(open, "class")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase());
}

function isLeadForm(form) {
  return /name\s*=\s*["'](?:first_name|last_name|sendingmail|phone-num)["']/i.test(form)
    || /type\s*=\s*["']tel["']/i.test(form)
    || /id\s*=\s*["'](?:phone|buttonSbmt)["']/i.test(form);
}

function isPhone(tag) {
  return attr(tag, "name") === "phone-num"
    || attr(tag, "id") === "phone"
    || attr(tag, "type").toLowerCase() === "tel";
}

function stripLimits(tag) {
  return tag
    .replace(/\s(?:minlength|maxlength)\s*=\s*(["'])[\s\S]*?\1/gi, "")
    .replace(/\s(?:min|max|pattern)\s*=\s*(["'])[\s\S]*?\1/gi, "");
}

function ensureRequired(tag) {
  if (/\srequired(?:\s*=|\s|\/?>)/i.test(tag)) return tag;
  return tag.replace(/\s*\/?>$/, (end) => ` required${end.includes("/") ? " />" : ">"}`);
}

function ensureDisabled(tag) {
  if (/\sdisabled(?:\s*=|\s|\/?>)/i.test(tag)) return tag;
  return tag.replace(/\s*\/?>$/, (end) => ` disabled${end.includes("/") ? " />" : ">"}`);
}

function disableForeignForm(form) {
  const open = form.match(/^<form\b[^>]*>/i)?.[0] ?? "";
  if (!open) return form;
  let nextOpen = setAttr(open, "action", "#");
  nextOpen = setAttr(nextOpen, "onsubmit", "return false");
  const body = form.slice(open.length).replace(/<(?:input|textarea|select|button)\b[^>]*>/gi, ensureDisabled);
  return nextOpen + body;
}

function isItiClass(token) {
  return token === "iti" || token.startsWith("iti--") || token.startsWith("iti__") || token.startsWith("iti-aio");
}

function stripItiClasses(tag) {
  const tokens = classTokens(tag);
  const kept = tokens.filter((token) => !isItiClass(token));
  if (!kept.length) return removeAttr(tag, "class");
  if (kept.join(" ") === tokens.join(" ")) return tag;
  return setAttr(tag, "class", kept.join(" "));
}

function stripPaddingLeft(tag) {
  const style = attr(tag, "style");
  if (!style) return tag;
  const next = style.replace(/padding-left\s*:\s*[^;]+;?/gi, "").replace(/;\s*$/, "").trim();
  if (!next) return removeAttr(tag, "style");
  if (next === style) return tag;
  return setAttr(tag, "style", next);
}

function cleanControl(tag) {
  let next = stripLimits(tag);
  const name = attr(next, "name");
  if (NAMED_FIELDS.has(name)) {
    next = removeAttr(next, "id");
    next = ensureRequired(next);
  }
  if (isPhone(next)) {
    next = setAttr(next, "id", "phone");
    next = ensureRequired(next);
    next = stripItiClasses(next);
    next = removeAttr(next, "data-intl-tel-input-id");
    next = stripPaddingLeft(next);
  }
  return removeAttr(next, "autocomplete");
}

function pullPhp(html) {
  const blocks = [];
  const next = html.replace(/<\?(?:php|=)?[\s\S]*?\?>/gi, (block) => {
    const token = `___PHP_${blocks.length}___`;
    blocks.push(block);
    return token;
  });
  return { html: next, blocks };
}

function putPhp(html, blocks) {
  return html.replace(/___PHP_(\d+)___/g, (_, index) => blocks[Number(index)] ?? "");
}

function stripHidden(form) {
  const php = pullPhp(form);
  let next = php.html.replace(/___PHP_(\d+)___/g, (token, index) =>
    /getHiddenInputString/.test(php.blocks[Number(index)] ?? "") ? "" : token,
  );
  next = next.replace(INPUT_RE, (tag) => {
    const name = attr(tag, "name");
    if (isHoneypot(tag)) return "";
    if (HIDDEN_NAMES.has(name) || /csrf/i.test(name)) return "";
    if (attr(tag, "type").toLowerCase() === "hidden") return "";
    return tag;
  });
  return putPhp(next, php.blocks);
}

function matchElement(html, start, tagName) {
  const openMatch = new RegExp(`^<${tagName}\\b[^>]*>`, "i").exec(html.slice(start));
  if (!openMatch) return null;
  const open = openMatch[0];
  if (/\/>\s*$/.test(open)) return { open, inner: "", end: start + open.length };
  const tokenRe = new RegExp(`</?${tagName}\\b[^>]*>`, "gi");
  tokenRe.lastIndex = start + open.length;
  let depth = 1;
  let match;
  while ((match = tokenRe.exec(html))) {
    if (/^<\//.test(match[0])) depth -= 1;
    else if (!/\/>\s*$/.test(match[0])) depth += 1;
    if (depth === 0) {
      return { open, inner: html.slice(start + open.length, match.index), end: match.index + match[0].length };
    }
  }
  return null;
}

function elementsWithClass(html, tokenTest) {
  const startRe = /<(div|ul|section)\b/gi;
  const found = [];
  let match;
  while ((match = startRe.exec(html))) {
    const el = matchElement(html, match.index, match[1]);
    if (!el) continue;
    if (classTokens(el.open).some(tokenTest)) {
      found.push({ ...el, index: match.index });
      startRe.lastIndex = el.end;
    }
  }
  return found;
}

function dropClass(html, tokenTest) {
  let next = html;
  for (const el of elementsWithClass(html, tokenTest).reverse()) {
    next = next.slice(0, el.index) + next.slice(el.end);
  }
  return next;
}

function dropEmptyDivs(html) {
  let next = html;
  for (let guard = 0; guard < 20; guard += 1) {
    const found = [];
    const startRe = /<div\b/gi;
    let match;
    while ((match = startRe.exec(next))) {
      const el = matchElement(next, match.index, "div");
      if (!el || /<\w/i.test(el.inner)) continue;
      found.push({ ...el, index: match.index });
      startRe.lastIndex = el.end;
    }
    if (!found.length) return next.replace(/\n(?:[ \t]*\n)+/g, "\n");
    for (const el of found.reverse()) next = next.slice(0, el.index) + next.slice(el.end);
  }
  return next;
}

function asPhone(tag) {
  let next = stripLimits(tag);
  next = setAttr(next, "id", "phone");
  next = ensureRequired(next);
  next = stripItiClasses(next);
  next = removeAttr(next, "data-intl-tel-input-id");
  return stripPaddingLeft(next);
}

function findPhoneTag(html) {
  const tags = [...html.matchAll(/<input\b[^>]*>/gi)].map((match) => match[0]);
  const visible = tags.filter((tag) => attr(tag, "type").toLowerCase() !== "hidden");
  return visible.find(isPhone)
    ?? visible.find((tag) => /phone/i.test(`${attr(tag, "name")} ${attr(tag, "id")}`))
    ?? visible.at(-1)
    ?? "";
}

function unwrapIti(html) {
  const isWrapper = (token) => token === "iti" || token.startsWith("iti--");
  let next = html;
  for (const el of elementsWithClass(html, isWrapper).reverse()) {
    const phone = findPhoneTag(el.inner);
    if (!phone) continue;
    next = next.slice(0, el.index) + asPhone(phone) + next.slice(el.end);
  }
  return next;
}

function submitAt(form) {
  const re = /<(button|input)\b[^>]*>/gi;
  let match;
  while ((match = re.exec(form))) {
    const tag = match[0];
    const type = attr(tag, "type").toLowerCase();
    if (tag.startsWith("<input") && type !== "submit") continue;
    if (tag.startsWith("<button") && type === "button") continue;
    return { index: match.index, tag };
  }
  return null;
}

function stripSpans(form) {
  return form.replace(/[ \t]*<span\b[^>]*\bid\s*=\s*["'](?:valid-msg|error-msg)["'][^>]*>[\s\S]*?<\/span>[ \t]*\n?/gi, "");
}

function buttonOnly(inner) {
  const rest = inner
    .replace(/<button\b[^>]*>[\s\S]*?<\/button>/i, "")
    .replace(/<input\b[^>]*>/i, "");
  return !/<\w/i.test(rest);
}

function spanInsertAt(form, submit) {
  const startRe = /<div\b/gi;
  let match;
  let boxAt = null;
  while ((match = startRe.exec(form))) {
    const el = matchElement(form, match.index, "div");
    if (!el || submit.index < match.index || submit.index >= el.end) continue;
    if (buttonOnly(el.inner)) boxAt = match.index;
  }
  const at = boxAt ?? submit.index;
  const lineStart = form.lastIndexOf("\n", at - 1) + 1;
  if (!/\S/.test(form.slice(lineStart, at))) return lineStart;
  return at;
}

function insertSpans(form, spans) {
  const submit = submitAt(form);
  if (!submit) return form;
  const at = spanInsertAt(form, submit);
  const lineStart = form.lastIndexOf("\n", at - 1) + 1;
  const indent = at === lineStart ? "" : (form.slice(lineStart, at).match(/^[ \t]*/)?.[0] ?? "");
  const head = form.slice(0, at).replace(/\n+$/, "");
  return `${head}\n\n${spans}\n\n${indent}${form.slice(at)}`;
}

function ensureSubmit(form) {
  const submit = submitAt(form);
  if (!submit) return form;
  const type = attr(submit.tag, "type").toLowerCase();
  let next = setAttr(submit.tag, "id", "buttonSbmt");
  if (next.startsWith("<button") && type !== "submit") next = setAttr(next, "type", "submit");
  if (next.startsWith("<input")) next = setAttr(next, "type", "submit");
  return `${form.slice(0, submit.index)}${next}${form.slice(submit.index + submit.tag.length)}`;
}

function rewriteOpen(open, indent) {
  const attrs = new Map();
  const re = /([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g;
  let match;
  while ((match = re.exec(open))) attrs.set(match[1].toLowerCase(), match[3]);
  attrs.set("id", "form");
  attrs.set("action", ACTION);
  attrs.set("method", "post");
  const preferred = ["id", "class", "action", "method"];
  const keys = [
    ...preferred.filter((key) => attrs.has(key)),
    ...[...attrs.keys()].filter((key) => !preferred.includes(key)),
  ];
  const pad = `${indent}  `;
  return `<form\n${keys.map((key) => `${pad}${key}="${attrs.get(key)}"`).join("\n")}\n${indent}>`;
}

function normalizeForm(form, indent) {
  const open = form.match(/^<form\b[^>]*>/i)?.[0] ?? "<form>";
  const pad = `${indent}  `;
  let body = stripHidden(form.slice(open.length));
  body = dropClass(body, (token) => token === "presentation-mail");
  body = unwrapIti(body);
  body = body.replace(INPUT_RE, cleanControl);
  body = dropEmptyDivs(stripSpans(body)).replace(/^(?:[ \t]*\r?\n)+/, "").replace(/\n+$/, "");
  const fields = FIELDS.split("\n").map((line) => pad + line).join("\n");
  const spans = SPANS.split("\n").map((line) => pad + line).join("\n");
  const next = `${rewriteOpen(open, indent)}\n${fields}\n\n${body}`;
  return ensureSubmit(insertSpans(next, spans));
}

export function disableForeignForms(html) {
  return html.replace(FORM_RE, (form) => (isLeadForm(form) ? form : disableForeignForm(form)));
}

export function disableForeignFormFile(entry) {
  const html = fs.readFileSync(entry, "utf8");
  const next = disableForeignForms(html);
  if (next !== html) fs.writeFileSync(entry, next);
}

export function normalizeForms(html) {
  const forms = [...html.matchAll(FORM_RE)].map((match) => match[0]);
  const targets = new Set(forms.filter(isLeadForm));
  let count = 0;
  const next = html.replace(FORM_RE, (form, offset) => {
    if (!isLeadForm(form)) return disableForeignForm(form);
    if (!targets.has(form)) return form;
    targets.delete(form);
    count += 1;
    const lineStart = html.lastIndexOf("\n", offset) + 1;
    const indent = html.slice(lineStart, offset).match(/^[ \t]*/)?.[0] ?? "";
    return normalizeForm(form, indent);
  });
  return { html: next, count };
}

export function normalizeFormFile(entry) {
  const html = fs.readFileSync(entry, "utf8");
  const forms = normalizeForms(html);
  if (forms.html !== html) fs.writeFileSync(entry, forms.html);
  return forms.count;
}

const HONEYPOT = FIELDS.split("\n").find((line) => /name="email"/.test(line));

function isHoneypot(tag) {
  return /name\s*=\s*["']email["']/i.test(tag)
    && /type\s*=\s*["']text["']/i.test(tag)
    && /-9999|display\s*:\s*none/i.test(tag);
}

function ensureBlankBefore(html, pattern) {
  const re = new RegExp(`\\n(?:[ \\t]*\\n)*([ \\t]*)(${pattern})`, "i");
  return html.replace(re, (_, indent, tag) => `\n\n${indent}${tag}`);
}

function spaceForm(form) {
  let next = ensureBlankBefore(
    form,
    "<input\\b[^>]*\\bname\\s*=\\s*[\"'](?:first_name|last_name|sendingmail|phone-num)[\"'][^>]*>",
  );
  next = ensureBlankBefore(next, "<span\\b[^>]*\\bid\\s*=\\s*[\"']valid-msg[\"'][^>]*>");
  return ensureBlankBefore(
    next,
    "<(?:button|input)\\b[^>]*\\bid\\s*=\\s*[\"']buttonSbmt[\"'][^>]*>",
  );
}

export function compactOfferLines(html) {
  const [validSpan, errorSpan] = SPANS.split("\n");
  const compacted = html
    .replace(/<input\b[^>]*>/gi, (tag) => (isHoneypot(tag) ? HONEYPOT : tag))
    .replace(/<span\b[^>]*\bid\s*=\s*["']valid-msg["'][^>]*>[\s\S]*?<\/span>/gi, validSpan)
    .replace(/<span\b[^>]*\bid\s*=\s*["']error-msg["'][^>]*>[\s\S]*?<\/span>/gi, errorSpan);
  return compacted.replace(new RegExp(FORM_RE.source, "gi"), (form) => (isLeadForm(form) ? spaceForm(form) : form));
}
