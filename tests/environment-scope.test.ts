import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Static analysis: if a tool declares environmentId as a required parameter,
 * its handler must pass it to the API (via { env: environmentId } or similar).
 *
 * This catches bugs where environmentId is declared in the schema but never
 * sent to the Dockhand API, which would cause incorrect results.
 */
describe('Environment scope consistency', () => {
  const toolsDir = join(__dirname, '..', 'src', 'tools');
  const toolFiles = readdirSync(toolsDir).filter(
    (f) => f.endsWith('.ts') && f !== 'index.ts'
  );

  for (const file of toolFiles) {
    const content = readFileSync(join(toolsDir, file), 'utf-8');

    // Find each registerTool block with environmentId
    // We use a simplified heuristic: for each registerTool call that
    // has environmentId in its schema, check the handler body passes env
    const toolBlocks = content.split(/registerTool\(server,\s*'/);

    for (const block of toolBlocks.slice(1)) {
      const toolName = block.match(/^([^']+)/)?.[1] ?? 'unknown';
      const hasRequiredEnvId =
        block.includes('environmentId: z.number().describe(') &&
        !block.includes('environmentId: z.number().optional()');

      if (!hasRequiredEnvId) continue;

      it(`${file} -> ${toolName}: required environmentId should be passed as env parameter`, () => {
        // The handler portion comes after the schema definition
        // Look for env: environmentId or { env: environmentId } patterns
        // within a reasonable distance after the schema
        const handlerMatch = block.match(/async\s*\(\s*\{[^}]*environmentId[^}]*\}\s*\)\s*=>\s*\{([\s\S]*?)(?=registerTool\(server|$)/);

        if (handlerMatch) {
          const handlerBody = handlerMatch[1]!;
          // Verify environmentId is actually used in the handler body,
          // not just destructured. Check for specific usage patterns:
          const passesEnv =
            // Passed as env parameter: { env: environmentId }
            /env:\s*environmentId/.test(handlerBody) ||
            // Passed as named property: { environmentId: environmentId } or shorthand { environmentId }
            /\benvironmentId\b/.test(handlerBody) && (
              // Used in template literal: `.../${encodePath(environmentId)}`
              /encodePath\(environmentId\)/.test(handlerBody) ||
              /\$\{environmentId\}/.test(handlerBody) ||
              // Used in object literal (shorthand or explicit)
              /\{\s*[^}]*\benvironmentId\b[^}]*\}/.test(handlerBody) ||
              // Used as query/body parameter
              /params.*environmentId|body.*environmentId/.test(handlerBody)
            );

          expect(
            passesEnv,
            `Tool '${toolName}' in ${file} declares required environmentId but handler may not pass it to the API`
          ).toBe(true);
        }
      });
    }
  }
});
