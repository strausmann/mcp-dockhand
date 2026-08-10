import { describe, it, expect } from 'vitest';
import { computeValidation, buildOpenApiPathIndex, computeBodyFindingsForCalls, endpointKey } from '../scripts/validate-mcp-tools.mjs';

/**
 * Integration tests for the Task P1.4/P1.6 wiring inside validate-mcp-tools.mjs:
 * buildOpenApiPathIndex() (bridges our own {containerId}-style tool paths to the real
 * OpenAPI {id}-style path strings via the same normalizePath() the rest of the validator
 * already uses), computeBodyFindingsForCalls() (per-call orchestration around
 * computeBodyFindings()), and computeValidation()'s optional 3rd `toolBodyShapes`
 * argument. Uses the real, committed docs/dockhand-openapi.json (no fixture spec) --
 * getBodyContract()/getOperationParamNames() themselves are already covered against
 * fixtures in tests/openapi-contract-source.test.ts; this file's job is proving the
 * wiring resolves the right real endpoint for a given tool call.
 */

describe('buildOpenApiPathIndex (real docs/dockhand-openapi.json)', () => {
  it('resolves the real OpenAPI path string for a tool-call key with our own param naming', () => {
    const index = buildOpenApiPathIndex();

    expect(index).not.toBeNull();
    // Our tool calls use `{containerId}` (see pathParamsMatch()'s docstring on why), the
    // real spec uses the SvelteKit route param name `{id}` -- both normalize to the same
    // `{*}` key, which is what makes the lookup work regardless of naming.
    expect(index?.get(endpointKey('/api/containers/{containerId}/rename', 'POST'))).toBe(
      '/api/containers/{id}/rename'
    );
  });

  it('has no entry for an endpoint that does not exist in the spec', () => {
    const index = buildOpenApiPathIndex();

    expect(index?.get(endpointKey('/api/does-not-exist', 'POST'))).toBeUndefined();
  });
});

describe('computeBodyFindingsForCalls (real docs/dockhand-openapi.json)', () => {
  const openApiPathIndex = buildOpenApiPathIndex();

  it('flags BODY_PARAM_MISSING_REQUIRED for a tool shape missing the real required "name" field', () => {
    const toolCalls = [
      {
        file: 'containers.ts',
        toolName: 'rename_container',
        httpMethod: 'POST',
        path: '/api/containers/{containerId}/rename',
        usesEncode: true,
        hasPathParams: true,
        queryParamKeys: ['env'],
        line: 205,
      },
    ];
    const toolBodyShapes = {
      // Deliberately missing `name` -- the real endpoint requires it.
      rename_container: { sentFields: ['environmentId', 'containerId'], requiredSent: ['environmentId', 'containerId'], passthrough: false },
    };

    const findings = computeBodyFindingsForCalls(toolCalls, toolBodyShapes, openApiPathIndex);

    expect(findings).toContainEqual(
      expect.objectContaining({ type: 'BODY_PARAM_MISSING_REQUIRED', field: 'name', toolName: 'rename_container', httpMethod: 'POST' })
    );
  });

  it('reports nothing for the real, current rename_container shape (name IS required)', () => {
    const toolCalls = [
      {
        file: 'containers.ts',
        toolName: 'rename_container',
        httpMethod: 'POST',
        path: '/api/containers/{containerId}/rename',
        usesEncode: true,
        hasPathParams: true,
        queryParamKeys: ['env'],
        line: 205,
      },
    ];
    const toolBodyShapes = {
      rename_container: { sentFields: ['environmentId', 'containerId', 'name'], requiredSent: ['environmentId', 'containerId', 'name'], passthrough: false },
    };

    expect(computeBodyFindingsForCalls(toolCalls, toolBodyShapes, openApiPathIndex)).toEqual([]);
  });

  it('skips GET calls entirely -- no request body is expected for them', () => {
    const toolCalls = [
      {
        file: 'containers.ts',
        toolName: 'get_container',
        httpMethod: 'GET',
        path: '/api/containers/{containerId}',
        usesEncode: true,
        hasPathParams: true,
        queryParamKeys: [],
        line: 1,
      },
    ];
    const toolBodyShapes = {
      get_container: { sentFields: ['environmentId', 'containerId'], requiredSent: ['environmentId', 'containerId'], passthrough: false },
    };

    expect(computeBodyFindingsForCalls(toolCalls, toolBodyShapes, openApiPathIndex)).toEqual([]);
  });

  it('skips a call whose tool name is not present in toolBodyShapes instead of throwing', () => {
    const toolCalls = [
      {
        file: 'containers.ts',
        toolName: 'not_in_shapes',
        httpMethod: 'POST',
        path: '/api/containers/{containerId}/rename',
        usesEncode: true,
        hasPathParams: true,
        queryParamKeys: ['env'],
        line: 1,
      },
    ];

    expect(() => computeBodyFindingsForCalls(toolCalls, {}, openApiPathIndex)).not.toThrow();
    expect(computeBodyFindingsForCalls(toolCalls, {}, openApiPathIndex)).toEqual([]);
  });
});

describe('computeValidation — bodyFindings wiring (Task P1.4)', () => {
  it('keeps bodyFindings empty and touches no other bucket when toolBodyShapes is omitted (2-arg call, exit-code invariance)', () => {
    const schema = { endpoints: [] };
    const result = computeValidation(schema, []);

    expect(result.bodyFindings).toEqual([]);
    expect(result).toEqual(
      expect.objectContaining({
        covered: [],
        missingTool: [],
        orphanedTool: [],
        paramMismatch: [],
        missingEncode: [],
        queryParamMissingRequired: [],
        queryParamUnknown: [],
        bodyFindings: [],
        excludedCount: 0,
      })
    );
  });

  it('produces bodyFindings when toolBodyShapes is passed, without changing the critical buckets that drive the exit code', () => {
    const schema = {
      endpoints: [
        {
          path: '/api/containers/{containerId}/rename',
          methods: ['POST'],
          pathParams: ['containerId'],
          queryParamsByMethod: { POST: [{ name: 'env', required: false }] },
        },
      ],
    };
    const toolCalls = [
      {
        file: 'containers.ts',
        toolName: 'rename_container',
        httpMethod: 'POST',
        path: '/api/containers/{containerId}/rename',
        usesEncode: true,
        hasPathParams: true,
        queryParamKeys: ['env'],
        line: 205,
      },
    ];
    const toolBodyShapes = {
      rename_container: { sentFields: ['environmentId', 'containerId'], requiredSent: ['environmentId', 'containerId'], passthrough: false },
    };

    const result = computeValidation(schema, toolCalls, toolBodyShapes);

    // The exit-code-critical buckets are unaffected by body-findings -- the tool call is a
    // perfectly valid, COVERED, non-orphaned, param-matching call from the schema's point
    // of view; the missing "name" field only shows up in bodyFindings.
    expect(result.orphanedTool).toEqual([]);
    expect(result.paramMismatch).toEqual([]);
    expect(result.missingEncode).toEqual([]);
    expect(result.queryParamUnknown).toEqual([]);
    expect(result.queryParamMissingRequired).toEqual([]);
    expect(result.covered).toEqual([{ path: '/api/containers/{containerId}/rename', method: 'POST', tools: ['rename_container'] }]);

    expect(result.bodyFindings).toContainEqual(
      expect.objectContaining({ type: 'BODY_PARAM_MISSING_REQUIRED', field: 'name' })
    );
  });
});
