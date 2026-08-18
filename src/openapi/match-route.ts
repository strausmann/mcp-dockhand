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
  for (const template of specPathTemplates()) {
    const segments = splitSegments(template);
    const literalCount = segments.filter((segment) => !isPlaceholder(segment)).length;
    const entry: TemplateEntry = { template, segments, literalCount };
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
 * Resolves `pathname` to the most specific matching OpenAPI path template — "most
 * specific" meaning the most literal (non-`{...}`) segments, so a literal route like
 * `/api/stacks/adopt` wins over the parameterised `/api/stacks/{name}` it would
 * otherwise also match. Ties (equally-literal templates) break lexicographically; ties
 * only happen between equally-safe templates, so the tie-break is cosmetic, not a
 * safety decision.
 *
 * Returns `undefined` when no known template matches — including when the spec is
 * unavailable, since `specPathTemplates()` then yields an empty set and every pathname
 * fails to match by construction.
 */
export function matchRoute(pathname: string): string | undefined {
  indexByLength ??= buildIndex();

  const pathSegments = splitSegments(pathname);
  const candidates = indexByLength.get(pathSegments.length);
  if (!candidates) return undefined;

  let best: TemplateEntry | undefined;
  for (const candidate of candidates) {
    if (!segmentsMatch(candidate.segments, pathSegments)) continue;
    if (
      !best ||
      candidate.literalCount > best.literalCount ||
      (candidate.literalCount === best.literalCount && candidate.template < best.template)
    ) {
      best = candidate;
    }
  }
  return best?.template;
}
