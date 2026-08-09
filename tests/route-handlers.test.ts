import { describe, it, expect } from 'vitest';
import { extractHandlerBlocks, analyzeQueryParams } from '../scripts/lib/route-handlers.mjs';

describe('extractHandlerBlocks', () => {
  it('isolates the body of a single-method handler', () => {
    const source = `
import { json } from '@sveltejs/kit';
export const GET: RequestHandler = async ({ url }) => {
	const name = url.searchParams.get('name');
	return json({ name });
};
`;
    const blocks = extractHandlerBlocks(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].method).toBe('GET');
    expect(blocks[0].body).toContain(`url.searchParams.get('name')`);
  });

  it('isolates each method separately when a file exports multiple handlers', () => {
    const source = `
export const GET: RequestHandler = async ({ url, cookies }) => {
	const env = url.searchParams.get('env');
	return json({ env });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	return json(body);
};
`;
    const blocks = extractHandlerBlocks(source);
    expect(blocks.map((b) => b.method)).toEqual(['GET', 'POST']);
    expect(blocks[0].body).toContain('searchParams');
    expect(blocks[1].body).not.toContain('searchParams');
  });

  it('does not let braces inside the handler body confuse block-boundary detection', () => {
    const source = `
export const GET: RequestHandler = async ({ url }) => {
	if (true) {
		const x = { a: 1, b: { c: 2 } };
	}
	return json({ ok: true });
};
export const POST: RequestHandler = async () => {
	return json({ marker: 'post-body' });
};
`;
    const blocks = extractHandlerBlocks(source);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].body).not.toContain('post-body');
    expect(blocks[1].body).toContain('post-body');
  });

  it('returns an empty array for a file with no exported HTTP-method handlers', () => {
    expect(extractHandlerBlocks('export function helper() { return 1; }')).toEqual([]);
  });
});

describe('analyzeQueryParams', () => {
  it('classifies a param as required when a falsy guard 400s (real registry/catalog shape)', () => {
    const body = `
	const registryId = url.searchParams.get('registry');
	const lastParam = url.searchParams.get('last');

	if (!registryId) {
		return json({ error: 'Registry ID is required' }, { status: 400 });
	}
`;
    expect(analyzeQueryParams(body)).toEqual([
      { name: 'last', required: false },
      { name: 'registry', required: true },
    ]);
  });

  it('classifies a param as optional when there is no guard (default fallback)', () => {
    const body = `
	const envId = url.searchParams.get('env');
	const parsedEnvId = envId ? parseInt(envId) : undefined;
`;
    expect(analyzeQueryParams(body)).toEqual([{ name: 'env', required: false }]);
  });

  it('classifies all params in a multi-condition OR guard as required (real backup/snapshots/diff shape)', () => {
    const body = `
	const destId = url.searchParams.get('destinationId');
	const snapA = url.searchParams.get('snapshotA');
	const snapB = url.searchParams.get('snapshotB');

	if (!destId || !snapA || !snapB) {
		return json({ error: 'Missing required params' }, { status: 400 });
	}
`;
    expect(analyzeQueryParams(body)).toEqual([
      { name: 'destinationId', required: true },
      { name: 'snapshotA', required: true },
      { name: 'snapshotB', required: true },
    ]);
  });

  it('classifies a boolean-coerced param as optional (=== "true" pattern, no guard)', () => {
    const body = `
	const removeImagesFlag = url.searchParams.get('removeImages') === 'true';
	const checkUpdates = url.searchParams.get('checkUpdates') === 'true';
`;
    expect(analyzeQueryParams(body)).toEqual([
      { name: 'checkUpdates', required: false },
      { name: 'removeImages', required: false },
    ]);
  });

  it('classifies a boolean-coerced param as required when guarded (real settings/scanner DELETE shape)', () => {
    const body = `
	const removeImagesFlag = url.searchParams.get('removeImages') === 'true';
	if (!removeImagesFlag) {
		return json({ error: 'removeImages parameter required' }, { status: 400 });
	}
`;
    expect(analyzeQueryParams(body)).toEqual([{ name: 'removeImages', required: true }]);
  });

  it('classifies an inline (unassigned) param read with a guard as required', () => {
    const body = `
	if (!url.searchParams.get('name')) {
		return json({ error: 'name is required' }, { status: 400 });
	}
`;
    expect(analyzeQueryParams(body)).toEqual([{ name: 'name', required: true }]);
  });

  it('does not flag a param as required when the guard belongs to an unrelated variable', () => {
    // Real pattern: `registryId` is checked, but so is the *result of a DB lookup*
    // (`registry`) with an unrelated 404. Only the actual query-param variable counts.
    const body = `
	const registryId = url.searchParams.get('registry');
	if (!registryId) {
		return json({ error: 'Registry ID is required' }, { status: 400 });
	}
	const registry = await getRegistry(parseInt(registryId));
	if (!registry) {
		return json({ error: 'Registry not found' }, { status: 404 });
	}
`;
    expect(analyzeQueryParams(body)).toEqual([{ name: 'registry', required: true }]);
  });

  it('supports the === null / == null guard forms, not just !x', () => {
    const body = `
	const id = url.searchParams.get('id');
	if (id === null) {
		return json({ error: 'id required' }, { status: 400 });
	}
`;
    expect(analyzeQueryParams(body)).toEqual([{ name: 'id', required: true }]);
  });

  it('does not flag required when the guard action has no 4xx status (e.g. a 500 catch-all)', () => {
    const body = `
	const id = url.searchParams.get('id');
	if (!id) {
		console.error('unexpected state');
	}
`;
    expect(analyzeQueryParams(body)).toEqual([{ name: 'id', required: false }]);
  });

  it('does not flag required for an unbraced if-statement without a 4xx status', () => {
    const body = `
	const id = url.searchParams.get('id');
	if (!id) return;
`;
    expect(analyzeQueryParams(body)).toEqual([{ name: 'id', required: false }]);
  });

  it('classifies a required param from an unbraced single-statement guard (no curly braces)', () => {
    const body = `
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'id required' }, { status: 400 });
`;
    expect(analyzeQueryParams(body)).toEqual([{ name: 'id', required: true }]);
  });

  it('returns an empty array for a body with no query-param reads', () => {
    expect(analyzeQueryParams('return json({ ok: true });')).toEqual([]);
  });

  it('deduplicates a param read more than once, required if ANY read site is guarded', () => {
    const body = `
	if (!url.searchParams.get('name')) {
		return json({ error: 'name required' }, { status: 400 });
	}
	const nameAgain = url.searchParams.get('name');
`;
    expect(analyzeQueryParams(body)).toEqual([{ name: 'name', required: true }]);
  });
});
