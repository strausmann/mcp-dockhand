# Architecture Decision Records (ADR)

Dieses Verzeichnis dokumentiert Architektur-Entscheidungen für mcp-dockhand — jede Datei ein
ADR nach dem Schema `NNNN-<slug>.md`.

## Registry

| Nr. | Titel | Status | Datum |
|-----|-------|--------|-------|
| [0001](0001-omission-registry.md) | Omission-Registry für bewusst nicht gespiegelte Dockhand-Endpunkte | accepted | 2026-08-10 |
| [0002](0002-description-override-map.md) | Description-override map for shared-endpoint tools | accepted | 2026-08-10 |

## Wann ein ADR anlegen?

Bei jeder Entscheidung, die künftige Beiträge nachhaltig prägt und deren Begründung sonst nur
im Kopf einer einzelnen Person oder verstreut in Commit-Messages existieren würde — z.B.
neue Governance-Mechanismen (wie die Omission-Registry), bewusste Architektur-Abweichungen
vom naheliegenden Standardweg, oder Entscheidungen, die später leicht falsch nachgeahmt
werden könnten, wenn der Grund dafür nicht dokumentiert ist.

## Format

Jedes ADR trägt einen Status (`accepted`, `superseded`, ...), Datum, Kontext, Entscheidung und
Konsequenz — siehe [0001](0001-omission-registry.md) als Vorlage.
