import { describe, it, expect } from 'vitest';
import { needsWrite, stableStringify } from '../scripts/fetch-openapi.mjs';

/**
 * fetch-openapi.mjs kopiert die generierte Dockhand-openapi.json nur, wenn sich der
 * Contract inhaltlich geändert hat -- sonst würde ein Cron-artiger Sync-Lauf jedes Mal
 * einen Leer-Commit erzeugen, obwohl sich nichts geändert hat (gleiches Muster wie
 * stripTimestamp() in generate-coverage-doc.mjs). Diese Tests decken ausschließlich die
 * dafür genutzte reine Vergleichslogik ab (needsWrite/stableStringify) -- das eigentliche
 * main() macht Netzwerk-/Prozess-I/O (git fetch, npm install, tsx) gegen den echten
 * Quell-Klon und wird deshalb nicht hier, sondern durch den realen Lauf verifiziert.
 */

const fixtureSpec = {
  openapi: '3.0.0',
  info: { title: 'Dockhand API', version: '1.0.41' },
  paths: {
    '/api/stacks': {
      post: {
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  compose: { type: 'string' },
                },
                required: ['name', 'compose'],
              },
            },
          },
        },
      },
    },
  },
};

describe('needsWrite (No-op-Schutz)', () => {
  it('reports no write needed when the existing file already matches the new spec', () => {
    const existingRaw = JSON.stringify(fixtureSpec);
    expect(needsWrite(existingRaw, fixtureSpec)).toBe(false);
  });

  it('ignores a top-level generatedAt field when comparing', () => {
    const existingRaw = JSON.stringify({ ...fixtureSpec, generatedAt: '2026-08-09T00:00:00.000Z' });
    const newSpec = { ...fixtureSpec, generatedAt: '2026-08-10T05:00:00.000Z' };

    expect(needsWrite(existingRaw, newSpec)).toBe(false);
  });

  it('detects a real contract change (a required field dropped from the schema)', () => {
    const existingRaw = JSON.stringify(fixtureSpec);
    const changedSpec = structuredClone(fixtureSpec);
    changedSpec.paths['/api/stacks'].post.requestBody.content['application/json'].schema.required = [
      'name',
    ];

    expect(needsWrite(existingRaw, changedSpec)).toBe(true);
  });

  it('always writes when no output file exists yet', () => {
    expect(needsWrite(null, fixtureSpec)).toBe(true);
  });

  it('writes when the existing file is corrupt JSON rather than guessing', () => {
    expect(needsWrite('{ not valid json', fixtureSpec)).toBe(true);
  });
});

describe('stableStringify', () => {
  it('produces identical output for specs that only differ in generatedAt', () => {
    const a = stableStringify({ ...fixtureSpec, generatedAt: '2026-08-09T00:00:00.000Z' });
    const b = stableStringify({ ...fixtureSpec, generatedAt: '2026-08-10T05:00:00.000Z' });

    expect(a).toBe(b);
  });

  it('produces different output when the actual paths content differs', () => {
    const a = stableStringify(fixtureSpec);
    const changed = structuredClone(fixtureSpec);
    // requestBody is required in the fixture's inferred literal type, but genuinely
    // optional on a real OpenAPI operation object -- this narrows just enough at the
    // delete site to express that without loosening `changed`'s type everywhere else.
    delete (changed.paths['/api/stacks'].post as { requestBody?: unknown }).requestBody;
    const b = stableStringify(changed);

    expect(a).not.toBe(b);
  });
});
