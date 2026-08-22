/**
 * Exposes the pinned Dockhand OpenAPI source commit as an importable TS constant.
 *
 * The commit itself is already pinned in `scripts/fetch-openapi.mjs` (`SOURCE_COMMIT`,
 * exported from that module) — but `scripts/` sits outside tsconfig's `rootDir: "./src"`
 * (see the "rootDir constraint" note at the top of `src/openapi/spec-loader.ts`, which
 * hits the same wall for `docs/dockhand-openapi.json`), so `src/` code cannot statically
 * import from it. This constant is a small, hand-maintained mirror kept in sync with
 * `SOURCE_COMMIT` — update both together whenever the pinned commit changes.
 */

export const PINNED_DOCKHAND_OPENAPI_COMMIT = 'a485c8580b083614a5e11f78b76d0e1a7173d12e';
