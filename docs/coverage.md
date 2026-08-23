# MCP-Dockhand — API-Coverage

> **Auto-generiert** von `scripts/generate-coverage-doc.mjs` — nicht von Hand editieren.
> Wird täglich vom Workflow `.github/workflows/api-schema-sync.yml` neu erzeugt und bei
> Änderung committet. Grundlage: `docs/dockhand-api-schema.json`.

**Erzeugt:** 2026-08-23T05:23:22.424Z
**Dockhand-Upstream-Commit:** `30fb770a9f37a2414c34d0acd14f1fa289576d18`
**Schema-Endpunkte gesamt:** 247

## Coverage

**88.9%** (295/332 in-Scope-Endpunkte haben ein MCP-Tool)

| Status | Anzahl |
|--------|--------|
| COVERED | 295 |
| MISSING_TOOL | 37 |
| Deliberately omitted (Registry, siehe unten) | 2 |
| ORPHANED_TOOL | 0 |
| Bewusst ausgeschlossen (Streams, Callbacks, interne Routen) | 22 |

## MISSING_TOOL — nach Bereich

Endpunkte, die laut Schema existieren, aber (noch) kein MCP-Tool haben — gruppiert nach dem
ersten Pfad-Segment nach `/api/`:

### backup (30)

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
| GET | `/api/backup/instance` | - |
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

### containers (1)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| GET | `/api/containers/{id}/version-notes` | id |

### docs (1)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| GET | `/api/docs` | - |

### git (1)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| POST | `/api/git/branches` | - |

### images (1)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| POST | `/api/images/load` | - |

### settings (2)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| GET | `/api/settings/semver` | - |
| POST | `/api/settings/semver` | - |

### stacks (1)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| POST | `/api/stacks/{name}/validate` | name |

## Deliberately omitted (with reason)

Endpunkte, die laut Schema existieren, aber laut `docs/omitted-endpoints.json` bewusst
NIE ein MCP-Tool bekommen sollen. Unterscheidet sich von MISSING_TOOL oben: dort stehen
echte, noch offene Lücken (z.B. die Backup-API, siehe #202).

| HTTP | Pfad | Begründung | ADR |
|------|------|------------|-----|
| POST | `/api/git/stacks/{id}/env-files` | Entfernt in #171 — read-only Aufgabe, redundant zu get_git_stack_env_files (GET) plus update_git_stack/update_stack_env für Änderungen. Kein zusätzliches Tool nötig. | docs/adr/0001-omission-registry.md |
| POST | `/api/git/stacks/{id}/webhook` | Eingehender Webhook-EMPFAENGER, kein aufrufbarer Vorgang: GitHub/GitLab rufen ihn mit einer Signatur bzw. einem Token auf, die der Handler prueft, und deployen damit den Git-Stack. Ein Agent hat weder die Signatur noch einen Grund, sie nachzubilden — fuer den absichtlichen Deploy gibt es deploy_git_stack, fuer die Webhook-Verwaltung get_git_stack_webhook (GET, vorhanden). Der Endpunkt taucht sonst dauerhaft als MISSING_TOOL auf und laesst den Luecken-Zaehler groesser aussehen, als er ist. | docs/adr/0001-omission-registry.md |

## Details

Der vollständige Report inkl. aller COVERED-Endpunkte und weiterer Prüfungen
(PARAM_MISMATCH, MISSING_ENCODE, QUERY_PARAM_*) entsteht bei jedem Lauf von
`node scripts/validate-mcp-tools.mjs` als `validation-report.md` (nicht eingecheckt).

