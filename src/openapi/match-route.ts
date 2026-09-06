/**
 * Reverse-matches a concrete request pathname back to its OpenAPI path TEMPLATE, so that
 * `loggedFetch` (src/client/dockhand-client.ts) can log the endpoint a request actually
 * hit instead of the single, tool-wide route the caller happened to be invoked under.
 *
 * This is deliberately NOT a heuristic templatiser (guess which segments "look like" an
 * identifier). It only ever matches against the KNOWN set of templates the pinned spec
 * defines (`specPathTemplates()`) and only ever returns one of those exact strings —
 * structurally, there is no code path here that can hand back a caller-supplied value,
 * the same safety property `coarseRoute()` relies on for its fallback. A pathname that
 * matches nothing returns `undefined` and the caller falls back to `coarseRoute()`.
 */

import { specPathTemplates } from './spec-loader.js';

interface TemplateEntry {
  readonly template: string;
  readonly segments: readonly string[];
  readonly literalCount: number;
  /** Lowercased HTTP methods the spec defines for this template. */
  readonly methods: ReadonlySet<string>;
}

/** Bucketed by segment count so a match never compares templates of the wrong shape. */
let indexByLength: Map<number, TemplateEntry[]> | undefined;

function splitSegments(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

function isPlaceholder(segment: string): boolean {
  return segment.startsWith('{') && segment.endsWith('}');
}

function buildIndex(): Map<number, TemplateEntry[]> {
  const index = new Map<number, TemplateEntry[]>();
  for (const { template, methods } of specPathTemplates()) {
    const segments = splitSegments(template);
    const literalCount = segments.filter((segment) => !isPlaceholder(segment)).length;
    const entry: TemplateEntry = {
      template,
      segments,
      literalCount,
      methods: new Set(methods.map((method) => method.toLowerCase())),
    };
    const bucket = index.get(segments.length);
    if (bucket) {
      bucket.push(entry);
    } else {
      index.set(segments.length, [entry]);
    }
  }
  return index;
}

/** Every segment must be an exact literal match, or the template's `{...}` placeholder. */
function segmentsMatch(templateSegments: readonly string[], pathSegments: readonly string[]): boolean {
  for (let i = 0; i < templateSegments.length; i++) {
    const templateSegment = templateSegments[i];
    if (templateSegment === undefined || isPlaceholder(templateSegment)) continue;
    if (templateSegment !== pathSegments[i]) return false;
  }
  return true;
}

/**
 * Resolves a concrete request (`method` + `pathname`) to the most specific matching OpenAPI
 * path template.
 *
 * The METHOD is decisive first, because a pathname alone can match two templates that differ
 * only by which verb each defines. `DELETE /api/stacks/adopt` (the `delete_stack` tool acting
 * on a stack literally named `adopt`) matches both the literal `/api/stacks/adopt` — which the
 * spec defines only for POST — and `/api/stacks/{name}`, which is where DELETE actually lives.
 * Picking purely by literal-count would log the nonexistent `DELETE /api/stacks/adopt`. So a
 * candidate whose spec operations include the request's method always beats one whose do not.
 * (Codex, PR #219.)
 *
 * Among candidates of equal method standing, "most specific" then means the most literal
 * (non-`{...}`) segments — so `POST /api/stacks/adopt` still resolves to the literal template.
 * Ties break lexicographically; ties only happen between equally-safe templates, so the
 * tie-break is cosmetic, not a safety decision. If NO matching template defines the method
 * (a spec gap), the method-agnostic most-literal template is still returned rather than
 * dropping to `coarseRoute` — it is a valid known template, never a caller value.
 *
 * Returns `undefined` when no known template matches at all — including when the spec is
 * unavailable, since `specPathTemplates()` then yields an empty set and every pathname fails
 * to match by construction.
 */
export function matchRoute(pathname: string, method: string): string | undefined {
  indexByLength ??= buildIndex();

  const pathSegments = splitSegments(pathname);
  const candidates = indexByLength.get(pathSegments.length);
  if (!candidates) return undefined;

  const wantedMethod = method.toLowerCase();
  let best: TemplateEntry | undefined;
  let bestMethodMatch = false;
  for (const candidate of candidates) {
    if (!segmentsMatch(candidate.segments, pathSegments)) continue;
    const methodMatch = candidate.methods.has(wantedMethod);
    if (!best || preferred(methodMatch, candidate, bestMethodMatch, best)) {
      best = candidate;
      bestMethodMatch = methodMatch;
    }
  }
  return best?.template;
}

/** Whether (methodMatch, candidate) should replace the current (bestMethodMatch, best). */
function preferred(
  methodMatch: boolean,
  candidate: TemplateEntry,
  bestMethodMatch: boolean,
  best: TemplateEntry,
): boolean {
  // A template that defines the request's method always wins over one that does not.
  if (methodMatch !== bestMethodMatch) return methodMatch;
  // Then most-literal wins, then lexicographic (cosmetic — both are safe templates).
  if (candidate.literalCount !== best.literalCount) return candidate.literalCount > best.literalCount;
  return candidate.template < best.template;
}
