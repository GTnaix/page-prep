function matchingParen(source, openIndex) {
  let depth = 0;
  let quote = "";
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i);
      if (nl === -1) return -1;
      i = nl;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function statementStart(source, index) {
  let i = index;
  while (i > 0) {
    const ch = source[i - 1];
    if (ch === ";" || ch === "{" || ch === "}") break;
    i -= 1;
  }
  return i;
}

function isFakeSubmit(body) {
  if (!/preventDefault\s*\(/.test(body)) return false;
  return /(?:(?:window|document)\s*\.\s*)?location(?:\s*\.\s*(?:href|assign|replace))?\s*(?:=|\()\s*['"][^'"]*\.html?['"]/i.test(
    body,
  );
}

function collectCuts(source) {
  const cuts = [];
  const listeners = /addEventListener\s*\(\s*(['"])submit\1/g;
  for (const match of source.matchAll(listeners)) {
    const open = source.indexOf("(", match.index);
    const close = matchingParen(source, open);
    if (close === -1) continue;
    if (!isFakeSubmit(source.slice(open + 1, close))) continue;
    let end = close + 1;
    if (source[end] === ";") end += 1;
    cuts.push([statementStart(source, match.index), end]);
  }

  const assignments = /\bonsubmit\s*=/g;
  for (const match of source.matchAll(assignments)) {
    const brace = source.indexOf("{", match.index);
    if (brace === -1) continue;
    let depth = 0;
    let quote = "";
    let end = -1;
    for (let i = brace; i < source.length; i += 1) {
      const ch = source[i];
      if (quote) {
        if (ch === "\\") {
          i += 1;
          continue;
        }
        if (ch === quote) quote = "";
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        continue;
      }
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end === -1) continue;
    if (!isFakeSubmit(source.slice(brace, end))) continue;
    if (source[end] === ";") end += 1;
    cuts.push([statementStart(source, match.index), end]);
  }
  return cuts;
}

export function stripFormRedirects(source) {
  const cuts = collectCuts(source).sort((a, b) => b[0] - a[0]);
  let next = source;
  let removed = 0;
  let cursor = next.length;
  for (const [start, end] of cuts) {
    if (end > cursor) continue;
    next = next.slice(0, start) + next.slice(end);
    cursor = start;
    removed += 1;
  }
  return { code: next, removed };
}
