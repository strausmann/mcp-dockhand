import { describe, it, expect } from 'vitest';
import { checkCrossRefs, extractCrossRefsFromOperation } from '../scripts/lib/crossref-checks.mjs';

describe('checkCrossRefs (P3 Task 6, advisory)', () => {
  it('meldet CROSSREF_UNRESOLVED fuer einen Verweis ohne Tool', () => {
    const findings = checkCrossRefs(
      [{ tool: 'create_git_stack', refs: [{ method: 'GET', path: '/api/nonexistent' }] }],
      () => undefined
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('CROSSREF_UNRESOLVED');
  });

  it('meldet NICHTS fuer aufloesbare Verweise', () => {
    const findings = checkCrossRefs(
      [{ tool: 'create_git_stack', refs: [{ method: 'GET', path: '/api/environments' }] }],
      (m, p) => (p === '/api/environments' ? 'list_environments' : undefined)
    );
    expect(findings).toHaveLength(0);
  });

  it('traegt den anfragenden Tool-Namen sowie Ziel-Methode/-Pfad in das Finding ein', () => {
    const findings = checkCrossRefs(
      [{ tool: 'create_git_stack', refs: [{ method: 'GET', path: '/api/nonexistent' }] }],
      () => undefined
    );
    expect(findings[0]).toMatchObject({
      type: 'CROSSREF_UNRESOLVED',
      tool: 'create_git_stack',
      method: 'GET',
      path: '/api/nonexistent',
    });
  });

  it('prueft mehrere Refs pro Eintrag unabhaengig voneinander', () => {
    const findings = checkCrossRefs(
      [
        {
          tool: 'create_git_stack',
          refs: [
            { method: 'GET', path: '/api/environments' },
            { method: 'GET', path: '/api/typo' },
          ],
        },
      ],
      (m, p) => (p === '/api/environments' ? 'list_environments' : undefined)
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('/api/typo');
  });

  it('behandelt einen Eintrag ohne Refs als Nicht-Fund', () => {
    const findings = checkCrossRefs([{ tool: 'create_git_stack', refs: [] }], () => undefined);
    expect(findings).toHaveLength(0);
  });

  it('behandelt eine leere Eintragsliste als Nicht-Fund', () => {
    expect(checkCrossRefs([], () => undefined)).toEqual([]);
  });
});

describe('extractCrossRefsFromOperation (P3 Task 6)', () => {
  it('extrahiert einen Parameter-Cross-Ref der Form "(from METHOD /api/path)"', () => {
    const op = {
      parameters: [
        { in: 'path', name: 'environmentId', description: 'The environment (from GET /api/environments)' },
      ],
    };
    const refs = extractCrossRefsFromOperation(op);
    expect(refs).toContainEqual({ method: 'GET', path: '/api/environments' });
  });

  it('ignoriert Parameter ohne Cross-Ref-Anmerkung', () => {
    const op = {
      parameters: [{ in: 'path', name: 'id', description: 'Just a plain id' }],
    };
    expect(extractCrossRefsFromOperation(op)).toEqual([]);
  });

  it('ignoriert body-/header-Parameter (nur path/query zaehlen)', () => {
    const op = {
      parameters: [
        { in: 'header', name: 'X-Foo', description: 'Something (from GET /api/environments)' },
      ],
    };
    expect(extractCrossRefsFromOperation(op)).toEqual([]);
  });

  it('extrahiert einen Prosa-Cross-Ref der Form "<field> from METHOD /api/path" aus der description', () => {
    const op = {
      description: 'containerId from GET /api/containers.',
    };
    const refs = extractCrossRefsFromOperation(op);
    expect(refs).toContainEqual({ method: 'GET', path: '/api/containers' });
  });

  it('extrahiert mehrere Prosa-Cross-Refs aus derselben description', () => {
    const op = {
      description: 'containerId from GET /api/containers, environmentId from GET /api/environments.',
    };
    const refs = extractCrossRefsFromOperation(op);
    expect(refs).toContainEqual({ method: 'GET', path: '/api/containers' });
    expect(refs).toContainEqual({ method: 'GET', path: '/api/environments' });
  });

  it('kombiniert Parameter- und Prosa-Cross-Refs derselben Operation', () => {
    const op = {
      parameters: [
        { in: 'query', name: 'environmentId', description: 'Env (from GET /api/environments)' },
      ],
      description: 'containerId from GET /api/containers.',
    };
    const refs = extractCrossRefsFromOperation(op);
    expect(refs).toHaveLength(2);
  });

  it('liefert ein leeres Array fuer eine Operation ohne parameters/description', () => {
    expect(extractCrossRefsFromOperation({})).toEqual([]);
  });
});
