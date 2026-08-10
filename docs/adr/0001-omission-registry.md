# ADR-0001: Omission-Registry für bewusst nicht gespiegelte Dockhand-Endpunkte

**Status:** accepted
**Datum:** 2026-08-10
**Refs:** #57 (P3-Plan), #171 (env-files-Removal), #164 (Backup-API — echte Lücke, KEINE Omission)

## Kontext

`scripts/validate-mcp-tools.mjs` vergleicht bei jedem Lauf die Endpunkte im generierten
Dockhand-API-Schema (`docs/dockhand-api-schema.json`) mit den tatsächlich registrierten
MCP-Tools (`src/tools/*.ts`). Jeder Endpunkt ohne Tool erzeugt einen `MISSING_TOOL`-Fund
(informativ, kein CI-Gate) — sichtbar in `validation-report.md` und in der eingecheckten
`docs/coverage.md`.

Zwei grundverschiedene Situationen erzeugen denselben `MISSING_TOOL`-Fund:

1. **Echte Lücke** — der Endpunkt existiert, ein Tool dafür ist geplant, aber (noch) nicht
   gebaut. Beispiel: die komplette Backup-API (`/api/backup/*`), 29 Endpunkte, Tracking-Issue
   #164.
2. **Bewusste Auslassung** — wir werden NIE ein Tool dafür bauen, aus einem dokumentierten
   Grund (Sicherheit, Redundanz, technische Eignung). Beispiel: `POST
   /api/git/stacks/{id}/env-files` wurde in #171 als eigenes Tool entfernt, weil es
   read-only-redundant zu `get_git_stack_env_files` (GET) plus `update_git_stack`/
   `update_stack_env` für Schreib-Operationen war.

Vor diesem ADR gab es dafür zwei getrennte, unvollständige Mechanismen:

- `IGNORED_PATTERNS` in `validate-mcp-tools.mjs` — ein Array von Pfad-Substrings (Streams,
  Debug, Self-Update, ...), das betroffene Endpunkte VOR der `MISSING_TOOL`-Berechnung
  herausfiltert und nur als aggregierte Zahl (`excludedCount`) zählt. Kein Grund, kein
  Zeitstempel, keine Nachvollziehbarkeit pro Endpunkt — nur ein Musterausdruck im Code.
- Für endpunkt-genaue Einzelfälle wie `POST /api/git/stacks/{id}/env-files` gab es GAR
  KEINEN Mechanismus — der Endpunkt tauchte schlicht als `MISSING_TOOL` auf, ununterscheidbar
  von einer echten Lücke wie der Backup-API.

