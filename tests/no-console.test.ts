/**
 * console.error was the only output channel this server had — 30-odd call sites, all
 * at the same effective level. Once they are gone, the way they come back is one new
 * line in one new file, which no diff-scoped review would flag as a problem.
 *
 * So the rule gets a test rather than a convention.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = new URL('../src', import.meta.url).pathname;

/**
 * logger.ts may not use itself before it exists, so its own bootstrap is the one
 * place a direct console call is legitimate. Keep this list at one entry.
 */
const ALLOWED = new Set(['utils/logger.ts']);

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

describe('logging discipline', () => {
  const files = tsFiles(SRC);

  it('finds the source tree (guards against the scan matching nothing)', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('has no console.* call outside the logger bootstrap', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const rel = relative(SRC, file);
      if (ALLOWED.has(rel)) continue;

      readFileSync(file, 'utf-8')
        .split('\n')
        .forEach((line, index) => {
          // Skip comment lines: several files legitimately DISCUSS console.error in
          // their doc comments (src/utils/redact.ts explains which surfaces an error
          // message reaches). Matching those would force prose changes to satisfy a
          // code rule.
          const trimmed = line.trim();
          if (trimmed.startsWith('*') || trimmed.startsWith('//')) return;
          if (/\bconsole\.\w+\s*\(/.test(line)) {
            offenders.push(`${rel}:${index + 1}`);
          }
        });
    }

    expect(offenders).toEqual([]);
  });
});
