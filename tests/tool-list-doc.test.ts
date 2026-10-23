import { describe, it, expect } from 'vitest';
import { buildToolListDoc } from '../src/utils/tool-list-doc.js';

const endpointMap = {
  list_things: { method: 'GET', path: '/api/things' },
  delete_thing: { method: 'DELETE', path: '/api/things/{id}' },
  create_thing: { method: 'POST', path: '/api/things' },
};
const summaries: Record<string, string> = {
  list_things: 'List things. Returns all of them.',
  delete_thing: 'Delete a thing',
  create_thing: 'Create a | b thing',
};

function build() {
  return buildToolListDoc({
    endpointMap,
    metaToolNames: ['self_check'],
    classify: (n) => (n === 'list_things' || n === 'self_check' ? 'read' : 'write'),
    summaryOf: (n) => summaries[n],
    openApiCommit: 'abc1234',
  });
}

describe('buildToolListDoc', () => {
  it('starts with an auto-generated notice naming the generator script', () => {
    const first = build().split('\n').slice(0, 5).join('\n');
    expect(first).toContain('scripts/generate-tool-list.mjs');
    expect(first.toLowerCase()).toContain('auto-generated');
  });

  it('links to the README filter section', () => {
    expect(build()).toContain('[README → Read-only mode and tool filter](../README.md#read-only-mode-and-tool-filter)');
  });

  it('reports total, read and write counts', () => {
    expect(build()).toContain('**Tools:** 4 · **read:** 2 · **write:** 2');
  });

  it('has the table header and rows sorted by name', () => {
    const doc = build();
    expect(doc).toContain('| Tool | Mode | Method | Path | Summary |');
    const names = [...doc.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]);
    expect(names).toEqual(['create_thing', 'delete_thing', 'list_things', 'self_check']);
  });

  it('shows an em dash for method and path of meta tools', () => {
    expect(build()).toContain('| `self_check` | read | — | — | — |');
  });

  it('escapes pipes and cuts summaries to the first sentence', () => {
    const doc = build();
    expect(doc).toContain('Create a \\| b thing');
    expect(doc).toContain('| List things. |');
    expect(doc).not.toContain('Returns all of them');
  });

  it('contains no timestamp and is deterministic', () => {
    const doc = build();
    expect(doc).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
    expect(doc).toBe(build());
  });
});
