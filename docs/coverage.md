# MCP-Dockhand — API-Coverage

> **Auto-generiert** von `scripts/generate-coverage-doc.mjs` — nicht von Hand editieren.
> Wird täglich vom Workflow `.github/workflows/api-schema-sync.yml` neu erzeugt und bei
> Änderung committet. Grundlage: `docs/dockhand-api-schema.json`.

**Erzeugt:** 2026-09-06T09:03:40.013Z
**Dockhand-Upstream-Commit:** `14f75845edd4ee221bc1df7c0d65f3e341188149`
**Schema-Endpunkte gesamt:** 254

## Coverage

**94.8%** (325/343 in-Scope-Endpunkte haben ein MCP-Tool)

| Status | Anzahl |
|--------|--------|
| COVERED | 325 |
| MISSING_TOOL | 18 |
| Deliberately omitted (Registry, siehe unten) | 2 |
| ORPHANED_TOOL | 0 |
| Bewusst ausgeschlossen (Streams, Callbacks, interne Routen) | 22 |

## MISSING_TOOL — nach Bereich

Endpunkte, die laut Schema existieren, aber (noch) kein MCP-Tool haben — gruppiert nach dem
ersten Pfad-Segment nach `/api/`:

### backup (3)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| POST | `/api/backup/restore` | - |
| POST | `/api/backup/restore/preview` | - |
| POST | `/api/backup/restore/stop` | - |

### container-icons (4)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| GET | `/api/container-icons` | - |
| DELETE | `/api/container-icons/{name}` | name |
| GET | `/api/container-icons/{name}` | name |
| POST | `/api/container-icons/{name}` | name |

### containers (2)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| GET | `/api/containers/{id}/compose` | id |
| GET | `/api/containers/{id}/version-notes` | id |

### docs (1)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| GET | `/api/docs` | - |

### git (1)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| POST | `/api/git/branches` | - |

### icons (3)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| GET | `/api/icons/selfhst-manifest` | - |
| GET | `/api/icons/selfhst/{ref}` | ref |
| POST | `/api/icons/selfhst/batch` | - |

### images (1)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| POST | `/api/images/load` | - |

### stacks (3)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| DELETE | `/api/stacks/{name}/icon` | name |
| GET | `/api/stacks/{name}/icon` | name |
| POST | `/api/stacks/{name}/icon` | name |

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