Das Problem: ohne Unterscheidung sieht ein Betrachter von `docs/coverage.md` 37
`MISSING_TOOL`-Einträge und kann nicht erkennen, welche davon tatsächlich noch zu bauen
sind (#164, priorisierbar) und welche für immer offen bleiben werden (kein Backlog-Posten).

## Entscheidung

Wir führen eine maschinenlesbare **Omission-Registry** (`docs/omitted-endpoints.json`) ein:
ein JSON-Array von Einträgen `{ method, path, reason, adr, date }`, je einer pro bewusst
NICHT gespiegeltem Endpunkt.

`scripts/lib/omission-registry.mjs` (`partitionMissingTools()`) trennt die rohen
`MISSING_TOOL`-Funde aus `computeValidation()` anhand dieser Registry in:

- **`realGaps`** — kein Registry-Treffer. Verhält sich exakt wie das bisherige
  `MISSING_TOOL` (feuert in derselben Stelle, gleiches Exit-Code-Verhalten — `MISSING_TOOL`
  war nie Teil von `hasCriticalErrors()` und bleibt es nicht).
- **`deliberatelyOmitted`** — Registry-Treffer, angereichert mit `reason`/`adr`. Erscheint
  in `docs/coverage.md` UNTER EINEM EIGENEN, SICHTBAREN Abschnitt ("Deliberately omitted
  (with reason)") — kein stilles Verschwinden, sondern eine dokumentierte, nachvollziehbare
  Entscheidung.

### Verhältnis zu `IGNORED_PATTERNS`

`IGNORED_PATTERNS` bleibt für **breite, musterbasierte** Ausschlüsse bestehen (z.B. `/stream`
matcht alle vier SSE-Stream-Endpunkte, `/api/debug/` würde jeden künftigen Debug-Endpunkt
mitausschließen, ohne dass jemand die Registry pflegen muss). Diese Endpunkte werden bereits
VOR der `MISSING_TOOL`-Berechnung herausgefiltert (`excludedCount`) — sie erreichen
`partitionMissingTools()` nie und werden dort folglich auch nicht doppelt unterdrückt.

Die Omission-Registry ist trotzdem die **Single Source of Truth für die Begründung**: alle
22 aktuell über `IGNORED_PATTERNS` ausgeschlossenen Endpunkte (Stand 2026-08-10, siehe
`docs/omitted-endpoints.json`) sind zusätzlich als Registry-Eintrag dokumentiert — mit
individueller Begründung statt nur einem Kommentar neben einem Pfad-Substring im Code. Für
diese 22 wirkt der Ausschluss weiterhin über `IGNORED_PATTERNS` (technischer Mechanismus,
unverändert); die Registry liefert nur die für Menschen lesbare Begründung UND die
`docs/coverage.md`-Sichtbarkeit. Für endpunkt-genaue Einzelfälle wie `POST
/api/git/stacks/{id}/env-files`, die NICHT über ein Pfad-Muster erfasst werden (der Pfad ist
nicht Teil einer größeren, ebenfalls auszuschließenden Familie), ist die Registry über
`partitionMissingTools()` der EINZIGE Unterdrückungsmechanismus.

**Faustregel für neue Einträge:** eine ganze Endpunkt-FAMILIE (Streams, Debug, Self-Update,
...) → `IGNORED_PATTERNS`-Pattern ergänzen UND Registry-Einträge für die betroffenen
Endpunkte anlegen (Begründung). Ein EINZELNER Endpunkt ohne verwandte Geschwister → nur
Registry-Eintrag, kein neues `IGNORED_PATTERNS`-Pattern nötig.

### Was NIEMALS in die Registry gehört

Eine geplante, aber noch nicht gebaute API-Fläche — auch wenn sie groß ist (Backup-API #164,
29 Endpunkte). Ein Registry-Eintrag bedeutet "wir bauen das NIE", nicht "wir haben es noch
nicht gebaut". Eine versehentliche Registrierung würde `MISSING_TOOL` für einen echten
Rückstand fälschlich zum Schweigen bringen — genau das Risiko, das `#164` in Task P3.7
(dieses ADR) explizit als Gegenbeispiel benannt hat.

## Konsequenz

- `docs/coverage.md` zeigt ab sofort einen eigenen Abschnitt "Deliberately omitted (with
  reason)" für Registry-Treffer — getrennt vom "MISSING_TOOL — nach Bereich"-Abschnitt, der
  nur noch `realGaps` enthält.
- `MISSING_TOOL`-Zahl in `docs/coverage.md`/`validation-report.md` sinkt entsprechend um die
  Anzahl der Registry-Treffer unter den aktuellen `MISSING_TOOL`-Funden (aktuell: 1 —
  `POST /api/git/stacks/{id}/env-files`; die übrigen 22 Registry-Einträge waren bereits über
  `IGNORED_PATTERNS` ausgeschlossen und tauchten nie als `MISSING_TOOL` auf).
- Ein neuer bewusster Ausschluss braucht ab jetzt IMMER einen Registry-Eintrag mit
  Begründung — kein stiller Codepfad mehr, der einen Endpunkt einfach verschwinden lässt.
- Dieses ADR etabliert zugleich die ADR-Praxis in diesem Repo (`docs/adr/`, Registry unter
  `docs/adr/README.md`) für künftige Architektur-Entscheidungen.

## Verlinkung

- Registry: `docs/omitted-endpoints.json`
- Implementierung: `scripts/lib/omission-registry.mjs` (`partitionMissingTools()`)
- Wiring: `scripts/validate-mcp-tools.mjs` (`computeValidation()`, 4. Parameter `registry`)
- Sichtbarkeit: `scripts/lib/coverage-report.mjs` (`buildCoverageDoc()`, Abschnitt
  "Deliberately omitted (with reason)")
- Tests: `tests/omission-registry.test.ts`
- Tracking-Issue echte Lücke (KEINE Omission): #164 (Backup-API, 29 fehlende Tools)
- Auslöser-Removal: #171 (`POST /api/git/stacks/{id}/env-files`)
