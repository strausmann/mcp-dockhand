# MCP-Dockhand — API-Coverage

> **Auto-generiert** von `scripts/generate-coverage-doc.mjs` — nicht von Hand editieren.
> Wird täglich vom Workflow `.github/workflows/api-schema-sync.yml` neu erzeugt und bei
> Änderung committet. Grundlage: `docs/dockhand-openapi.json` (via `deriveRoutesFromOpenapi()`).

**Erzeugt:** 2026-10-12T06:38:46.941Z
**Dockhand-Upstream-Commit:** `5c03936f8a96b20caddf58e77912585273962032`
**Schema-Endpunkte gesamt:** 282

## Coverage

**96.9%** (371/383 in-Scope-Endpunkte haben ein MCP-Tool)

| Status | Anzahl |
|--------|--------|
| COVERED | 371 |
| MISSING_TOOL | 12 |
| Deliberately omitted (Registry, siehe unten) | 2 |
| ORPHANED_TOOL | 0 |
| Bewusst ausgeschlossen (Streams, Callbacks, interne Routen) | 22 |

## MISSING_TOOL — nach Bereich

Endpunkte, die laut Schema existieren, aber (noch) kein MCP-Tool haben — gruppiert nach dem
ersten Pfad-Segment nach `/api/`:

### auth (4)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| POST | `/api/auth/passkeys/login/options` | - |
| POST | `/api/auth/passkeys/login/verify` | - |
| POST | `/api/auth/passkeys/register/options` | - |
| POST | `/api/auth/passkeys/register/verify` | - |

### environments (3)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| GET | `/api/environments/{id}/report` | id |
| POST | `/api/environments/{id}/report` | id |
| GET | `/api/environments/report` | - |

### profile (2)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| GET | `/api/profile/passkeys` | - |
| DELETE | `/api/profile/passkeys/{id}` | id |

### settings (2)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| GET | `/api/settings/minimum-release-age` | - |
| POST | `/api/settings/minimum-release-age` | - |

### stack-stats (1)

| HTTP | Pfad | Path-Parameter |
|------|------|----------------|
| GET | `/api/stack-stats` | - |

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

