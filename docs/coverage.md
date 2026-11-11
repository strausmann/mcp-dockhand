# MCP-Dockhand — API-Coverage

> **Auto-generiert** von `scripts/generate-coverage-doc.mjs` — nicht von Hand editieren.
> Wird täglich vom Workflow `.github/workflows/api-schema-sync.yml` neu erzeugt und bei
> Änderung committet. Grundlage: `docs/dockhand-openapi.json` (via `deriveRoutesFromOpenapi()`).

**Erzeugt:** 2026-11-09T06:21:27.311Z
**Dockhand-Upstream-Commit:** `1cf2ccbc3afc28122c00ee59b295e23666ad1965`
**Schema-Endpunkte gesamt:** 289

## Coverage

**97.2%** (379/390 in-Scope-Endpunkte haben ein MCP-Tool)

| Status | Anzahl |
|--------|--------|
| COVERED | 379 |
| MISSING_TOOL | 11 |
| Deliberately omitted (Registry, siehe unten) | 2 |
| ORPHANED_TOOL | 0 |
| Bewusst ausgeschlossen (Streams, Callbacks, interne Routen) | 26 |

## MISSING_TOOL — nach Bereich

Endpunkte, die laut Schema existieren, aber (noch) kein MCP-Tool haben — gruppiert nach dem
ersten Pfad-Segment nach `/api/`:

### auth (1)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| POST | `/api/auth/oidc/backchannel-logout` | - |

### exposure-status (2)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| GET | `/api/exposure-status` | - |
| POST | `/api/exposure-status` | - |

### git (1)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| POST | `/api/git/stacks/{id}/detach` | id |

### preferences (2)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| GET | `/api/preferences/language` | - |
| PUT | `/api/preferences/language` | - |

### scheduled-actions (2)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| GET | `/api/scheduled-actions/{containerName}` | containerName |
| PUT | `/api/scheduled-actions/{containerName}` | containerName |

### settings (2)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| GET | `/api/settings/pinned-digest-report` | - |
| POST | `/api/settings/pinned-digest-report` | - |

### stacks (1)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| POST | `/api/stacks/{name}/attach` | name |

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

