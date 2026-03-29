import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Path parameter encoding (static analysis)', () => {
  const toolsDir = join(__dirname, '..', 'src', 'tools');
  const toolFiles = readdirSync(toolsDir).filter(
    (f) => f.endsWith('.ts') && f !== 'index.ts'
  );

  // Sanity check: we should have tool files to test
  it('should find tool files to analyze', () => {
    expect(toolFiles.length).toBeGreaterThan(0);
  });

  for (const file of toolFiles) {
    it(`${file}: all path interpolations in API URLs should use encodePath()`, () => {
      const content = readFileSync(join(toolsDir, file), 'utf-8');

      // Find template literals that are API paths (start with /api/)
      const apiPathRegex = /`\/api\/[^`]*\$\{[^}]+\}[^`]*`/g;
      const apiPaths = content.match(apiPathRegex) || [];

      for (const path of apiPaths) {
        // Extract all ${...} interpolations within this API path
        const interpolationRegex = /\$\{([^}]+)\}/g;
        let match;
        while ((match = interpolationRegex.exec(path)) !== null) {
          const interpolation = match[1]!.trim();
          expect(
            interpolation,
            `In ${file}: \${${interpolation}} in API path must use encodePath(). Found in: ${path}`
          ).toMatch(/encodePath/);
        }
      }
    });
  }

  for (const file of toolFiles) {
    it(`${file}: should import encodePath if API paths use interpolation`, () => {
      const content = readFileSync(join(toolsDir, file), 'utf-8');
      const hasInterpolatedApiPaths = /`\/api\/[^`]*\$\{[^}]+\}[^`]*`/.test(content);

      if (hasInterpolatedApiPaths) {
        expect(
          content,
          `${file} has API path interpolations but does not import encodePath`
        ).toContain("import { encodePath }");
      }
    });
  }
});
