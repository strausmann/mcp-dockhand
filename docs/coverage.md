# MCP-Dockhand — API-Coverage

> **Auto-generiert** von `scripts/generate-coverage-doc.mjs` — nicht von Hand editieren.
> Wird täglich vom Workflow `.github/workflows/api-schema-sync.yml` neu erzeugt und bei
> Änderung committet. Grundlage: `docs/dockhand-api-schema.json`.

**Erzeugt:** 2026-08-10T09:28:04.886Z
**Dockhand-Upstream-Commit:** `905c4a004dafe1cbad4ed2babc2c532d7f4018b8`
**Schema-Endpunkte gesamt:** 235

## Coverage

**88.7%** (282/318 in-Scope-Endpunkte haben ein MCP-Tool)

| Status | Anzahl |
|--------|--------|
| COVERED | 282 |
| MISSING_TOOL | 36 |
| ORPHANED_TOOL | 0 |
| Bewusst ausgeschlossen (Streams, Callbacks, interne Routen) | 22 |

## MISSING_TOOL — nach Bereich

Endpunkte, die laut Schema existieren, aber (noch) kein MCP-Tool haben — gruppiert nach dem
ersten Pfad-Segment nach `/api/`:

### backup (29)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| GET | `/api/backup/configs` | - |
| POST | `/api/backup/configs` | - |
| DELETE | `/api/backup/configs/{id}` | id |
| GET | `/api/backup/configs/{id}` | id |
| PUT | `/api/backup/configs/{id}` | id |
| POST | `/api/backup/configs/{id}/run` | id |
| POST | `/api/backup/configs/{id}/stop` | id |
| GET | `/api/backup/destinations` | - |
| POST | `/api/backup/destinations` | - |
| DELETE | `/api/backup/destinations/{id}` | id |
| GET | `/api/backup/destinations/{id}` | id |
| PUT | `/api/backup/destinations/{id}` | id |
| POST | `/api/backup/destinations/{id}/init` | id |
| POST | `/api/backup/destinations/{id}/rotate-key` | id |
| POST | `/api/backup/destinations/{id}/task` | id |
| POST | `/api/backup/destinations/{id}/test` | id |
| POST | `/api/backup/destinations/{id}/verify` | id |
| POST | `/api/backup/destinations/test` | - |
| POST | `/api/backup/restore` | - |
| POST | `/api/backup/restore/preview` | - |
| POST | `/api/backup/restore/stop` | - |
| GET | `/api/backup/snapshots` | - |
| DELETE | `/api/backup/snapshots/{id}` | id |
| GET | `/api/backup/snapshots/{id}/browse` | id |
| GET | `/api/backup/snapshots/{id}/dump` | id |
| GET | `/api/backup/snapshots/{id}/metadata` | id |
| GET | `/api/backup/snapshots/diff` | - |
| GET | `/api/backup/stack-dir-listing` | - |
| GET | `/api/backup/stack-path` | - |

### environments (2)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| GET | `/api/environments/{id}/remote-stacks-dir` | id |
| POST | `/api/environments/{id}/remote-stacks-dir` | id |

### git (1)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| POST | `/api/git/stacks/{id}/webhook` | id |

### registry (1)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| GET | `/api/registry/tag-info` | - |

### settings (2)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| GET | `/api/settings/navigation` | - |
| PUT | `/api/settings/navigation` | - |

### stacks (1)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| GET | `/api/stacks/{name}/delete-preview` | name |

## Details

Der vollständige Report inkl. aller COVERED-Endpunkte und weiterer Prüfungen
(PARAM_MISMATCH, MISSING_ENCODE, QUERY_PARAM_*) entsteht bei jedem Lauf von
`node scripts/validate-mcp-tools.mjs` als `validation-report.md` (nicht eingecheckt).

