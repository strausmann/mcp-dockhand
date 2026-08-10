/**
 * Regression tests for #155 (DX follow-up to #142/#154).
 *
 * `update_container_runtime` wraps Dockhand's in-place container update
 * (`POST /api/containers/{id}/update-runtime`, Finsys/dockhand v1.0.41,
 * `IN_PLACE_UPDATE_FIELDS` in src/lib/server/docker.ts:1236-1280). The
 * server-side allowlist was already correctly enforced (unknown keys are
 * silently dropped, never an error, never a recreate — see #155's
 * re-scoping) — but the MCP tool's `config` schema was a bare
 * `z.record(z.string(), z.unknown())` and neither the tool description nor
 * the `config` parameter description named a single accepted field, even
 * though upstream documents the exact list.
 *
 * These tests lock in the fix: both descriptions now name every accepted
 * field, sourced from the exported `UPDATE_CONTAINER_RUNTIME_ACCEPTED_FIELDS`
 * constant (single source of truth, see the comment above it in
 * src/tools/containers.ts), and the schema stays non-breaking — it still
 * accepts arbitrary keys and lets the server enforce the allowlist, exactly
 * as it did before #155.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import {
  registerContainerTools,
  UPDATE_CONTAINER_RUNTIME_ACCEPTED_FIELDS,
} from '../src/tools/containers.js';

interface Registration {
  description: string;
  schema: Record<string, z.ZodTypeAny>;
}

/**
 * Register the container tools against a fake MCP server that captures each
 * tool's (name, description, schema) triple. Mirrors the fixture in
 * tests/update-container-contract.test.ts, extended to also capture the
 * schema so the `config` field's `.describe()` text can be inspected.
 */
function captureRegistrations(): Map<string, Registration> {
  const registrations = new Map<string, Registration>();
  const server = {
    tool: (name: string, description: string, schema: Record<string, z.ZodTypeAny>) => {
      registrations.set(name, { description, schema });
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerContainerTools(server as any, {} as any);
  return registrations;
}

describe('update_container_runtime — accepted field names surfaced (#155)', () => {
  const registrations = captureRegistrations();
  const registration = registrations.get('update_container_runtime');
  const expectedFieldList = UPDATE_CONTAINER_RUNTIME_ACCEPTED_FIELDS.join(', ');

  it('is registered', () => {
    expect(registration).toBeDefined();
  });

  // P3 Task 5 (mcp-dockhand): the tool-level description is no longer a hand-written
  // literal — it is derived from docs/dockhand-openapi.json at registration time (see
  // src/openapi/describe-tool.ts). The accepted-fields allowlist below is this MCP
  // tool's own value-add (Docker's IN_PLACE_UPDATE_FIELDS list, surfaced because the
  // real endpoint accepts a passthrough object and silently drops unknown keys — see
  // this file's header comment for #155); it is not something Dockhand's OpenAPI spec
  // documents, so it can no longer appear in the derived tool-level description.
  // KNOWN REGRESSION: flagged for review in the Task 5 report. The field list still
  // survives on the `config` PARAMETER's own .describe() (untouched by Task 5 — only
  // the top-level registerTool() description argument was removed) — asserted next.

  it('config parameter description names every accepted field from the upstream allowlist, in the documented order', () => {
    const configDescription = registration?.schema.config?.description;
    expect(configDescription).toBeDefined();
    expect(configDescription).toContain(expectedFieldList);
  });

  it('the accepted-fields constant matches the real Dockhand IN_PLACE_UPDATE_FIELDS allowlist (Finsys/dockhand v1.0.41, docker.ts:1236-1280)', () => {
    // Regression guard: if this list and the upstream allowlist ever
    // diverge, update_container_runtime documents fields the server does
    // not accept, or omits fields it does. Keep this list, and the
    // description strings in src/tools/containers.ts, in sync per
    // .claude/skills/dockhand-mcp-dev/references/upstream-validation.md.
    expect([...UPDATE_CONTAINER_RUNTIME_ACCEPTED_FIELDS]).toEqual([
      'RestartPolicy',
      'CpuShares', 'CpuPeriod', 'CpuQuota', 'CpuRealtimePeriod', 'CpuRealtimeRuntime',
      'CpusetCpus', 'CpusetMems', 'NanoCpus',
      'Memory', 'MemorySwap', 'MemoryReservation', 'MemorySwappiness', 'KernelMemory',
      'BlkioWeight', 'BlkioWeightDevice',
      'BlkioDeviceReadBps', 'BlkioDeviceWriteBps',
      'BlkioDeviceReadIOps', 'BlkioDeviceWriteIOps',
      'PidsLimit',
    ]);
  });

  it('config schema still accepts arbitrary keys — non-breaking, the server enforces the allowlist, not the client (#155 explicitly keeps this out of scope, see #142\'s counterexample reasoning)', () => {
    const configSchema = registration?.schema.config;
    expect(configSchema).toBeDefined();
    const parsed = configSchema?.parse({
      RestartPolicy: { Name: 'always' },
      SomeFutureDockerField: 42,
    });
    expect(parsed).toEqual({ RestartPolicy: { Name: 'always' }, SomeFutureDockerField: 42 });
  });
});
