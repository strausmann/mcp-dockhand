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

/** Extract variable keys from raw .env content, skipping blank lines and comments. */
export function parseDotEnvKeys(content: string): string[] {
  const keys: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    keys.push(line.slice(0, eq).trim());
  }
  return keys;
}

/** Remove the given keys from raw .env content, preserving order, comments and blank lines. */
export function removeKeysFromDotEnv(content: string, keys: string[]): string {
  const drop = new Set(keys);
  const kept = content.split(/\r?\n/).filter((rawLine) => {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) return true;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq <= 0) return true;
    return !drop.has(line.slice(0, eq).trim());
  });
  return kept.join('\n');
}
