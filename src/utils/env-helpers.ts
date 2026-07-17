import type { EnvVariable } from '../types/dockhand.js';

export interface EnvDiff {
  added: string[];
  updated: string[];
  preserved: string[];
  removed: string[];
}

/**
 * Diff a payload against the existing variables for update_stack_env.
 * A payload value of '***' means "keep existing value" and never counts as updated.
 */
export function diffEnvVars(
  existing: EnvVariable[],
  payload: EnvVariable[],
  mode: 'merge' | 'replace',
): EnvDiff {
  const existingByKey = new Map(existing.map((v) => [v.key, v]));
  const payloadKeys = new Set(payload.map((v) => v.key));

  const added: string[] = [];
  const updated: string[] = [];
  for (const v of payload) {
    const prev = existingByKey.get(v.key);
    if (!prev) {
      added.push(v.key);
      continue;
    }
    const valueChanged = v.value !== '***' && v.value !== prev.value;
    const secretChanged = v.isSecret !== undefined && v.isSecret !== prev.isSecret;
    if (valueChanged || secretChanged) updated.push(v.key);
  }

  const untouched = existing.filter((v) => !payloadKeys.has(v.key)).map((v) => v.key);
  return {
    added,
    updated,
    preserved: mode === 'merge' ? untouched : [],
    removed: mode === 'replace' ? untouched : [],
  };
}
