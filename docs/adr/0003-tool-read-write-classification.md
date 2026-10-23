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
Git-Stack-Deployment auslöst (siehe Shared-Endpoint-Tabelle in ADR-0002), andere `GET`-Handler
starten Helper-Container oder führen `exec` im Container aus, während einige `POST`-Tools nur
validieren.

Die erste Fassung dieses ADR stützte sich auf einen unvollständigen Scan: geprüft wurden nur
die `registerTool`-Bodies in diesem Repo, nicht die aufgerufenen Helfer (`self_check` postet
`/api/environments/{id}/test`) und nicht die Upstream-Handler hinter einem `GET`. Das
Security-Review hat die Upstream-Handler am gepinnten Commit gelesen und die unten
aufgeführten Fälle gefunden; die Mengen sind entsprechend korrigiert.

Auch dieses Security-Review hat die `GET`-Handler nur stichprobenartig gelesen und weitere
Seiteneffekte übersehen. Ein anschließendes vollständiges Audit hat alle 172 damals lesenden
Tools bis in die Upstream-Helfer am gepinnten Commit verfolgt. Es fand ausgehende Zugriffe
(selfh.st-CDN, GitHub-/Forge-API, Registries, Template-Quellen, IdP-Discovery,
Backup-Repositories per restic, `git fetch`), `exec` im Container, Scanner-Container und
Cache-Schreibvorgänge. Außerdem schreibt `POST /api/auth/login` bei jedem Aufruf eine
Session-Zeile, `lastLogin` und einen Audit-Eintrag; die frühere Login-Probe-Ausnahme ist damit
nicht haltbar. Diese Fassung des ADR enthält die Korrekturen.

## Decision

1. **Regel.** `isReadOnly(name)` gilt, wenn der primäre Endpunkt des Tools in
   `TOOL_ENDPOINT_MAP` ein `GET` ist und das Tool nicht in `WRITE_GET_TOOLS` steht, oder wenn das
   Tool in `META_TOOL_NAMES` (und nicht in `WRITE_META_TOOLS`) oder in `READ_ONLY_POST_TOOLS`
   steht. „Lesend“ heißt streng: keine Zustandsänderung in Dockhand (DB, Audit, Dateien/Caches,
   Git-Clones), keine auf einem Docker-Host (kein Container anlegen/starten/`exec`/Pull) und
   kein ausgehender Netzwerkzugriff (Registries, CDNs, GitHub, Git-Remotes,
   Backup-Repositories), auch wenn die Gegenseite nur gelesen wird.
2. **Ausnahmemengen** in `src/utils/tool-policy.ts` bzw. `src/utils/meta-tool-names.ts`:
   - `WRITE_GET_TOOLS`: `GET` mit Seiteneffekt, je Eintrag mit Begründung im Code.
     Webhook-Trigger (deployen oder schreiben einen Audit-Eintrag): `trigger_git_webhook`,
     `get_git_stack_webhook`, `get_git_webhook`. Volume-Helper-Container (Image-Pull,
     Container anlegen/starten): `browse_volume`, `export_volume`, `get_volume_file_content`.
     `exec` im Container des Nutzers: `get_container_shells`, `get_container_top`,
     `list_container_files`, `get_container_file_content`. Backup-Helper-Container:
     `probe_backup_stack_dir`. Aus dem vollständigen Audit: selfh.st-CDN mit
     Icon-Cache-Schreiben (`get_selfhst_icon`, `get_selfhst_icon_manifest`), `git fetch`
     (`get_git_repository_sync_status`), Scanner-Container und Registry-Abfrage
     (`get_scanner_settings`), IdP-Discovery, Login-State-Cookie und Redirect zum IdP
     (`get_oidc_login_url`), GitHub-/Forge-API (`get_container_version_notes`),
     Registry-Abfragen mit gespeicherten Credentials (`get_registry_catalog`,
     `get_registry_tags`, `get_registry_tag_info`, `search_registry`), Template-Quellen
     (`list_templates`) und restic gegen das Backup-Repository samt Cache auf Dockhands Platte
     (`list_backup_snapshots`, `browse_backup_snapshot`, `download_backup_snapshot_file`,
     `dump_backup_snapshot_file`, `get_backup_snapshot_metadata`, `diff_backup_snapshots`).
   - `META_TOOL_NAMES` (bestehend): Diagnose-Tools ohne einzelnen Dockhand-Endpunkt.
   - `WRITE_META_TOOLS` (`check_for_update`, `validate_config`): Meta-Tools, die schreibend
     sind; in `classifyTool` vor der Meta-Regel geprüft. `check_for_update` ruft
     api.github.com auf, `validate_config` sendet absichtlich einen echten
     `POST /api/auth/login`.
   - `READ_ONLY_POST_TOOLS` (`validate_stack_env`, `validate_stack_path`,
     `check_stack_path_change`): `POST` nur aus Transportgründen, ohne gespeichertes Ergebnis,
     ohne Docker-Daemon-Aufruf und ohne ausgehende Anfrage. `validate_stack_compose` gehört
     nicht dazu: eine vom Aufrufer gelieferte Compose-Datei kann entfernte `include:`-Ressourcen
     enthalten, die `docker compose config` abrufen würde.
