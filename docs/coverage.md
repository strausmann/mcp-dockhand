# MCP-Dockhand — API-Coverage

> **Auto-generiert** von `scripts/generate-coverage-doc.mjs` — nicht von Hand editieren.
> Wird täglich vom Workflow `.github/workflows/api-schema-sync.yml` neu erzeugt und bei
> Änderung committet. Grundlage: `docs/dockhand-openapi.json` (via `deriveRoutesFromOpenapi()`).

**Erzeugt:** 2026-11-24T17:37:18.683Z
**Dockhand-Upstream-Commit:** `0b194bd584a9c13fa97646ff8679b089e284a2af`
**Schema-Endpunkte gesamt:** 289

## Coverage

**100.0%** (388/388 in-Scope-Endpunkte haben ein MCP-Tool)

| Status | Anzahl |
|--------|--------|
| COVERED | 388 |
| MISSING_TOOL | 0 |
| Deliberately omitted (Registry, siehe unten) | 4 |
| ORPHANED_TOOL | 0 |
| Bewusst ausgeschlossen (Streams, Callbacks, interne Routen) | 26 |

## MISSING_TOOL

Keine — alle in-Scope-Endpunkte haben ein MCP-Tool.

## Deliberately omitted (with reason)

Endpunkte, die laut Schema existieren, aber laut `docs/omitted-endpoints.json` bewusst
NIE ein MCP-Tool bekommen sollen. Unterscheidet sich von MISSING_TOOL oben: dort stehen
echte, noch offene Lücken (z.B. die Backup-API, siehe #202).

| HTTP | Pfad | Begründung | ADR |
|------|------|------------|-----|
| POST | `/api/auth/oidc/backchannel-logout` | Inbound OIDC Back-Channel Logout receiver (Dockhand 1.0.55+, #340): the identity provider POSTs a signed, form-encoded logout_token to end the sessions it names. Public by design, its only credential is the IdP's signature. An MCP client is never the IdP and holds no token to send, so there is no tool use case (same reasoning as GET /api/auth/oidc/callback). | docs/adr/0001-omission-registry.md |
| POST | `/api/exposure-status` | Dismisses the warning that the instance listens beyond localhost with authentication off and a writable Docker socket (Dockhand 1.0.55+, #340). Answers 403 whenever authentication is on, and when it is off the warning is the operator's only notice of an unauthenticated, Docker-socket-capable instance. Dismissing it is a human decision, not something an agent should do on the operator's behalf. The read side is get_exposure_status. | docs/adr/0001-omission-registry.md |
| POST | `/api/git/stacks/{id}/env-files` | Entfernt in #171 — read-only Aufgabe, redundant zu get_git_stack_env_files (GET) plus update_git_stack/update_stack_env für Änderungen. Kein zusätzliches Tool nötig. | docs/adr/0001-omission-registry.md |
| POST | `/api/git/stacks/{id}/webhook` | Eingehender Webhook-EMPFAENGER, kein aufrufbarer Vorgang: GitHub/GitLab rufen ihn mit einer Signatur bzw. einem Token auf, die der Handler prueft, und deployen damit den Git-Stack. Ein Agent hat weder die Signatur noch einen Grund, sie nachzubilden — fuer den absichtlichen Deploy gibt es deploy_git_stack, fuer die Webhook-Verwaltung get_git_stack_webhook (GET, vorhanden). Der Endpunkt taucht sonst dauerhaft als MISSING_TOOL auf und laesst den Luecken-Zaehler groesser aussehen, als er ist. | docs/adr/0001-omission-registry.md |

## Details

Der vollständige Report inkl. aller COVERED-Endpunkte und weiterer Prüfungen
(PARAM_MISMATCH, MISSING_ENCODE, QUERY_PARAM_*) entsteht bei jedem Lauf von
`node scripts/validate-mcp-tools.mjs` als `validation-report.md` (nicht eingecheckt).

