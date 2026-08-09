/**
 * Shared string/template/comment-aware bracket scanner.
 *
 * Both `extract-dockhand-api.mjs` (scans the upstream Dockhand route handlers) and
 * `validate-mcp-tools.mjs` (scans our own MCP tool call sites) need to walk JS/TS source
 * text respecting string literals, template literals and comments — a plain regex over
 * raw source text breaks the moment a `{`, `}`, `(`, `)`, `'`, `"` or `` ` `` shows up
 * inside a string/comment. This module is the single, tested implementation of that
 * bracket/string-aware scanning so both scripts (and their tests) share one behavior
 * instead of drifting apart.
 *
 * This is intentionally NOT a full JS/TS parser (no AST, no operator precedence beyond
 * what is needed for ternaries) — just enough structural awareness for the simple
 * expression shapes actually used in this codebase (object literals, ternaries,
 * `client.<method>(...)` call arguments).
 */

/**
 * Überspringt einen String-Literal-Body ab dem öffnenden Quote-Zeichen.
 * @param {string} text
 * @param {number} i Index des öffnenden Quote-Zeichens
 * @param {string} quote `'` oder `"`
 * @returns {number} Index direkt nach dem schließenden Quote
 */
export function skipString(text, i, quote) {
  i++;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === quote) {
      return i + 1;
    }
    i++;
  }
  return i;
}

/**
 * Überspringt ein Template-Literal (Backtick-String) inkl. verschachtelter `${...}`
 * Ausdrücke ab dem öffnenden Backtick.
 * @param {string} text
 * @param {number} i Index des öffnenden Backtick
 * @returns {number} Index direkt nach dem schließenden Backtick
 */
export function skipTemplate(text, i) {
  i++;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === '`') {
      return i + 1;
    }
    if (text[i] === '$' && text[i + 1] === '{') {
      i += 2;
      let depth = 1;
      while (i < text.length && depth > 0) {
        const c = text[i];
        if (c === "'" || c === '"') {
          i = skipString(text, i, c);
          continue;
        }
        if (c === '`') {
          i = skipTemplate(text, i);
          continue;
        }
        if (c === '{') {
          depth++;
          i++;
          continue;
        }
        if (c === '}') {
          depth--;
          i++;
          continue;
        }
        i++;
      }
      continue;
    }
    i++;
  }
  return i;
}

/**
 * Findet den Index der zu `content[openIndex]` passenden schließenden Klammer
 * (respektiert Strings, Template-Literale und Kommentare).
 * @param {string} content
 * @param {number} openIndex Index von `(`, `{` oder `[`
 * @returns {number} Index der passenden schließenden Klammer, oder -1 bei unbalanciertem Input
 */
export function findMatchingClose(content, openIndex) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const openChar = content[openIndex];
  const closeChar = pairs[openChar];
  if (!closeChar) return -1;

  let depth = 1;
  let i = openIndex + 1;
  while (i < content.length) {
    const ch = content[i];
    if (ch === "'" || ch === '"') {
      i = skipString(content, i, ch);
      continue;
    }
    if (ch === '`') {
      i = skipTemplate(content, i);
      continue;
    }
    if (ch === '/' && content[i + 1] === '/') {
      const nl = content.indexOf('\n', i);
      i = nl === -1 ? content.length : nl;
      continue;
    }
    if (ch === '/' && content[i + 1] === '*') {
      const end = content.indexOf('*/', i);
      i = end === -1 ? content.length : end + 2;
      continue;
    }
    if (ch === openChar) {
      depth++;
      i++;
      continue;
    }
    if (ch === closeChar) {
      depth--;
      if (depth === 0) return i;
      i++;
      continue;
    }
    i++;
  }
  return -1;
}

/**
 * Splittet einen Ausdruck an Top-Level-Kommas (Tiefe 0), respektiert dabei
 * verschachtelte Klammern/Objekte/Arrays, Strings, Template-Literale und Kommentare.
 * @param {string} text
 * @returns {string[]} getrimmte Teil-Ausdrücke
 */
export function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      i = skipString(text, i, ch);
      continue;
    }
    if (ch === '`') {
      i = skipTemplate(text, i);
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if ('([{'.includes(ch)) {
      depth++;
      i++;
      continue;
    }
    if (')]}'.includes(ch)) {
      depth--;
      i++;
      continue;
    }
    if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
      i++;
      continue;
    }
    i++;
  }
  const last = text.slice(start);
  if (last.trim().length > 0) parts.push(last);
  return parts.map((p) => p.trim());
}

