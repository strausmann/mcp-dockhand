import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Static analysis test: verifies that all tool files are imported and registered
 * in the central tools/index.ts registry, and that tool names are unique.
 */
describe('Tool registration completeness', () => {
  const toolsDir = join(__dirname, '..', 'src', 'tools');
  const indexContent = readFileSync(join(toolsDir, 'index.ts'), 'utf-8');

  // Get all tool module files (excluding index.ts)
  const toolModules = readdirSync(toolsDir).filter(
    (f) => f.endsWith('.ts') && f !== 'index.ts'
  );

  it('should have tool modules to register', () => {
    expect(toolModules.length).toBeGreaterThan(0);
  });

  for (const file of toolModules) {
    const moduleName = file.replace('.ts', '');

    it(`${file}: should be imported in tools/index.ts`, () => {
      // Check for import statement referencing this module
      expect(
        indexContent,
        `${file} is not imported in tools/index.ts`
      ).toContain(`./${moduleName}.js`);
    });

    it(`${file}: should have its register function called in registerAllTools()`, () => {
      // Convention: each module exports register<Category>Tools
      // Derive the expected function name from the import path in index.ts
      const importRegex = new RegExp(
        `import\\s*\\{\\s*(register\\w+Tools)\\s*\\}\\s*from\\s*['\\./"]*${moduleName}\\.js['"]`
      );
      const importMatch = indexContent.match(importRegex);
      expect(
        importMatch,
        `No import found for module ${moduleName} in tools/index.ts`
      ).not.toBeNull();

      const registerFnName = importMatch![1]!;
      const callRegex = new RegExp(`${registerFnName}\\(server, client\\)`);
      expect(
        indexContent,
        `Function ${registerFnName} not called for ${file} in tools/index.ts`
      ).toMatch(callRegex);
    });
  }

  it('should have unique tool names across all modules', () => {
    const toolNames: string[] = [];
    const duplicates: string[] = [];

    for (const file of toolModules) {
      const content = readFileSync(join(toolsDir, file), 'utf-8');
      const nameRegex = /registerTool\(server,\s*'([^']+)'/g;
      let match;
      while ((match = nameRegex.exec(content)) !== null) {
        const name = match[1]!;
        if (toolNames.includes(name)) {
          duplicates.push(name);
        }
        toolNames.push(name);
      }
    }

    expect(
      duplicates,
      `Duplicate tool names found: ${duplicates.join(', ')}`
    ).toHaveLength(0);
  });

  it('should register at least 130 tools (as documented)', () => {
    let totalTools = 0;
    for (const file of toolModules) {
      const content = readFileSync(join(toolsDir, file), 'utf-8');
      const matches = content.match(/registerTool\(/g);
      totalTools += matches ? matches.length : 0;
    }

    expect(totalTools).toBeGreaterThanOrEqual(130);
  });

  it('tools/index.ts registerAllTools should call all 16 register functions', () => {
    // Count unique register*Tools calls inside registerAllTools
    const registerCalls = indexContent.match(/register\w+Tools\(server, client\)/g) || [];
    expect(registerCalls.length).toBe(toolModules.length);
  });
});