3. **Unbekannt ⇒ schreibend.** Ein Name, der in keiner Menge vorkommt, wird als Write
   behandelt. Für künftige Tools ist das verbindlich: neue `POST`/`PUT`/`PATCH`/`DELETE`-Tools
   brauchen keine Aktion und landen automatisch auf der sicheren Seite.
4. **Strenge Definition von „read-only“.** Nicht read-only sind alle `test_*`-Tools (echte
   Benachrichtigungen, LDAP-/Registry-/Git-/Secret-Provider-Verbindungen), `scan_image`,
   `scan_stacks`, `scan_all_vulnerabilities` (speichern Ergebnisse, laufen lange),
   `check_container_updates` (überschreibt die Liste ausstehender Updates),
   `list_git_remote_branches` (`git ls-remote` gegen eine frei wählbare URL mit gespeichertem
   Credential), `preview_backup_restore` (restic und Helper-Container) und
   `batch_get_selfhst_icons` (CDN-Abruf, Schreiben des Disk-Caches).
5. **`self_check` unter `MCP_READ_ONLY`.** Der Verbindungstest je Environment
   (`POST /api/environments/{id}/test`, derselbe Endpunkt wie `test_environment`) entfällt.
   Die Environments werden nur aus den `GET`-Aufrufen gemeldet, jeweils mit `tested: false`
   und `skipReason`; ein ungetestetes Environment verschlechtert `overall` nicht. Auch die
   Login-Probe (`POST /api/auth/login`) entfällt: `authValid` ergibt sich daraus, ob das
   authentifizierte `GET /api/environments` mit der bestehenden Session bzw. dem Token des
   Servers gelingt, und das Ergebnis trägt `authCheck: "session"` (sonst `"login-probe"`).
   Außerhalb von `MCP_READ_ONLY` läuft der Test weiter. Deshalb ist der *effektive* Modus von
   `self_check` dort `write` (`READ_ONLY_ADAPTIVE_TOOLS`, `effectiveMode()`): Annotationen und
   `get_tool_manifest` kündigen die POST-sendende Variante nie als lesend an. Die statische
   Einordnung (`classifyTool`), die `MCP_READ_ONLY` verwendet, bleibt `read`.
6. **Akzeptierte Ausnahmen (abschließend).** Die frühere Login-Probe-Ausnahme ist
   zurückgezogen. Zulässig unter `MCP_READ_ONLY` sind nur noch:
   - einmalige, datenlose Lazy-Initialisierung, die jede Dockhand-Installation ohnehin beim
     Start oder ersten Gebrauch ausführt: Anlegen der Icon-, Stacks- und Git-Repos-Verzeichnisse
     (`get_container_icon`, `get_stack_icon`, `get_git_stack_env_files`,
     `get_stack_delete_preview` und die Stack-Verzeichnis-Leser) sowie das einmalige Setzen der
     Backup-Instance-ID (`get_backup_instance_id`);
   - was jeder MCP-Aufruf unabhängig vom Tool mit sich bringt: der eigene Login des Servers beim
     Start und nach einem 401 sowie die `lastUsed`-Aktualisierung des Bearer-Tokens.