export const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Ermittelt den Property-Key eines Objekt-Literal-Segments (`key: value` oder
 * Shorthand `key`). Gibt `null` zurück wenn kein statisch bestimmbarer Key vorliegt
 * (Spread `...x`, computed key `[expr]: ...`).
 * @param {string} segment Ein Top-Level-Segment aus splitTopLevel() über den Objekt-Inhalt
 * @returns {string|null}
 */
export function extractObjectKey(segment) {
  const seg = segment.trim();
  if (!seg || seg.startsWith('...')) return null;
  if (seg.startsWith('[')) return null; // computed key, statisch nicht auflösbar

  const quotedMatch = seg.match(/^(['"])((?:\\.|(?!\1).)*)\1\s*:/);
  if (quotedMatch) return quotedMatch[2];

  let depth = 0;
  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i];
    if (ch === "'" || ch === '"') {
      i = skipString(seg, i, ch) - 1;
      continue;
    }
    if (ch === '`') {
      i = skipTemplate(seg, i) - 1;
      continue;
    }
    if ('([{'.includes(ch)) {
      depth++;
      continue;
    }
    if (')]}'.includes(ch)) {
      depth--;
      continue;
    }
    if (ch === ':' && depth === 0) {
      const key = seg.slice(0, i).trim();
      return IDENTIFIER_RE.test(key) ? key : null;
    }
  }

  // Kein Top-Level-Doppelpunkt → Shorthand-Property `{ foo }`
  return IDENTIFIER_RE.test(seg) ? seg : null;
}

/**
 * Findet den Top-Level-`?` und den dazu passenden Top-Level-`:` eines Conditional-
 * (Ternary-)Ausdrucks `cond ? whenTrue : whenFalse`, respektiert dabei verschachtelte
 * Ternaries (`a ? b ? c : d : e`), Klammern/Objekte/Arrays, Strings, Template-Literale,
 * Kommentare und Optional-Chaining (`?.`) sowie Nullish-Coalescing (`??`) — beide
 * beginnen ebenfalls mit `?`, zählen aber NICHT als Ternary-`?`.
 * @param {string} text
 * @returns {{condition: string, whenTrue: string, whenFalse: string}|null} `null` wenn
 *   kein Top-Level-Ternary gefunden wird.
 */
export function splitTernary(text) {
  let depth = 0;
  let questionIndex = -1;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      i = skipString(text, i, ch);
      continue;
    }
    if (ch === '`') {
      i = skipTemplate(text, i);
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if ('([{'.includes(ch)) {
      depth++;
      i++;
      continue;
    }
    if (')]}'.includes(ch)) {
      depth--;
      i++;
      continue;
    }
    if (ch === '?' && depth === 0) {
      // `?.` optional chaining and `??` nullish coalescing are not a ternary `?`.
      if (text[i + 1] === '.' || text[i + 1] === '?') {
        i += 2;
        continue;
      }
      questionIndex = i;
      break;
    }
    i++;
  }

  if (questionIndex === -1) return null;

  // Ab dem `?` weiterscannen und den passenden Top-Level-`:` finden. Verschachtelte
  // Ternaries im `whenTrue`-Zweig öffnen ihrerseits ein `?...:`-Paar — ternaryDepth
  // zählt das mit, damit nicht das `:` des inneren Ternary fälschlich als Ende gilt.
  let ternaryDepth = 1;
  let colonIndex = -1;
  i = questionIndex + 1;
  let bracketDepth = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      i = skipString(text, i, ch);
      continue;
    }
    if (ch === '`') {
      i = skipTemplate(text, i);
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if ('([{'.includes(ch)) {
      bracketDepth++;
      i++;
      continue;
    }
    if (')]}'.includes(ch)) {
      bracketDepth--;
      i++;
      continue;
    }
    if (bracketDepth === 0 && ch === '?' && text[i + 1] !== '.' && text[i + 1] !== '?') {
      ternaryDepth++;
      i++;
      continue;
    }
    if (bracketDepth === 0 && ch === ':') {
      ternaryDepth--;
      if (ternaryDepth === 0) {
        colonIndex = i;
        break;
      }
      i++;
      continue;
    }
    i++;
  }

  if (colonIndex === -1) return null; // unbalanced / not actually a ternary

  return {
    condition: text.slice(0, questionIndex).trim(),
    whenTrue: text.slice(questionIndex + 1, colonIndex).trim(),
    whenFalse: text.slice(colonIndex + 1).trim(),
  };
}
