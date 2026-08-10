import { describe, it, expect } from 'vitest';
import { getBodyContract, getOperationParamNames } from '../scripts/lib/openapi-contract-source.mjs';

/**
 * OpenApiContractSource liest Request-Body-Contracts (required/known Felder) aus der
 * generierten docs/dockhand-openapi.json (Body-Contract-Quelle, siehe
 * scripts/fetch-openapi.mjs). Die meisten Fälle werden hier gegen eine injizierte
 * Fixture-Spec getestet (schnell, unabhängig vom realen Datei-Inhalt); ein Test am Ende
 * prüft den Default-Ladepfad gegen die echte, von fetch-openapi.mjs erzeugte Datei.
 */

const fixtureSpec = {
  openapi: '3.0.0',
  info: { title: 'Dockhand API', version: '1.0.41' },
  components: {
    schemas: {
      NotificationSettings: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          channel: { type: 'string' },
        },
        required: ['enabled'],
      },
    },
  },
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
                  start: { type: 'boolean' },
                },
                required: ['name', 'compose'],
              },
            },
          },
        },
      },
    },
    '/api/activity': {
      get: {},
    },
    '/api/containers/{id}/update': {
      post: {
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  image: { type: 'string' },
                  name: { type: 'string' },
                },
                // Bewusst all-optional -- Partial-Update-Semantik, kein `required`-Key.
              },
            },
          },
        },
      },
    },
    '/api/notifications/{id}': {
      put: {
        requestBody: {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/NotificationSettings' },
            },
          },
        },
      },
    },
    '/api/containers/{id}/rename': {
      post: {
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'env', in: 'query', required: false, schema: { type: 'integer' } },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { name: { type: 'string' } },
                required: ['name'],
              },
            },
          },
        },
      },
    },
  },
};

describe('getBodyContract (fixture spec)', () => {
  it('returns required + known fields for POST /api/stacks', () => {
    const contract = getBodyContract('POST', '/api/stacks', { spec: fixtureSpec });

    expect(contract).toEqual({
      hasSchema: true,
      requiredFields: ['name', 'compose'],
      knownFields: ['name', 'compose', 'start'],
    });
  });

  it('is method-case-insensitive (lowercase "post" resolves the same operation)', () => {
    const upper = getBodyContract('POST', '/api/stacks', { spec: fixtureSpec });
    const lower = getBodyContract('post', '/api/stacks', { spec: fixtureSpec });

    expect(lower).toEqual(upper);
  });

  it('reports hasSchema:false for an endpoint with no requestBody at all', () => {
    expect(getBodyContract('GET', '/api/activity', { spec: fixtureSpec })).toEqual({
      hasSchema: false,
      requiredFields: [],
      knownFields: [],
    });
  });

  it('reports hasSchema:false for a path/method combination that does not exist in the spec', () => {
    expect(getBodyContract('DELETE', '/api/does-not-exist', { spec: fixtureSpec })).toEqual({
      hasSchema: false,
      requiredFields: [],
      knownFields: [],
    });
  });

  it('returns an empty requiredFields array (not an error) for an all-optional schema', () => {
    const contract = getBodyContract('POST', '/api/containers/{id}/update', { spec: fixtureSpec });

    expect(contract.hasSchema).toBe(true);
    expect(contract.requiredFields).toEqual([]);
    expect(contract.knownFields).toEqual(['image', 'name']);
  });

  it('resolves a $ref into components.schemas', () => {
    const contract = getBodyContract('PUT', '/api/notifications/{id}', { spec: fixtureSpec });

    expect(contract).toEqual({
      hasSchema: true,
      requiredFields: ['enabled'],
      knownFields: ['enabled', 'channel'],
    });
  });
});

describe('getBodyContract (default: real docs/dockhand-openapi.json)', () => {
  it('resolves the real POST /api/stacks contract from the committed file', () => {
    const contract = getBodyContract('POST', '/api/stacks');

    expect(contract.hasSchema).toBe(true);
    expect(contract.requiredFields).toEqual(['name', 'compose']);
    expect(contract.knownFields).toEqual(expect.arrayContaining(['name', 'compose']));
  });
});

describe('getOperationParamNames (fixture spec)', () => {
  it('returns path + query param names for an operation that has both', () => {
    const names = getOperationParamNames('POST', '/api/containers/{id}/rename', { spec: fixtureSpec });

    expect(names).toEqual(['id', 'env']);
  });

  it('is method-case-insensitive, same as getBodyContract', () => {
    const upper = getOperationParamNames('POST', '/api/containers/{id}/rename', { spec: fixtureSpec });
    const lower = getOperationParamNames('post', '/api/containers/{id}/rename', { spec: fixtureSpec });

    expect(lower).toEqual(upper);
  });

  it('returns an empty array for an operation with no parameters key at all', () => {
    expect(getOperationParamNames('POST', '/api/stacks', { spec: fixtureSpec })).toEqual([]);
  });

  it('returns an empty array for a path/method combination that does not exist', () => {
    expect(getOperationParamNames('DELETE', '/api/does-not-exist', { spec: fixtureSpec })).toEqual([]);
  });
});

describe('getOperationParamNames (default: real docs/dockhand-openapi.json)', () => {
  it('resolves the real path + query params for POST /api/containers/{id}/rename', () => {
    const names = getOperationParamNames('POST', '/api/containers/{id}/rename');

    expect(names).toEqual(expect.arrayContaining(['id', 'env']));
  });
});
