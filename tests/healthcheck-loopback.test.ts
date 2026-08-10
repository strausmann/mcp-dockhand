import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Regression test for #92 / #84: the container HEALTHCHECK (Dockerfile) and
// the compose healthcheck (docker-compose.yml) must probe the IPv4 loopback
// address 127.0.0.1 explicitly, never the hostname "localhost".
//
// Root cause: the server binds only the IPv4 wildcard address (see
// src/index.ts `host: process.env['MCP_HOST'] || '0.0.0.0'`), while on
// Alpine/musl images BusyBox `wget` resolves "localhost" to the IPv6
// loopback (::1) first. With nothing listening on [::1]:8080, every
// healthcheck probe against "localhost" fails with "Connection refused"
// even though the server is fully healthy — the container is reported
// `unhealthy` forever.

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function extractHealthcheckCommands(text: string): string[] {
  const commands: string[] = [];

  // Dockerfile: `HEALTHCHECK ... CMD <command>`
  const dockerfileMatch = text.match(/^HEALTHCHECK\b.*$/m);
  if (dockerfileMatch) {
    commands.push(dockerfileMatch[0]);
  }

  // docker-compose.yml: `test: ["CMD", "wget", "-qO-", "http://..."]`
  const composeMatch = text.match(/test:\s*\[[^\]]*]/);
  if (composeMatch) {
    commands.push(composeMatch[0]);
  }

  return commands;
}

describe('container healthcheck uses IPv4 loopback (127.0.0.1), not localhost', () => {
  it('Dockerfile HEALTHCHECK targets 127.0.0.1', () => {
    const dockerfile = readFileSync(join(repoRoot, 'Dockerfile'), 'utf-8');
    const [healthcheckLine] = extractHealthcheckCommands(dockerfile);

    expect(healthcheckLine).toBeDefined();
    expect(healthcheckLine).toContain('127.0.0.1:8080/health');
    expect(healthcheckLine).not.toMatch(/localhost:8080/);
  });

  it('docker-compose.yml healthcheck test targets 127.0.0.1', () => {
    const compose = readFileSync(join(repoRoot, 'docker-compose.yml'), 'utf-8');
    const [healthcheckTest] = extractHealthcheckCommands(compose);

    expect(healthcheckTest).toBeDefined();
    expect(healthcheckTest).toContain('127.0.0.1:8080/health');
    expect(healthcheckTest).not.toMatch(/localhost:8080/);
  });
});
