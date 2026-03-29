# CLAUDE.md — MCP-Dockhand Server

## Projektübersicht

MCP Server (Model Context Protocol) für [Dockhand](https://github.com/finsys/dockhand) Docker Management.
Wrapt die Dockhand REST API in 130+ MCP-Tools mit Streamable HTTP Transport.

## Tech Stack

- **Runtime:** Node.js 22+
- **Sprache:** TypeScript (strict mode)
- **MCP SDK:** @modelcontextprotocol/sdk
- **Validierung:** Zod (aktuell v3, Migration auf v4 geplant)
- **Build:** `npm run build` (tsc)
- **Typecheck:** `npm run typecheck`
- **Tests:** Vitest (geplant — siehe Issue für Test-Suite)
- **Docker:** Multi-stage Build, non-root User, Healthcheck

## Verzeichnisstruktur

```
src/
├── index.ts           # Entry Point, Express Server
├── server.ts          # MCP Server Factory (Multi-Session)
├── auth/              # Dockhand Session-Authentifizierung
├── client/            # HTTP Client mit Cookie-Management
├── tools/             # Tool-Definitionen (130+)
│   ├── containers.ts  # Container-Management (27 Tools)
│   ├── stacks.ts      # Stack-Management (21 Tools)
│   ├── images.ts      # Image-Management (9 Tools)
│   ├── networks.ts    # Netzwerk-Management (7 Tools)
│   ├── volumes.ts     # Volume-Management (9 Tools)
│   ├── git-stacks.ts  # Git-Stack-Management (15 Tools)
│   ├── environments.ts # Environment-Management (18 Tools)
│   ├── users.ts       # User/Rollen-Management (20 Tools)
│   ├── system.ts      # System/Health/Metrics (19 Tools)
│   └── ...            # Weitere Tool-Dateien
├── types/             # TypeScript-Typen
└── utils/             # Hilfsfunktionen
```

## Konventionen

### Code-Stil

- Alle Tool-Parameter mit Zod validieren
- `encodeURIComponent()` auf ALLEN Pfad-Parametern (Container-IDs, Stack-Namen etc.)
- Environment-ID als `environmentId` (number) — IMMER als Query-Parameter `?env=`
- Session-basierte Auth — automatisches Re-Login bei 401
- SSE für Deploy-Operationen (`postSSE` Methode)

### Tool-Definition Pattern

```typescript
server.tool(
  'tool_name',
  'Beschreibung was das Tool tut',
  {
    environmentId: z.number().describe('Environment ID (required)'),
    name: z.string().describe('Resource name'),
    // Optionale Parameter:
    option: z.string().optional().describe('Optional parameter'),
  },
  async ({ environmentId, name, option }) => {
    const client = await getClient(session);
    const result = await client.get(`/api/endpoint/${encodeURIComponent(name)}`, { env: environmentId });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);
```

### Bekannte Probleme (Audit 29.03.2026)

- Issue #16: Inkonsistentes `encodeURIComponent` bei Pfad-Parametern
- Issue #17: Generische `config/settings` statt typisierter Parameter
- Zod v3 → v4 Migration nötig (Breaking Change bei Dependabot PR #13)

## Git

- Commit-Messages: Conventional Commits (feat, fix, docs, chore, refactor)
- Changelog: Keep a Changelog Format (CHANGELOG.md)
- Releases: Semver Tags (v1.0.0) → GHCR Image Build
- Branches: main + feature/fix Branches, PRs für Änderungen

## CI/CD

- **CI:** Typecheck bei jedem Push/PR (`npm run typecheck`)
- **Release:** Docker Build + Push zu GHCR bei Tag-Push
- **Dependabot:** Wöchentlich (npm, GitHub Actions, Docker)
- **API Change Detection:** Wöchentlich Montag 06:00 UTC

## Dockhand API

- **Server:** Dockhand v1.0.22+ (SvelteKit + Bun)
- **Auth:** Cookie-basiert (`dockhand_session`)
- **Base URL:** Konfigurierbar via `DOCKHAND_URL` env var
- **Alle Endpoints:** Environment-scoped via `?env=<id>` Query-Parameter
- **API Baseline:** `docs/dockhand-api-baseline.json` (173 Endpunkte)
