/**
 * Response-body safety guardrail (Issue: security-audit-driven, `api-response-dto-boundary`
 * leak class ported from Go to this TypeScript codebase).
 *
 * Background: `.claude/rules/api-response-dto-boundary.md` (homelab-management repo) documents
 * a leak class found repeatedly in `fileee-server` — a domain/library type with its OWN
 * `MarshalJSON`/serialization override ending up (directly, as a slice element, or as a nested
 * field) inside an API response body. Because the type serializes itself by its own logic
 * instead of the surrounding DTO's intended shape, it emits MORE than intended (unmapped
 * fields, internal envelopes, secrets/PII) — regardless of how careful the handler around it
 * is.
 *
 * This codebase has no DTO layer at all (`src/utils/response.ts#jsonResponse` just
 * `JSON.stringify`s whatever `unknown` JSON `DockhandClient` returned) and no class defines a
 * custom `toJSON()` today — so the literal Go leak class does not structurally exist here. But
 * the underlying risk translates directly: this is a pure passthrough proxy, and the ONE thing
 * that must never happen is a *this-codebase-owned* object (a `DockhandClient`/`SessionManager`
 * instance, or a future domain class with its own `toJSON()`) ending up serialized into a tool
 * response instead of the raw upstream JSON. `JSON.stringify` calls `.toJSON()` on any object
 * that defines it — exactly the Go `MarshalJSON` mechanism, just via a different method name —
 * so a future domain class that adds one would silently override whatever fields a handler
 * intended to send.
 *
 * Two guardrails, both preventive (audited: no current violation — see
 * `tests/response-body-safety.test.ts`):
 *
 *   1. `findToJsonMethodDefinitions()` — no class/object anywhere under `src/` may define a
 *      `toJSON()` method. This is the direct TS/JS analog of "no domain type may own a custom
 *      Marshaler" — it blocks the mechanism before it can be combined with #2.
 *   2. `findUnsafeResponseArguments()` — no `jsonResponse(...)`/`textResponse(...)` call site in
 *      `src/tools/*.ts` may pass (directly, nested in an object/array literal, indirectly via a
 *      locally `new`-constructed variable, or via the bare `client`/`session` identifiers) an
 *      instance of anything other than a small allow-listed set of JS built-ins whose own
 *      `toJSON()` (if any) is well-understood and does not leak extra fields (e.g. `Date`).
 *
 * This is intentionally NOT a full TS AST/type-checker pass (no `typescript` compiler API) —
 * `client.get<T>()` etc. return `unknown` at essentially every call site in this codebase (no
 * caller pins `T`), so a type-level check would pass vacuously everywhere and catch nothing.
 * A textual/structural scan that recognizes the concrete danger shapes (`new X(...)`, a bare
 * `client`/`session` argument, a `toJSON` method definition) is what actually catches a future
 * regression — same tier of tool as the rest of this repo's static-analysis tests
 * (`scripts/validate-mcp-tools.mjs`, `tests/route-handlers.test.ts`), reusing the same
 * string/template/comment-aware scanner (`findMatchingClose`) so it doesn't get confused by a
 * `new Foo(` appearing inside a string literal or a comment.
 *
 * Improvement over the `fileee-server` guardrail this is modeled on: that guard needed a
 * hand-maintained list of "registered response types" that could silently drift out of sync
 * with the actual handlers. Here there is no type registry to maintain — the test scans
 * `readdirSync('src/tools')` itself (same pattern as `tests/tool-registration.test.ts`), so a
 * brand-new tool file is covered automatically the moment it exists, with nothing to remember
 * to register.
 */

import { skipString, skipTemplate, findMatchingClose } from './js-scan.mjs';

/**
 * JS/TS built-in constructors considered safe to construct anywhere near a response body.
 * None of these emit undisclosed extra fields when serialized (most either have no own
 * enumerable properties, or a well-understood `toJSON()` like `Date`'s ISO-string form) —
 * unlike a codebase-owned domain/client class, which could grow secret-bearing fields (or a
 * `toJSON()` override) at any point without anyone touching this guardrail.
 */
export const DEFAULT_ALLOWED_CONSTRUCTORS = new Set([
  'Date', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'EvalError', 'URIError',
  'URL', 'URLSearchParams', 'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise',
  'AbortController', 'FormData', 'Blob', 'TextEncoder', 'TextDecoder', 'Buffer',
  'Array', 'Object', 'Number', 'String', 'Boolean',
]);

/**
 * Bare identifiers that must never be the (sole) argument to a response-building call — these
 * are this codebase's own domain objects (the Dockhand HTTP client and its session manager).
 * `jsonResponse(client)` would serialize the client instance itself instead of `await
 * client.get(...)`'s result — exactly the "domain object where a DTO belongs" shape, just
 * without even needing a `new` keyword at the call site because `client`/`session` are already
 * in scope as constructor parameters.
 */
export const DEFAULT_FORBIDDEN_IDENTIFIERS = new Set(['client', 'session']);

/**
 * Replaces the contents of every string literal, template literal and comment in `content`
 * with spaces (newlines preserved), leaving every other character — including the enclosing
 * quotes/comment markers — untouched in place. The result has the exact same length and line
 * structure as `content`, so indices/line numbers computed against it apply unchanged to the
 * original source, while `new Foo(` (or similar) appearing only inside a string or a comment
 * can no longer produce a false positive.
 * @param {string} content
 * @returns {string}
 */