7. **Guard-Tests.**
   - GET-Snapshot: Ein Test hält eine Snapshot-Liste aller `GET`-gemappten Lese-Tools. Ein
     neues `GET`-Tool lässt ihn fehlschlagen, bis es bewusst entweder in den Snapshot (lesend)
     oder in `WRITE_GET_TOOLS` aufgenommen wird; dafür ist der Upstream-Handler samt
     aufgerufener Helfer zu lesen.
   - Universum: `keys(TOOL_ENDPOINT_MAP) ∪ META_TOOL_NAMES` entspricht den tatsächlich
     registrierten Namen.
   - Methoden: jeder `WRITE_GET_TOOLS`-Eintrag ist ein `GET`, jeder
     `READ_ONLY_POST_TOOLS`-Eintrag ein `POST`.
   - Kein Lese-Tool teilt `{method, path}` mit einem Write-Tool (hätte
     `get_git_stack_webhook` gefunden).
   - Meta-Tools: Jeder registrierte Handler aus `META_TOOL_NAMES` läuft gegen einen
     aufzeichnenden Fake-Client mit gestubbtem `fetch`, unter `MCP_READ_ONLY` und der
     Default-Policy. Unter `MCP_READ_ONLY` lässt jede Nicht-`GET`-Anfrage und jede Anfrage an
     einen anderen Host als Dockhand den Test fehlschlagen; unter der Default-Policy jede
     Nicht-`GET`-Anfrage außerhalb einer kommentierten Allowlist
     (`tests/tools/meta.read-only-guard.test.ts`).
8. **Exakter Name lässt wieder zu.** Unter `MCP_READ_ONLY` nimmt nur ein exakter
   `MCP_TOOLS_ALLOW`-Name (ohne `*`) ein Write-Tool wieder auf. Muster tun das nie, damit ein
   Wildcard einen Read-only-Server nicht versehentlich erweitert. `MCP_TOOLS_DENY` gewinnt immer.
9. **Gefilterte Tools werden nicht registriert** und nicht erst beim Aufruf abgewiesen.
   Konfigurationsfehler (ungültiger `MCP_READ_ONLY`-Wert, ein Eintrag ohne Treffer, leere
   Endmenge) sind beim Start fatal. Eine Variable, die einer der drei Policy-Variablen ähnelt,
   aber nicht exakt so heißt (`MCP_READONLY`), wird ignoriert; der Start loggt dazu eine
   Warnung.

## Options considered

- **Gewählt: Endpunkt-Methode plus explizite Ausnahmemengen.** Pro: nutzt die vorhandene
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

- `MCP_READ_ONLY=true` registriert kein Tool, dessen Handler am gepinnten Commit einen
  Seiteneffekt oder ausgehenden Zugriff hat, außer über einen exakten Namen in
  `MCP_TOOLS_ALLOW`; zulässig sind nur die in Punkt 6 aufgezählten Ausnahmen. Ein Seiteneffekt, den Upstream einem bestehenden Lese-Handler
  später hinzufügt, fällt keinem Test auf; der Snapshot erzwingt die Prüfung nur für neue
  `GET`-Tools.
- Wer ein neues Tool hinzufügt, muss nur bei einem `GET` mit Seiteneffekt oder einem
  lesenden `POST` handeln; der Guard-Test erzwingt die Entscheidung bei neuen `GET`-Tools.
- Einige Tools, die nach Lesen klingen (Volume-Browsing, Container-Dateiliste/-inhalt/`top`/
  Shells, Backup-Probes und Snapshot-Browsing, Git-Branch-Liste und Sync-Status, Icons,
  Registry-Suche/-Tags, Templates, Release-Notes, Scanner-Einstellungen, OIDC-Login-URL,
  Compose-Validierung, `check_for_update`, `validate_config`), fehlen im Read-only-Modus. Wer sie braucht,
  nimmt sie per exaktem Namen in `MCP_TOOLS_ALLOW` wieder auf.
- Der Filter ergänzt Dockhand-RBAC, `MCP_AUTH_TOKEN` und `DOCKHAND_API_TOKEN` und ersetzt
  keines davon.
- Sensible **lesende** Tools (z.B. `download_container_file`, `export_audit_log`) bleiben im
  Read-only-Modus sichtbar; sie auszublenden ist Aufgabe von `MCP_TOOLS_DENY`.
- `docs/tools.md` wird aus derselben Klassifizierung generiert und in CI auf Aktualität geprüft;
  `get_tool_manifest` meldet dasselbe `mode` pro Tool.

## Linked

- Policy: `src/utils/tool-policy.ts`, `src/utils/meta-tool-names.ts` (`META_TOOL_NAMES`)
- Registrierung: `src/utils/tool-helper.ts` (`registerTool`)
- Tool-Liste: `docs/tools.md`, `scripts/generate-tool-list.mjs`
- Anwenderdoku: README, Abschnitt „Read-only mode and tool filter“
- Spec: `docs/designs/2026-10-23-read-only-mode-design.md`
- Vorbild: `docs/adr/0002-description-override-map.md` (Shared-Endpoint-Tabelle)
