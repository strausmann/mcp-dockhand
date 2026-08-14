import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import {
  findToJsonMethodDefinitions,
  findUnsafeResponseArguments,
} from '../scripts/lib/response-body-safety.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..', 'src');
const toolsDir = join(srcDir, 'tools');

/**
 * Recursively collects every `.ts` file under `dir` (skipping `.test.ts` files — this
 * guardrail cares about shipped code, not test fixtures).
 */
function walkTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Response-body safety guardrail — see `scripts/lib/response-body-safety.mjs` for the full
 * rationale. Ported from the Go `api-response-dto-boundary` leak class
 * (`.claude/rules/api-response-dto-boundary.md` in homelab-management) after a security audit
 * of this repo found NO active violation: this server has no DTO layer and no class anywhere
 * defines a custom `toJSON()` today (verified below, not assumed) — both guards are preventive,
 * so a future regression fails the build instead of reaching review.
 */
describe('Response-body safety guardrail', () => {
  describe('no toJSON() overrides anywhere under src/', () => {
    const files = walkTsFiles(srcDir);

    it('scans at least the known source files (sanity check the walker itself works)', () => {
      expect(files.length).toBeGreaterThan(20);
    });

    for (const file of files) {
      const rel = relative(join(__dirname, '..'), file);
      it(`${rel}: defines no toJSON() method`, () => {
        const content = readFileSync(file, 'utf-8');
        const hits = findToJsonMethodDefinitions(content);
        expect(
          hits,
          `${rel} defines toJSON() at line(s) ${hits.map((h) => h.line).join(', ')} ` +
            `(${hits.map((h) => JSON.stringify(h.snippet)).join(', ')}). ` +
            `A custom toJSON() lets JSON.stringify() silently emit more than a response ` +
            `handler intends — see .claude/rules/api-response-dto-boundary.md.`
        ).toEqual([]);
      });
    }
  });

  describe('no unsafe jsonResponse()/textResponse() arguments in src/tools/', () => {
    // Auto-derived from the directory listing (same pattern as tests/tool-registration.test.ts)
    // — a newly added tool file is covered automatically, nothing to register by hand.
    const files = readdirSync(toolsDir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => join(toolsDir, f));

    it('scans at least the known tool files (sanity check the walker itself works)', () => {
      expect(files.length).toBeGreaterThanOrEqual(20);
    });

    for (const file of files) {
      const rel = relative(join(__dirname, '..'), file);
      it(`${rel}: passes no domain-object argument to jsonResponse()/textResponse()`, () => {
        const content = readFileSync(file, 'utf-8');
        const violations = findUnsafeResponseArguments(content);
        expect(
          violations,
          violations
            .map(
              (v) =>
                `line ${v.line}: ${v.callee}(...) — ${v.reason}: ${v.detail}`
            )
            .join('\n')
        ).toEqual([]);
      });
    }
  });

  // --- Meta-tests: prove the detectors actually catch the shapes they claim to, and don't
  // flag the safe shapes this codebase actually uses (fixtures only — never real source). ---

  describe('findToJsonMethodDefinitions (meta-tests)', () => {
    it('flags a class method named toJSON', () => {
      const src = `
        export class Widget {
          toJSON() {
            return { ...this, secret: this.internalToken };
          }
        }
      `;
      expect(findToJsonMethodDefinitions(src)).toHaveLength(1);
    });

    it('flags a class-field arrow function named toJSON', () => {
      const src = `
        export class Widget {
          toJSON = () => ({ ...this });
        }
      `;
      expect(findToJsonMethodDefinitions(src)).toHaveLength(1);
    });

    it('flags an async class-field arrow function named toJSON', () => {
      const src = `
        export class Widget {
          toJSON = async () => ({ ...this });
        }
      `;
      expect(findToJsonMethodDefinitions(src)).toHaveLength(1);
    });

    it('does NOT flag a toJSON() call site (e.g. Date.prototype.toJSON)', () => {
      const src = `const generatedAt = new Date().toJSON();`;
      expect(findToJsonMethodDefinitions(src)).toEqual([]);
    });

    it('does NOT flag toJSON mentioned only inside a string or comment', () => {
      const src = `
        // Does NOT define toJSON() here, just talking about it.
        const note = 'call toJSON() on the result';
      `;
      expect(findToJsonMethodDefinitions(src)).toEqual([]);
    });
  });

  describe('findUnsafeResponseArguments (meta-tests)', () => {
    it('flags a directly constructed domain instance', () => {
      const src = `
        async () => {
          return jsonResponse(new SomeDomainClass());
        }
      `;
      const violations = findUnsafeResponseArguments(src);
      expect(violations).toHaveLength(1);
      expect(violations[0].reason).toBe('constructed-instance');
    });

    it('flags a domain instance nested inside an object literal field', () => {
      const src = `
        async () => {
          return jsonResponse({ status: 'ok', debug: new SomeDomainClass() });
        }
      `;
      const violations = findUnsafeResponseArguments(src);
      expect(violations).toHaveLength(1);
      expect(violations[0].reason).toBe('constructed-instance');
    });

    it('flags a domain instance passed indirectly via a local variable', () => {
      const src = `
        async () => {
          const summary = new SomeDomainClass();
          return jsonResponse(summary);
        }
      `;
      const violations = findUnsafeResponseArguments(src);
      expect(violations).toHaveLength(1);
      expect(violations[0].reason).toBe('constructed-instance-indirect');
    });

    it('flags the bare "client" identifier (the DockhandClient instance itself)', () => {
      const src = `
        async (server, client) => {
          return jsonResponse(client);
        }
      `;
      const violations = findUnsafeResponseArguments(src);
      expect(violations).toHaveLength(1);
      expect(violations[0].reason).toBe('forbidden-identifier');
      expect(violations[0].detail).toBe('client');
    });

    it('flags the bare "session" identifier', () => {
      const src = `textResponse(session);`;
      const violations = findUnsafeResponseArguments(src);
      expect(violations).toHaveLength(1);
      expect(violations[0].detail).toBe('session');
    });

    it('does NOT flag the real-world pass-through pattern (await client.get(...))', () => {
      const src = `
        registerTool(server, 'list_users', {}, async () => {
          return jsonResponse(await client.get('/api/users'));
        });
      `;
      expect(findUnsafeResponseArguments(src)).toEqual([]);
    });

    it('does NOT flag a plain object literal response', () => {
      const src = `return jsonResponse({ ok: true, id: userId });`;
      expect(findUnsafeResponseArguments(src)).toEqual([]);
    });

    it('does NOT flag an allow-listed built-in (Date) used inline', () => {
      const src = `return jsonResponse({ generatedAt: new Date().toISOString() });`;
      expect(findUnsafeResponseArguments(src)).toEqual([]);
    });

    it('does NOT flag a "client"/"session"-named field access, only the bare identifier', () => {
      const src = `return jsonResponse(result.client);`;
      expect(findUnsafeResponseArguments(src)).toEqual([]);
    });

    it('does NOT flag "new X(" appearing only inside a string literal', () => {
      const src = `return jsonResponse({ note: 'call new SomeDomainClass() yourself' });`;
      expect(findUnsafeResponseArguments(src)).toEqual([]);
    });

    it('does NOT flag "new X(" appearing only inside a comment', () => {
      const src = `
        // example: new SomeDomainClass() is what NOT to do here
        return jsonResponse({ ok: true });
      `;
      expect(findUnsafeResponseArguments(src)).toEqual([]);
    });

    it('does NOT flag an unrelated call with the same name as a forbidden identifier', () => {
      // "client" as an object field, not the bare argument itself.
      const src = `return jsonResponse({ client: 'chrome', ok: true });`;
      expect(findUnsafeResponseArguments(src)).toEqual([]);
    });
  });
});
