# camp-finder-data

Statische POI-Kacheln (Europa) für [Camp Finder](https://fenta23.github.io/stellplatz-maps-finder/).
Werden jede Woche per GitHub Actions aus den [Geofabrik](https://download.geofabrik.de)-Extrakten gebaut
und über GitHub Pages ausgeliefert. Das Build-Skript liegt in
[`stellplatz-maps-finder/scripts/poi-tiles`](https://github.com/fenta23/stellplatz-maps-finder/tree/main/scripts/poi-tiles).

## Lizenz

Die Daten stammen von © [OpenStreetMap-Mitwirkende](https://www.openstreetmap.org/copyright) und stehen unter der
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Die Kacheln sind eine
abgeleitete Datenbank und stehen unter derselben Lizenz.

## Format

- `manifest.json`: `version` (Build-Datum, auch Pfad-Präfix), `date`, `cellDeg` (0,25°),
  `tiles.{parking,rest}` (Liste der nicht-leeren Kacheln), `counts.{parking,rest}`, `attribution`
- `{version}/{layer}/{key}.json.gz`: gzip-JSON `[[t, id, lat, lon, tags], …]`
  - `t`: `n`/`w`/`r` (Node/Way/Relation), `lat`/`lon` als Mittelpunkt der Bounding Box (wie Overpass `out center`)
  - `key` = `floor(lat/0.25)_floor(lon/0.25)`
  - `parking`: `amenity=parking` ohne `motorhome=yes`; `rest`: alle übrigen eingebauten Filter
  - Entfernte Tags: `source*`, `note`, `fixme`, `check_date*`, `created_by`

## Bekannte Lücken

`osmium export` baut Flächen nur aus Multipolygon-Relationen. Andere Relationen fehlen, darunter viele
`sport=climbing`-Sites (`type=site`). Die Daten sind bis zu einer Woche alt.

## Stand

Siehe [`STAND.md`](STAND.md): Der Workflow schreibt sie nach jedem Build neu, mit Datum und POI-Zahlen. Der Commit ist
zugleich der Keepalive, denn GitHub deaktiviert Zeitpläne nach 60 Tagen ohne Repo-Aktivität. Die Laufzeiten stehen in den
Logs des Workflows *Build POI tiles*.
