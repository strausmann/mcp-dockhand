import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { computeBodyShape, createCapturingServer, getToolBodyShape } from '../scripts/lib/tool-body-shape.mjs';
import { registerStackTools } from '../src/tools/stacks.js';

/**
 * tool-body-shape.mjs liest die rohen Zod-Shapes unserer MCP-Tools aus (das dritte
 * Argument von registerTool(server, name, description, schema, callback), siehe
 * src/utils/tool-helper.ts) und fasst sie zu { sentFields, requiredSent, passthrough }
 * zusammen -- die zweite "Eingangsseite" für den kommenden Body-Contract-Abgleich
 * (Gegenstück zu OpenApiContractSource, das die Sollseite liefert).
 *
 * computeBodyShape() ist framework-agnostisch (kein Zod-Import) und wird hier direkt mit
 * echten Zod-Schemas getestet, exakt wie im Auftrag beschrieben. createCapturingServer()
 * spiegelt den Mock-`server.tool`-Fixture-Weg aus tests/update-container-contract.test.ts
 * / tests/stack-env-merge-behavior.test.ts -- kein neuer Parser, keine eigene
 * Introspektionslogik pro Tool-Datei.
 */

describe('computeBodyShape', () => {
  it('splits required vs. optional fields and reports no passthrough for a plain shape', () => {
    const shape = {
      name: z.string(),
      compose: z.string(),
      env: z.number().optional(),
    };

    expect(computeBodyShape(shape)).toEqual({
      sentFields: ['name', 'compose', 'env'],
      requiredSent: ['name', 'compose'],
      passthrough: false,
    });
  });

  it('flags passthrough:true when any field is an untyped z.record(...)', () => {
    const shape = {
      name: z.string(),
      config: z.record(z.string(), z.unknown()),
    };

    const result = computeBodyShape(shape);

    expect(result.passthrough).toBe(true);
    expect(result.sentFields).toEqual(['name', 'config']);
  });

  it('flags passthrough:true for an OPTIONAL z.record(...) -- the real-world shape', () => {
    // Every actual passthrough field in this codebase (e.g. update_container's `settings`)
    // is wrapped in .optional(): `z.record(z.string(), z.unknown()).optional()`. Zod v4
    // represents that as a top-level "optional" wrapper node whose `def.innerType` is the
    // record -- NOT a top-level `def.type === 'record'` node. A detector that only checks
    // the outermost def.type (without unwrapping .optional()/.nullable()/.default() first)
    // silently reports passthrough:false for this shape, which is the shape that appears
    // in real code. Verified live against src/tools/containers.ts (update_container):
    // running scripts/collect-tool-shapes.mjs against the real registered tool reported
    // passthrough:false for its optional `settings: z.record(...).optional()` field before
    // this fix.
    const shape = {
      name: z.string(),
      settings: z.record(z.string(), z.unknown()).optional(),
    };

    const result = computeBodyShape(shape);

    expect(result.passthrough).toBe(true);
  });

  it('flags passthrough:true for a NULLABLE z.record(...) too (same wrapper-unwrapping need)', () => {
    const shape = {
      config: z.record(z.string(), z.unknown()).nullable(),
    };

    expect(computeBodyShape(shape).passthrough).toBe(true);
  });

  it('treats an empty shape as zero fields, not an error', () => {
    expect(computeBodyShape({})).toEqual({
      sentFields: [],
      requiredSent: [],
      passthrough: false,
    });
  });

  it('rejects a non-object argument with a clear error instead of crashing later', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => computeBodyShape(null as any)).toThrow(/Zod-Shape/);
  });
});

describe('getToolBodyShape — captured from a real tool registration (create_stack)', () => {
  it('reads sentFields/requiredSent/passthrough straight from the registered zod shape', () => {
    const { server, shapes } = createCapturingServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerStackTools(server as any, {} as any);

    const result = getToolBodyShape('create_stack', shapes);

    expect(result.requiredSent).toEqual(['environmentId', 'name', 'compose']);
    expect(result.sentFields).toEqual([
      'environmentId',
      'name',
      'compose',
      'composePath',
      'envPath',
      'start',
      'envVars',
      'rawEnvContent',
    ]);
    expect(result.passthrough).toBe(false);
  });

  it('throws a clear, name-including error for an unknown tool name', () => {
    const { shapes } = createCapturingServer();

    expect(() => getToolBodyShape('does_not_exist', shapes)).toThrow(/does_not_exist/);
  });
});
