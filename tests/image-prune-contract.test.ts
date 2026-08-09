import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, '..', 'src', 'tools', 'environments.ts'), 'utf-8');

function extractToolBlock(toolName: string): string {
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

describe('image prune API contract', () => {
  it('set_environment_image_prune uses POST for settings and not PUT', () => {
    const block = extractToolBlock('set_environment_image_prune');
    expect(block).toContain('return jsonResponse(await client.post(`/api/environments/${encodePath(environmentId)}/image-prune`, settings));');
    expect(block).not.toContain('return jsonResponse(await client.put(`/api/environments/${encodePath(environmentId)}/image-prune`, settings));');
  });

  it('trigger_environment_image_prune uses PUT for immediate prune and not POST', () => {
    const block = extractToolBlock('trigger_environment_image_prune');
    expect(block).toContain('return jsonResponse(await client.put(`/api/environments/${encodePath(environmentId)}/image-prune`, undefined));');
    expect(block).not.toContain('return jsonResponse(await client.post(`/api/environments/${encodePath(environmentId)}/image-prune`, undefined));');
  });
});