export function stripNoise(content) {
  const chars = content.split('');
  const blank = (start, end) => {
    for (let j = start; j < end; j++) {
      if (chars[j] !== '\n') chars[j] = ' ';
    }
  };

  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    if (ch === "'" || ch === '"') {
      const end = skipString(content, i, ch);
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '`') {
      const end = skipTemplate(content, i);
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '/' && content[i + 1] === '/') {
      const nl = content.indexOf('\n', i);
      const end = nl === -1 ? content.length : nl;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '/' && content[i + 1] === '*') {
      const close = content.indexOf('*/', i);
      const end = close === -1 ? content.length : close + 2;
      blank(i, end);
      i = end;
      continue;
    }
    i++;
  }
  return chars.join('');
}

/** 1-based line number of `index` within `content`. */
function lineOf(content, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

/**
 * Finds every `toJSON` METHOD DEFINITION (class method, class field arrow function, or object
 * literal method) in `content` — never a call site (`someValue.toJSON()`), which is excluded by
 * requiring the match not be preceded by `.`.
 *
 * Matches: `toJSON() {`, `toJSON(...) {`, `toJSON = () => {`, `toJSON = async () => {`.
 * Does NOT match: `x.toJSON()`, `foo.toJSON`, a `toJSON` occurring inside a string/comment
 * (both blanked out by `stripNoise` before this regex runs).
 *
 * @param {string} content
 * @returns {Array<{line: number, snippet: string}>}
 */
export function findToJsonMethodDefinitions(content) {
  const clean = stripNoise(content);
  const re = /(?<![.\w$])toJSON\s*(?:=\s*(?:async\s*)?\(|\()/g;
  const results = [];
  let m;
  while ((m = re.exec(clean)) !== null) {
    const snippet = content.slice(m.index, m.index + 60).split('\n')[0].trim();
    results.push({ line: lineOf(content, m.index), snippet });
  }
  return results;
}

/**
 * Finds response-building call sites (`jsonResponse(...)`/`textResponse(...)` by default) whose
 * argument is unsafe: a bare forbidden identifier (`client`, `session`), or a `new <Ctor>(...)`
 * construction of a non-allow-listed type — direct, nested inside an object/array literal, or
 * indirect via a same-file `const/let/var IDENT = new <Ctor>(...)` declaration.
 *
 * Scope, deliberately: this is a structural/textual scanner, not a dataflow analysis. It
 * resolves ONE level of local variable indirection (`const x = new Foo(); jsonResponse(x)`) but
 * does not chase a value across function boundaries, through destructuring, or through a field
 * on an otherwise-safe object (`jsonResponse({ inner: someVar })` where `someVar` was
 * constructed elsewhere is not traced beyond the direct-assignment case above). That is
 * sufficient to catch the concrete regression this guards against (a domain/client instance —
 * or a future custom-`toJSON()` class — landing directly in a response body) without the
 * complexity/fragility of a full type-aware analysis, which would also be defeated in practice
 * by this codebase's pervasive `unknown` typing (see module doc comment).
 *
 * @param {string} content
 * @param {{calleeNames?: string[], allowedConstructors?: Set<string>, forbiddenIdentifiers?: Set<string>}} [options]
 * @returns {Array<{line: number, callee: string, reason: string, detail: string}>}
 */
export function findUnsafeResponseArguments(content, options = {}) {
  const calleeNames = options.calleeNames ?? ['jsonResponse', 'textResponse'];
  const allowedConstructors = options.allowedConstructors ?? DEFAULT_ALLOWED_CONSTRUCTORS;
  const forbiddenIdentifiers = options.forbiddenIdentifiers ?? DEFAULT_FORBIDDEN_IDENTIFIERS;

  const clean = stripNoise(content);
  const violations = [];

  // One level of local-variable indirection: `const foo = new Bar(...)`.
  const declRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+([A-Za-z_$][\w$]*)\s*\(/g;
  const declaredCtor = new Map();
  let dm;
  while ((dm = declRe.exec(clean)) !== null) {
    declaredCtor.set(dm[1], dm[2]);
  }

  for (const callee of calleeNames) {
    const calleeRe = new RegExp(`(?<![.\\w$])${callee}\\s*\\(`, 'g');
    let cm;
    while ((cm = calleeRe.exec(clean)) !== null) {
      const openParenIndex = cm.index + cm[0].length - 1;
      const closeParenIndex = findMatchingClose(clean, openParenIndex);
      if (closeParenIndex === -1) continue; // unbalanced — not our concern here

      const argClean = clean.slice(openParenIndex + 1, closeParenIndex);
      const trimmed = argClean.trim();
      const line = lineOf(content, cm.index);

      if (forbiddenIdentifiers.has(trimmed)) {
        violations.push({ line, callee, reason: 'forbidden-identifier', detail: trimmed });
        continue;
      }

      if (declaredCtor.has(trimmed)) {
        const ctor = declaredCtor.get(trimmed);
        if (!allowedConstructors.has(ctor)) {
          violations.push({
            line,
            callee,
            reason: 'constructed-instance-indirect',
            detail: `${trimmed} = new ${ctor}(...)`,
          });
          continue;
        }
      }

      const newRe = /\bnew\s+([A-Za-z_$][\w$]*)\s*\(/g;
      let nm;
      while ((nm = newRe.exec(argClean)) !== null) {
        const ctor = nm[1];
        if (!allowedConstructors.has(ctor)) {
          violations.push({ line, callee, reason: 'constructed-instance', detail: `new ${ctor}(...)` });
        }
      }
    }
  }

  return violations;
}
