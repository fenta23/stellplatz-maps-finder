# 1. „POI“ bleibt das Code-Wort für Ort

- Status: angenommen
- Datum: 2026-11-22
- Issue: #113

## Kontext

Das Glossar (`GLOSSARY.md`) nennt die Sache **Ort** und **Eigener Ort** und meidet „POI“. Im Code sind Bezeichner aber englisch, und dort heißt es durchgehend `Poi`: `OsmPoi`, `CustomPoi`, die Slices `pois/`, `poi-detail/` und `custom-pois/`, die Tabellen `poi_cache` und `custom_pois` sowie die localStorage-Keys `stellplatz:custom-pois*`. Insgesamt sind das rund 190 Dateien mit über 2000 Stellen.

„Place“ fiele als englisches Wort für Ort aus, weil es im Code schon für **Suchtreffer** steht (`PlaceSuggestion`, `PlaceField`).

Eine Umbenennung beträfe nicht nur Typen, sondern auch Datenbanktabellen und gespeicherte Daten bei den Nutzern. Dafür bräuchte es Migrationen, und der Gewinn wäre allein sprachlich.

## Entscheidung

Im Code bleibt „POI“ das Wort für **Ort**:

| Glossar | Code |
|---|---|
| Ort | `Poi`, `OsmPoi` |
| Eigener Ort | `CustomPoi` |
| Suchtreffer | `PlaceSuggestion` |

In der Oberfläche, im Changelog, in Issues und in der Doku heißt es weiter „Ort“ bzw. „Eigener Ort“.

## Konsequenzen

- Es wird nichts umbenannt, und es gibt kein Refactor-Ticket.
- „_Avoid_: POI“ im Glossar gilt für die Fachsprache (UI, Texte, Gespräche), nicht für Code-Bezeichner.
- Neue Code-Bezeichner für Orte folgen dem bestehenden Muster (`…Poi…`), nicht „Place“, „Spot“ oder „Location“.
