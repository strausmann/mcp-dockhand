# ADR-0003: Read/Write-Klassifizierung der Tools für Read-only-Modus und Tool-Filter

**Status:** accepted
**Datum:** 2026-10-23
**Refs:** #254 (Read-only-Modus und Tool-Filter), Design `docs/designs/2026-10-23-read-only-mode-design.md`, ADR-0002 (Shared-Endpoint-Tabelle)

## Kontext

mcp-dockhand registriert rund 390 Tools für jeden MCP-Client. Was ein Client darf, entscheidet
allein der Dockhand-Account, mit dem sich der Server anmeldet; in der Free Edition von Dockhand
ist jeder Benutzer Administrator. #254 verlangt einen serverseitigen Read-only-Modus
(`MCP_READ_ONLY`) und eine Möglichkeit, einzelne Tools auszublenden (`MCP_TOOLS_ALLOW`,
`MCP_TOOLS_DENY`). Beides setzt voraus, dass jedes Tool verlässlich als lesend oder
schreibend klassifiziert ist. Eine reine Namenskonvention (`get_*`, `list_*`) genügt dafür
nicht, und die HTTP-Methode allein auch nicht: `trigger_git_webhook` ist ein `GET`, der ein
Git-Stack-Deployment auslöst (siehe Shared-Endpoint-Tabelle in ADR-0002), während mehrere
`POST`-Tools nur validieren oder eine Vorschau liefern.

## Decision

1. **Regel.** `isReadOnly(name)` gilt, wenn der primäre Endpunkt des Tools in
   `TOOL_ENDPOINT_MAP` ein `GET` ist und das Tool nicht in `WRITE_GET_TOOLS` steht, oder wenn das
   Tool in `META_TOOL_NAMES` oder `READ_ONLY_POST_TOOLS` steht.
2. **Drei Ausnahmemengen** in `src/utils/tool-policy.ts` bzw. `src/utils/meta-tool-names.ts`:
   - `WRITE_GET_TOOLS` (`trigger_git_webhook`): `GET` mit Seiteneffekt.
   - `META_TOOL_NAMES` (bestehend): lokale Diagnose-Tools ohne Dockhand-Endpunkt.
   - `READ_ONLY_POST_TOOLS` (`validate_stack_compose`, `validate_stack_env`,
     `validate_stack_path`, `check_stack_path_change`, `preview_backup_restore`,
     `batch_get_selfhst_icons`, `list_git_remote_branches`): `POST` nur aus Transportgründen,
     ohne gespeichertes Ergebnis und ohne ausgehenden Seiteneffekt.
3. **Unbekannt ⇒ schreibend.** Ein Name, der in keiner Menge vorkommt, wird als Write
   behandelt. Für künftige Tools ist das verbindlich: neue `POST`/`PUT`/`PATCH`/`DELETE`-Tools
   brauchen keine Aktion und landen automatisch auf der sicheren Seite.
4. **Strenge Definition von „read-only“.** Nicht read-only sind alle `test_*`-Tools (echte
   Benachrichtigungen, LDAP-/Registry-/Git-/Secret-Provider-Verbindungen), `scan_image`,
   `scan_stacks`, `scan_all_vulnerabilities` (speichern Ergebnisse, laufen lange) und
   `check_container_updates` (überschreibt die Liste ausstehender Updates).
5. **GET-Snapshot-Guard.** Ein Test hält eine Snapshot-Liste aller `GET`-gemappten Lese-Tools.
   Ein neues `GET`-Tool lässt ihn fehlschlagen, bis es bewusst entweder in den Snapshot
   (lesend) oder in `WRITE_GET_TOOLS` aufgenommen wird. So fällt der nächste
   `trigger_git_webhook` auf. Ein zweiter Test stellt sicher, dass das Universum
   `keys(TOOL_ENDPOINT_MAP) ∪ META_TOOL_NAMES` den tatsächlich registrierten Namen entspricht
   und die drei Ausnahmemengen nur existierende Tools enthalten.
6. **Exakter Name lässt wieder zu.** Unter `MCP_READ_ONLY` nimmt nur ein exakter
   `MCP_TOOLS_ALLOW`-Name (ohne `*`) ein Write-Tool wieder auf. Muster tun das nie, damit ein
   Wildcard einen Read-only-Server nicht versehentlich erweitert. `MCP_TOOLS_DENY` gewinnt immer.
7. **Gefilterte Tools werden nicht registriert** und nicht erst beim Aufruf abgewiesen.
   Konfigurationsfehler (ungültiger `MCP_READ_ONLY`-Wert, ein Eintrag ohne Treffer, leere
   Endmenge) sind beim Start fatal.

## Options considered

- **Gewählt: Endpunkt-Methode plus drei explizite Ausnahmemengen.** Pro: nutzt die vorhandene
  `TOOL_ENDPOINT_MAP`, neue Tools werden automatisch klassifiziert, die Ausnahmen sind kurz,
  geprüft und per Test abgesichert. Contra: die Ausnahmemengen müssen gepflegt werden.
- **Klassifizierung nach Namenspräfix (`get_`/`list_`).** Pro: keine Pflege. Contra: erkennt
  `trigger_git_webhook` nicht und führt Tools mit irreführendem Namen ins Read-only.
- **Manuelle Liste aller Lese-Tools.** Pro: eindeutig. Contra: ein vergessener Eintrag
  blendet ein Lese-Tool aus, bei vielen Tools hoher Pflegeaufwand, neue Tools sind
  standardmäßig unklassifiziert.
- **Ablehnen beim Aufruf statt nicht zu registrieren.** Pro: Client sieht alle Tools. Contra:
  spart keine Tokens und verlangt einen zusätzlichen Pfad, der vergessen werden kann.

## Consequences

- `MCP_READ_ONLY=true` ist ein belastbares Versprechen: kein Tool ohne Lesecharakter wird
  registriert, außer über einen exakten Namen in `MCP_TOOLS_ALLOW`.
- Wer ein neues Tool hinzufügt, muss nur bei einem `GET` mit Seiteneffekt oder einem
  lesenden `POST` handeln; der Guard-Test erzwingt die Entscheidung bei neuen `GET`-Tools.
- Der Filter ergänzt Dockhand-RBAC, `MCP_AUTH_TOKEN` und `DOCKHAND_API_TOKEN` und ersetzt
  keines davon.
- Sensible **lesende** Tools (z.B. `dump_backup_snapshot_file`) bleiben im Read-only-Modus
  sichtbar; sie auszublenden ist Aufgabe von `MCP_TOOLS_DENY`.
- `docs/tools.md` wird aus derselben Klassifizierung generiert und in CI auf Aktualität geprüft;
  `get_tool_manifest` meldet dasselbe `mode` pro Tool.

## Linked

- Policy: `src/utils/tool-policy.ts`, `src/utils/meta-tool-names.ts` (`META_TOOL_NAMES`)
- Registrierung: `src/utils/tool-helper.ts` (`registerTool`)
- Tool-Liste: `docs/tools.md`, `scripts/generate-tool-list.mjs`
- Anwenderdoku: README, Abschnitt „Read-only mode and tool filter“
- Spec: `docs/designs/2026-10-23-read-only-mode-design.md`
- Vorbild: `docs/adr/0002-description-override-map.md` (Shared-Endpoint-Tabelle)
