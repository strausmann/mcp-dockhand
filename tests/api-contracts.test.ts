import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describeTool } from '../src/openapi/describe-tool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const stacksSource = readFileSync(join(__dirname, '..', 'src', 'tools', 'stacks.ts'), 'utf-8');
const systemSource = readFileSync(join(__dirname, '..', 'src', 'tools', 'system.ts'), 'utf-8');
const usersSource = readFileSync(join(__dirname, '..', 'src', 'tools', 'users.ts'), 'utf-8');
const containersSource = readFileSync(join(__dirname, '..', 'src', 'tools', 'containers.ts'), 'utf-8');
const registriesSource = readFileSync(join(__dirname, '..', 'src', 'tools', 'registries.ts'), 'utf-8');
const imagesSource = readFileSync(join(__dirname, '..', 'src', 'tools', 'images.ts'), 'utf-8');
const dashboardSource = readFileSync(join(__dirname, '..', 'src', 'tools', 'dashboard.ts'), 'utf-8');
const gitStacksSource = readFileSync(join(__dirname, '..', 'src', 'tools', 'git-stacks.ts'), 'utf-8');
const volumesSource = readFileSync(join(__dirname, '..', 'src', 'tools', 'volumes.ts'), 'utf-8');

function extractToolBlock(source: string, toolName: string): string {
  const startPattern = new RegExp(
    `registerTool\\s*\\(\\s*server\\s*,\\s*'${toolName}'`,
  );
  const startMatch = startPattern.exec(source);
  if (!startMatch) {
    throw new Error(`Tool '${toolName}' not found in source`);
  }
  const startIdx = startMatch.index;
  const afterStart = source.slice(startIdx + 1);
  const nextToolMatch = /registerTool\s*\(/.exec(afterStart);
  const endIdx = nextToolMatch
    ? startIdx + 1 + nextToolMatch.index
    : source.length;
  return source.slice(startIdx, endIdx);
}

describe('Dockhand API contract alignment', () => {
  it('create_stack exposes and forwards composePath and envPath', () => {
    const block = extractToolBlock(stacksSource, 'create_stack');
    expect(block).toMatch(/composePath:\s*z\.string\(\)\.optional\(\)/);
    expect(block).toMatch(/envPath:\s*z\.string\(\)\.optional\(\)/);
    expect(block).toMatch(/body\.composePath\s*=\s*composePath/);
    expect(block).toMatch(/body\.envPath\s*=\s*envPath/);
  });

  it('adopt_stack sends environmentId and stacks[] with composePath in the body', () => {
    const block = extractToolBlock(stacksSource, 'adopt_stack');
    expect(block).toMatch(/composePath:\s*z\.string\(\)/);
    expect(block).toMatch(/envPath:\s*z\.string\(\)\.optional\(\)/);
    expect(block).toMatch(/sourceDir:\s*z\.string\(\)\.optional\(\)/);
    expect(block).toMatch(/environmentId,\s*\n\s*stacks:\s*\[stack\]/);
    expect(block).toMatch(/client\.post\('\/api\/stacks\/adopt'/);
    expect(block).not.toMatch(/\{\s*env:\s*environmentId\s*\}/);
  });

  it('relocate_stack sends oldDir, newComposePath and optional newEnvPath', () => {
    const block = extractToolBlock(stacksSource, 'relocate_stack');
    expect(block).toMatch(/oldDir:\s*z\.string\(\)/);
    expect(block).toMatch(/newComposePath:\s*z\.string\(\)/);
    expect(block).toMatch(/newEnvPath:\s*z\.string\(\)\.optional\(\)/);
    expect(block).toMatch(/\{\s*oldDir,\s*newComposePath\s*\}/);
    expect(block).toMatch(/body\.newEnvPath\s*=\s*newEnvPath/);
    expect(block).not.toMatch(/\{\s*path:\s*newPath\s*\}/);
  });

  it('stack path helpers include name and use newComposePath for path-change checks', () => {
    const hints = extractToolBlock(stacksSource, 'get_stack_path_hints');
    const defaultPath = extractToolBlock(stacksSource, 'get_stack_default_path');
    const check = extractToolBlock(stacksSource, 'check_stack_path_change');
    for (const block of [hints, defaultPath]) {
      expect(block).toMatch(/name:\s*z\.string\(\)/);
      expect(block).toMatch(/\{\s*env:\s*environmentId,\s*name\s*\}/);
    }
    expect(check).toMatch(/newComposePath:\s*z\.string\(\)/);
    expect(check).toMatch(/\{\s*newComposePath\s*\}/);
    expect(check).not.toMatch(/\{\s*path:\s*newPath\s*\}/);
  });

  it('get_system_disk is scoped to an environment', () => {
    const block = extractToolBlock(systemSource, 'get_system_disk');
    expect(block).toMatch(/environmentId:\s*z\.number\(\)/);
    expect(block).toMatch(/client\.get\('\/api\/system\/disk',\s*\{\s*env:\s*environmentId\s*\}\)/);
  });

  it('favorites and favorite groups are environment-scoped reorder operations', () => {
    const getFavorites = extractToolBlock(usersSource, 'get_favorites');
    const setFavorites = extractToolBlock(usersSource, 'set_favorites');
    const getGroups = extractToolBlock(usersSource, 'get_favorite_groups');
    const setGroups = extractToolBlock(usersSource, 'set_favorite_groups');

    for (const block of [getFavorites, getGroups]) {
      expect(block).toMatch(/environmentId:\s*z\.number\(\)/);
      expect(block).toMatch(/\{\s*env:\s*environmentId\s*\}/);
    }
    expect(setFavorites).toMatch(/environmentId,\s*\n\s*action:\s*'reorder',\s*\n\s*favorites/);
    expect(setGroups).toMatch(/environmentId,\s*\n\s*action:\s*'reorder',\s*\n\s*groups/);
  });

  it('exec_container matches the real /api/containers/{id}/exec contract: envId query param, shell+user body only', () => {
    // Ground truth (Finsys/dockhand src/routes/api/containers/[id]/exec/+server.ts, unchanged
    // since the route's initial commit through v1.0.41): the handler reads `envId` from the
    // query string (not `env`, unlike every sibling containers endpoint), and only reads
    // `body.shell` (default '/bin/sh') and `body.user` (default 'root') — it creates a Docker
    // exec instance for WebSocket terminal attachment and returns { execId, connectionInfo }.
    // It never reads body.command/workingDir/tty and never executes or captures output for an
    // arbitrary command — there is no REST endpoint upstream that does that (see issue #81).
    const block = extractToolBlock(containersSource, 'exec_container');

    // Query param must be envId, not env (the one endpoint in the cluster that differs).
    expect(block).toMatch(/\{\s*envId:\s*environmentId\s*\}/);
    expect(block).not.toMatch(/\{\s*env:\s*environmentId\s*\}/);

    // Only fields the real handler reads may be sent.
    expect(block).toMatch(/shell:\s*z\.string\(\)\.optional\(\)/);
    expect(block).toMatch(/user:\s*z\.string\(\)\.optional\(\)/);
    expect(block).not.toMatch(/command:\s*z\.array/);
    expect(block).not.toMatch(/workingDir:\s*z\.string/);
    expect(block).not.toMatch(/tty:\s*z\.boolean/);
    expect(block).not.toMatch(/body\.command/);
    expect(block).not.toMatch(/body\.workingDir/);
    expect(block).not.toMatch(/body\.tty/);

    // Description (derived from the spec — P3 Task 5, no hand-written literal here
    // anymore, see src/openapi/describe-tool.ts) must not promise one-shot command
    // execution/output the API cannot deliver. The real spec summary
    // (docs/dockhand-openapi.json `/api/containers/{id}/exec` POST) frames this
    // correctly as creating an exec instance for a terminal WebSocket, not running a
    // command and returning its output — assert that framing survives derivation.
    const description = describeTool('exec_container');
    expect(description).not.toMatch(/Execute a one-shot command/i);
    expect(description).toMatch(/websocket|terminal/i);
  });

  it('search_registry matches the real /api/registry/search contract: term (required), limit + registry (optional), no env', () => {
    // Ground truth (Finsys/dockhand src/routes/api/registry/search/+server.ts, v1.0.40):
    // `export const GET: RequestHandler = async ({ url }) => { const term = url.searchParams.get('term');
    // const limit = parseInt(url.searchParams.get('limit') || '25', 10); const registryId =
    // url.searchParams.get('registry'); if (!term) return json({ error: 'Search term is required' }, { status: 400 }); }`
    // The handler never reads `q` or `env` at all — this endpoint has no environment concept
    // (it searches a registry, not a Docker host). The old tool sent { q: query, env: environmentId },
    // which the real handler ignores entirely, so `!term` always fired the 400 in production.
    const block = extractToolBlock(registriesSource, 'search_registry');

    expect(block).toMatch(/term:\s*z\.string\(\)/);
    expect(block).toMatch(/limit:\s*z\.number\(\)\.optional\(\)/);
    expect(block).toMatch(/registry:\s*z\.number\(\)\.optional\(\)/);
    expect(block).toMatch(/client\.get\('\/api\/registry\/search'/);
    expect(block).not.toMatch(/\bq:\s*query\b/);
    expect(block).not.toMatch(/\benv:\s*environmentId\b/);
  });

  it('get_registry_catalog matches the real /api/registry/catalog contract: registry (required), last (optional), no env', () => {
    // Ground truth (Finsys/dockhand src/routes/api/registry/catalog/+server.ts, commit
    // 905c4a0): `export const GET: RequestHandler = async ({ url }) => { const registryId =
    // url.searchParams.get('registry'); const lastParam = url.searchParams.get('last'); //
    // For pagination if (!registryId) { return json({ error: 'Registry ID is required' },
    // { status: 400 }); } ... }`. The handler never reads `env`/`environmentId` at all —
    // registries are global, not per-environment. The old tool sent
    // `environmentId ? { env: environmentId } : undefined`, which the real handler ignores
    // entirely AND never sent `registry` — every call 400ed with "Registry ID is required".
    // (Found via the required/optional-aware query-param check, mcp-dockhand#148.)
    const block = extractToolBlock(registriesSource, 'get_registry_catalog');

    expect(block).toMatch(/registry:\s*z\.number\(\)/);
    expect(block).toMatch(/last:\s*z\.string\(\)\.optional\(\)/);
    expect(block).toMatch(/client\.get\('\/api\/registry\/catalog'/);
    expect(block).not.toMatch(/environmentId/);
    expect(block).not.toMatch(/\benv:\s*environmentId\b/);
  });

  it('write_system_file sends path in the POST body, not as a query param (real endpoint only creates a directory)', () => {
    // Ground truth (Finsys/dockhand src/routes/api/system/files/+server.ts, commit 905c4a0):
    // `export const POST: RequestHandler = async ({ request, cookies }) => { const body = await
    // request.json(); const path = body.path; if (!path || typeof path !== 'string') return
    // json({ error: 'Path is required' }, { status: 400 }); ... mkdirSync(path, { recursive:
    // true }); return json({ success: true, path }); }`. The handler reads `path` exclusively
    // from the parsed JSON body — it never touches `url.searchParams` at all. The old tool sent
    // `client.post('/api/system/files', { content }, { path })`: `path` went out as a query
    // param the handler never reads, so `body.path` was always undefined and every call 400ed
    // with "Path is required". The handler also never reads `content` from anywhere — this
    // endpoint creates an (empty) directory, it does not write file content.
    const block = extractToolBlock(systemSource, 'write_system_file');

    expect(block).toMatch(/path:\s*z\.string\(\)/);
    expect(block).toMatch(/client\.post\('\/api\/system\/files',\s*\{\s*path\s*\}\)/);
    expect(block).not.toMatch(/content:\s*z\.string\(\)/);
  });

  it('list_image_scans matches the real GET /api/images/scan contract: image (required), env + scanner (optional)', () => {
    // Ground truth (Finsys/dockhand src/routes/api/images/scan/+server.ts, commit 905c4a0):
    // `export const GET: RequestHandler = async ({ url, cookies }) => { const imageName =
    // url.searchParams.get('image'); const envIdParam = url.searchParams.get('env'); const
    // scanner = url.searchParams.get('scanner') as 'grype' | 'trivy' | undefined; ... if
    // (!imageName) return json({ error: 'Image name is required' }, { status: 400 }); ... }`.
    // This is a single-image cached-result lookup (returns { found, result }), not a listing
    // across the whole environment. The old tool only sent `env` and never `image` — every call
    // 400ed with "Image name is required".
    const block = extractToolBlock(imagesSource, 'list_image_scans');

    expect(block).toMatch(/image:\s*z\.string\(\)/);
    expect(block).toMatch(/environmentId:\s*z\.number\(\)\.optional\(\)/);
    expect(block).toMatch(/client\.get\('\/api\/images\/scan',\s*query\)/);
    expect(block).toMatch(/\{\s*image\s*\}/);
    expect(block).toMatch(/query\.env\s*=\s*environmentId/);
  });

  it('reset_scanner_settings matches the real DELETE /api/settings/scanner contract: env + removeImages (required), scanner (optional)', () => {
    // Ground truth (Finsys/dockhand src/routes/api/settings/scanner/+server.ts, commit
    // 905c4a0): `export const DELETE: RequestHandler = async ({ url, cookies }) => { const
    // removeImagesFlag = url.searchParams.get('removeImages') === 'true'; const scanner =
    // url.searchParams.get('scanner'); const envId = url.searchParams.get('env'); ... if
    // (!removeImagesFlag) return json({ error: 'removeImages parameter required' }, { status:
    // 400 }); if (!parsedEnvId) return json({ error: 'Environment ID required' }, { status: 400
    // }); ... }`. The old tool called `client.delete('/api/settings/scanner')` with an empty
    // input schema — no query params at all — so every call 400ed on the very first guard
    // ("removeImages parameter required").
    const block = extractToolBlock(systemSource, 'reset_scanner_settings');

    expect(block).toMatch(/environmentId:\s*z\.number\(\)/);
    expect(block).toMatch(/removeImages:\s*z\.boolean\(\)/);
    expect(block).toMatch(/scanner:\s*z\.enum\(\[['"]grype['"],\s*['"]trivy['"]\]\)\.optional\(\)/);
    expect(block).toMatch(/client\.delete\('\/api\/settings\/scanner'/);
    expect(block).toMatch(/env:\s*environmentId/);
    expect(block).toMatch(/removeImages\s*=\s*['"]true['"]/);
  });

  it('delete_user forwards confirmDisableAuth as a query param (conditionally required on the last-admin path)', () => {
    // Ground truth (Finsys/dockhand src/routes/api/users/[id]/+server.ts, commit 905c4a0):
    // `export const DELETE: RequestHandler = async (event) => { ... const confirmDisableAuth =
    // url.searchParams.get('confirmDisableAuth') === 'true'; ... if (auth.authEnabled &&
    // userIsAdmin) { const adminCount = await countAdminUsers(); if (adminCount <= 1) { if
    // (!confirmDisableAuth) return json({ error: 'This is the last admin user', isLastAdmin:
    // true, ... }, { status: 409 }); ... } } ... }`. Deleting a non-last-admin user works
    // without it; deleting the sole remaining admin 409s unless `confirmDisableAuth=true` is
    // sent. The old tool never sent this param at all, so that path could never be confirmed.
    const block = extractToolBlock(usersSource, 'delete_user');

    expect(block).toMatch(/confirmDisableAuth:\s*z\.boolean\(\)\.optional\(\)/);
    expect(block).toMatch(/confirmDisableAuth\s*=\s*['"]true['"]/);
    expect(block).toMatch(/client\.delete\(`\/api\/users\/\$\{encodePath\(userId\)\}`/);
  });

  it('clear_activity matches the real DELETE /api/activity contract: no query params, clears globally', () => {
    // Ground truth (Finsys/dockhand src/routes/api/activity/+server.ts, commit 905c4a0):
    // `export const DELETE: RequestHandler = async ({ cookies }) => { const auth = await
    // authorize(cookies); if (auth.authEnabled && !await auth.can('activity', 'delete')) return
    // json({ error: 'Permission denied' }, { status: 403 }); try { await clearContainerEvents();
    // return json({ success: true }); } ... }`. The handler destructures only `{ cookies }` —
    // it never reads `url.searchParams` at all, so there is no environment scoping: a DELETE
    // always clears the ENTIRE activity log. The old tool sent a required `environmentId` as
    // `{ environmentId }` in the query string, which the real handler silently ignores.
    const block = extractToolBlock(dashboardSource, 'clear_activity');

    expect(block).toMatch(/client\.delete\('\/api\/activity'\)/);
    expect(block).not.toMatch(/environmentId/);
  });

  it('trigger_git_webhook uses the real GET manual-trigger path with a `secret` query param, not POST+token', () => {
    // Ground truth (Finsys/dockhand src/routes/api/git/stacks/[id]/webhook/+server.ts, commit
    // 905c4a0): the POST handler is reserved for GitHub/GitLab's own webhook calls — it verifies
    // an HMAC signature read from the `x-hub-signature-256`/`x-gitlab-token` REQUEST HEADERS
    // (`verifyWebhookSignature(payload, signature, gitStack.webhookSecret)`) and never reads any
    // query param at all, so the old tool's `{ token }` query param on POST was always ignored —
    // signature verification failed and every call 401ed. The handler also explicitly documents
    // a GET path for this: `// Also support GET for simple polling/manual triggers` — `export
    // const GET: RequestHandler = async (event) => { ... const secret =
    // url.searchParams.get('secret'); if (secret !== gitStack.webhookSecret) return json({
    // error: 'Invalid webhook secret' }, { status: 401 }); ... deployGitStack(id, { force: false
    // }); ... }`. That GET+`secret` path is the correct, real manual-trigger contract.
    const block = extractToolBlock(gitStacksSource, 'trigger_git_webhook');

    expect(block).toMatch(/secret:\s*z\.string\(\)/);
    expect(block).toMatch(/client\.get\(`\/api\/git\/stacks\/\$\{encodePath\(stackId\)\}\/webhook`,\s*\{\s*secret\s*\}\)/);
    expect(block).not.toMatch(/client\.post\(`\/api\/git\/stacks/);
    expect(block).not.toMatch(/\btoken\b/);
  });

  it('clone_volume sends the source volume clone target as body.name (required), not optional body.newName', () => {
    // Ground truth (Finsys/dockhand src/routes/api/volumes/[name]/clone/+server.ts, v1.0.41):
    // `const body = await request.json(); const newName = body.name; if (!newName) return
    // json({ error: 'New volume name is required' }, { status: 400 });`. The handler reads the
    // target name exclusively from `body.name` and always requires it — there is no `newName`
    // field anywhere in the handler. The old tool sent an optional `newName` field, which the
    // real handler never reads, so `body.name` was always undefined and every call 400ed with
    // "New volume name is required" (mcp-dockhand#167).
    const block = extractToolBlock(volumesSource, 'clone_volume');

    expect(block).toMatch(/name:\s*z\.string\(\)/);
    expect(block).not.toMatch(/newName/);
    expect(block).toMatch(/\{\s*name\s*\}/);
  });

  it('create_git_repository sends name as a required body field, not just url', () => {
    // Ground truth (Finsys/dockhand src/routes/api/git/repositories/+server.ts, v1.0.41):
    // `const data = await request.json(); if (!data.name || typeof data.name !== 'string')
    // return json({ error: 'Name is required' }, { status: 400 }); if (!data.url || typeof
    // data.url !== 'string') return json({ error: 'Repository URL is required' }, { status:
    // 400 });`. Both `name` and `url` are required; `branch`/`credentialId` are optional
    // (`data.branch || 'main'`, `data.credentialId || null`). The old tool's zod schema never
    // included `name` at all, so it could never be sent — every call 400ed with "Name is
    // required" before `url` was even checked (mcp-dockhand#167).
    const block = extractToolBlock(gitStacksSource, 'create_git_repository');

    expect(block).toMatch(/name:\s*z\.string\(\)(?!\.optional)/);
    expect(block).toMatch(/url:\s*z\.string\(\)(?!\.optional)/);
    expect(block).toMatch(/\{\s*name,\s*url\s*\}/);
  });

  it('push_image sends imageId and registryId as required body fields, not just image', () => {
    // Ground truth (Finsys/dockhand src/routes/api/images/push/+server.ts, v1.0.41): `const {
    // imageId, imageName, registryId, newTag } = await request.json(); if (!imageId ||
    // !registryId) return json({ error: 'Image ID and registry ID are required' }, { status:
    // 400 });`. The handler never reads `image` at all — it needs the local image ID plus the
    // target registry ID; `imageName` (fallback source tag) and `newTag` (custom target tag)
    // are optional. The old tool sent only `{ image }`, a field the real handler never reads —
    // every call 400ed with "Image ID and registry ID are required" (mcp-dockhand#167).
    const block = extractToolBlock(imagesSource, 'push_image');

    expect(block).toMatch(/imageId:\s*z\.string\(\)(?!\.optional)/);
    expect(block).toMatch(/registryId:\s*z\.number\(\)(?!\.optional)/);
    expect(block).not.toMatch(/\bimage:\s*z\.string\(\)/);
    expect(block).toMatch(/imageId,\s*\n?\s*registryId/);
  });

  it('scan_image sends imageName as the required body field, not imageId', () => {
    // Ground truth (Finsys/dockhand src/routes/api/images/scan/+server.ts, v1.0.41): `const
    // body = await request.json(); const { imageName, scanner: forceScannerType } = body; if
    // (!imageName) return json({ error: 'Image name is required' }, { status: 400 });`. The
    // handler reads `imageName` (a name/reference, not a Docker image ID) and an optional
    // `scanner` override — it never reads `imageId`. The old tool sent `{ imageId }`, which the
    // real handler ignores entirely — every call 400ed with "Image name is required"
    // (mcp-dockhand#167).
    const block = extractToolBlock(imagesSource, 'scan_image');

    expect(block).toMatch(/imageName:\s*z\.string\(\)(?!\.optional)/);
    expect(block).not.toMatch(/imageId:\s*z\.string\(\)/);
    expect(block).toMatch(/\{\s*imageName/);
  });

  it('request_git_preview_env sends composePath plus repositoryId/url, not an empty body', () => {
    // Ground truth (Finsys/dockhand src/routes/api/git/preview-env/+server.ts, v1.0.41): `const
    // data = await request.json(); if (!data.composePath || typeof data.composePath !==
    // 'string') return json({ error: 'Compose path is required' }, { status: 400 }); ... if
    // (data.repositoryId) { ... } else if (data.url) { ... } else { return json({ error:
    // 'Either repositoryId or url is required' }, { status: 400 }); }`. `composePath` is always
    // required, and either `repositoryId` (existing repo) or `url` (new repo) must be given;
    // `branch`, `credentialId`, `envFilePath` are optional. The old tool's input schema was
    // empty (`{}`) and sent no body at all — every call 400ed with "Compose path is required"
    // (mcp-dockhand#167).
    const block = extractToolBlock(gitStacksSource, 'request_git_preview_env');

    expect(block).toMatch(/composePath:\s*z\.string\(\)(?!\.optional)/);
    expect(block).toMatch(/repositoryId:\s*z\.number\(\)\.optional\(\)/);
    expect(block).toMatch(/url:\s*z\.string\(\)\.optional\(\)/);
    expect(block).toMatch(/client\.post\('\/api\/git\/preview-env',\s*body\)/);
    expect(block).not.toMatch(/client\.post\('\/api\/git\/preview-env'\)/);
  });
});

describe('Dockhand 1.0.42 contract additions', () => {
  // Verified against the 1.0.42 handlers, not inferred from the changelog:
  //   src/routes/api/stacks/+server.ts            -> body destructures `secretProviderId`
  //   src/routes/api/stacks/[name]/compose/+server.ts -> same field on PUT
  //   src/routes/api/users/[id]/mfa/+server.ts    -> rejects any action != setup|verify
  it('create_stack offers and forwards secretProviderId', () => {
    const block = extractToolBlock(stacksSource, 'create_stack');

    expect(block).toMatch(/secretProviderId:\s*z\.number\(\)\.optional\(\)/);
    expect(block).toMatch(/body\.secretProviderId\s*=\s*secretProviderId/);
    // Only when the caller supplied it — sending `undefined` would be a body field
    // the endpoint sees as present-but-empty.
    expect(block).toMatch(/if \(secretProviderId !== undefined\)/);
  });

  it('update_stack_compose offers and forwards secretProviderId', () => {
    const block = extractToolBlock(stacksSource, 'update_stack_compose');

    expect(block).toMatch(/secretProviderId:\s*z\.number\(\)\.optional\(\)/);
    expect(block).toMatch(/body\.secretProviderId\s*=\s*secretProviderId/);
  });

  it('enable_user_mfa always sends an explicit action and can reach the verify path', () => {
    const block = extractToolBlock(usersSource, 'enable_user_mfa');

    // The contract marks `action` required; a default keeps the tool call
    // backward-compatible while still putting the field on the wire every time.
    expect(block).toMatch(/action:\s*z\.enum\(\['setup', 'verify'\]\)\.default\('setup'\)/);
    expect(block).toMatch(/const body: Record<string, unknown> = \{ action \}/);
    // `verify` needs the code, so the tool has to be able to carry it.
    expect(block).toMatch(/token:\s*z\.string\(\)\.optional\(\)/);
    // Regression: the pre-1.0.42 tool posted with no body at all.
    expect(block).not.toMatch(/client\.post\(`\/api\/users\/\$\{encodePath\(userId\)\}\/mfa`\)/);
  });
});
