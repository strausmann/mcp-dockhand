#!/usr/bin/env node

/**
 * Drift-Bump: fetches the current `main` HEAD commit SHA of the real upstream
 * `Finsys/dockhand` repo and, if it differs from the currently pinned commit, rewrites
 * BOTH mirrored pin constants:
 *
 *   - `SOURCE_COMMIT` in `scripts/fetch-openapi.mjs`
 *   - `PINNED_DOCKHAND_OPENAPI_COMMIT` in `src/openapi/pinned.ts`
 *
 * (see `src/openapi/pinned.ts`'s file-header comment for why the second constant exists
 * as a hand-maintained mirror instead of a re-export).
 *
 * This script does NOT re-run `fetch-openapi.mjs` or the derived-artifact regenerators
 * itself -- that is the calling workflow's job (`.github/workflows/drift-bump.yml`), run
 * as separate steps so their output is diffed/committed independently.
 *
 * Verwendung:
 *   node scripts/bump-openapi-pin.mjs
 *
 * Mit gesetzter `GITHUB_OUTPUT`-Umgebungsvariable (GitHub Actions) werden zusätzlich
 * `changed`, `previous_sha` und `new_sha` als Step-Outputs geschrieben.
 */

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCE_COMMIT } from './fetch-openapi.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

// Same public repo `fetch-openapi.mjs` fetches from -- see that file's header comment for
// why the source moved from the fork to the real upstream. Unauthenticated GitHub REST
// API calls are fine here: 60 requests/hour is far more than a weekly cron needs, and the
// repo is public.
const UPSTREAM_COMMITS_API_URL = 'https://api.github.com/repos/Finsys/dockhand/commits/main';

const SOURCE_COMMIT_PATTERN = /const SOURCE_COMMIT = '[0-9a-f]{40}';/;
const PINNED_CONSTANT_PATTERN = /export const PINNED_DOCKHAND_OPENAPI_COMMIT = '[0-9a-f]{40}';/;

/**
 * Fetches the current `main` branch HEAD commit SHA of the real upstream `Finsys/dockhand`
 * repo via the GitHub REST API. Injectable so tests never touch the network.
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<string>} A 40-char lowercase hex commit SHA.
 */
export async function fetchLatestMainSha(fetchImpl = fetch) {
  const response = await fetchImpl(UPSTREAM_COMMITS_API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'mcp-dockhand-bump-openapi-pin',
    },
  });

  if (!response.ok) {
    throw new Error(
      `[bump-openapi-pin] GitHub API request failed: ${response.status} ${response.statusText}`
    );
  }

  const body = await response.json();
  const sha = body?.sha;
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error(
      '[bump-openapi-pin] GitHub API response did not contain a valid 40-char commit SHA'
    );
  }

  return sha.toLowerCase();
}

/**
 * Rewrites the `SOURCE_COMMIT` constant in a `fetch-openapi.mjs`-shaped source string.
 * Pure -- no I/O -- directly unit-testable.
 * @param {string} content
 * @param {string} newSha
 * @returns {string}
 */
export function rewriteSourceCommitConstant(content, newSha) {
  if (!SOURCE_COMMIT_PATTERN.test(content)) {
    throw new Error(
      "[bump-openapi-pin] Could not find a \"const SOURCE_COMMIT = '...';\" assignment to rewrite"
    );
  }
  return content.replace(SOURCE_COMMIT_PATTERN, `const SOURCE_COMMIT = '${newSha}';`);
}

/**
 * Rewrites the `PINNED_DOCKHAND_OPENAPI_COMMIT` constant in a `pinned.ts`-shaped source
 * string. Pure -- no I/O.
 * @param {string} content
 * @param {string} newSha
 * @returns {string}
 */
export function rewritePinnedConstant(content, newSha) {
  if (!PINNED_CONSTANT_PATTERN.test(content)) {
    throw new Error(
      '[bump-openapi-pin] Could not find an ' +
        '"export const PINNED_DOCKHAND_OPENAPI_COMMIT = \'...\';" assignment to rewrite'
    );
  }
  return content.replace(
    PINNED_CONSTANT_PATTERN,
    `export const PINNED_DOCKHAND_OPENAPI_COMMIT = '${newSha}';`
  );
}

/**
 * Orchestrates the full bump decision: fetches the latest upstream `main` HEAD SHA,
 * compares it to the currently pinned SHA, and -- only if they differ -- rewrites BOTH
 * mirrored constants on disk. Makes no write at all when the SHAs already match. All I/O
 * is injectable so the decision logic is testable without touching the network or the
 * real filesystem.
 *
 * @param {object} opts
 * @param {string} opts.currentSha The currently pinned commit SHA.
 * @param {string} opts.fetchOpenapiPath Path to `scripts/fetch-openapi.mjs`.
 * @param {string} opts.pinnedTsPath Path to `src/openapi/pinned.ts`.
 * @param {() => Promise<string>} [opts.fetchLatestSha]
 * @param {(path: string, encoding: string) => string} [opts.readFile]
 * @param {(path: string, content: string, encoding: string) => void} [opts.writeFile]
 * @returns {Promise<{changed: boolean, previousSha: string, newSha: string}>}
 */
export async function bumpOpenapiPin({
  currentSha,
  fetchOpenapiPath,
  pinnedTsPath,
  fetchLatestSha = fetchLatestMainSha,
  readFile = readFileSync,
  writeFile = writeFileSync,
}) {
  const latestSha = await fetchLatestSha();

  if (latestSha === currentSha) {
    return { changed: false, previousSha: currentSha, newSha: currentSha };
  }

  const fetchOpenapiContent = readFile(fetchOpenapiPath, 'utf8');
  const pinnedTsContent = readFile(pinnedTsPath, 'utf8');

  writeFile(fetchOpenapiPath, rewriteSourceCommitConstant(fetchOpenapiContent, latestSha), 'utf8');
  writeFile(pinnedTsPath, rewritePinnedConstant(pinnedTsContent, latestSha), 'utf8');

  return { changed: true, previousSha: currentSha, newSha: latestSha };
}

async function main() {
  const fetchOpenapiPath = join(PROJECT_ROOT, 'scripts', 'fetch-openapi.mjs');
  const pinnedTsPath = join(PROJECT_ROOT, 'src', 'openapi', 'pinned.ts');

  const result = await bumpOpenapiPin({
    currentSha: SOURCE_COMMIT,
    fetchOpenapiPath,
    pinnedTsPath,
  });

  if (!result.changed) {
    console.error(
      `[bump-openapi-pin] NO CHANGE -- pin already at upstream Finsys/dockhand main HEAD (${result.previousSha})`
    );
  } else {
    console.error(`[bump-openapi-pin] CHANGED -- ${result.previousSha} -> ${result.newSha}`);
  }

  const githubOutputPath = process.env.GITHUB_OUTPUT;
  if (githubOutputPath) {
    appendFileSync(githubOutputPath, `changed=${result.changed}\n`, 'utf8');
    appendFileSync(githubOutputPath, `previous_sha=${result.previousSha}\n`, 'utf8');
    appendFileSync(githubOutputPath, `new_sha=${result.newSha}\n`, 'utf8');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
