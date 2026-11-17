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
  `tiles.<layer>` (Liste der nicht-leeren Kacheln), `counts.<layer>`, `filters.<layer>` (Filter-IDs, die der Layer enthält),
  `attribution`. Layer: `parking`, `rest`, `supply`, `food`, `lodging`, `bike`
- `{version}/{layer}/{key}.json.gz`: gzip-JSON `[[t, id, lat, lon, tags], …]`
  - `t`: `n`/`w`/`r` (Node/Way/Relation), `lat`/`lon` als Mittelpunkt der Bounding Box (wie Overpass `out center`)
  - `key` = `floor(lat/0.25)_floor(lon/0.25)`
  - `parking`: `amenity=parking` ohne `motorhome=yes`; `rest`: Camper, Camping, Entsorgung, Wasser, Klettern, Hütte,
    Schutzhütte; `supply`: Trinkwasser, Friedhof, Toilette, Supermarkt, Bäckerei; `food`: Restaurant, Café;
    `lodging`: Unterkunft; `bike`: Fahrrad-Service, E-Bike-Laden (Quelle der Zuordnung: `tileLayerOf` in `filterModel.ts`)
  - Ein Objekt steht in jedem Layer, dessen Filter es trifft (Hotel + Restaurant: `lodging` und `food`). Ausnahme: Was
    `rest` trifft, steht nicht in `parking`
  - Entfernte Tags: `source*`, `note`, `fixme`, `check_date*`, `created_by`

## Workflow aktualisieren

`.github/workflows/build.yml` in diesem Repo ist eine Kopie der Vorlage aus dem App-Repo
(`scripts/poi-tiles/data-repo/`). Änderungen an der Vorlage müssen **von Hand** hierher kopiert werden.

Der alte Workflow läuft mit dem neuen Build-Skript weiter, denn er checkt das App-Repo (Default-Branch) aus und ruft
dessen `build.ts` auf; fehlende Mindestmengen sind 0, und `STAND.md` liest nur `counts.parking/rest` und
`tiles.parking/rest`, die unverändert da sind. Er liefert dann aber alle sechs Layer ohne Mindestmengen für die vier
neuen und `STAND.md` zeigt nur Parkplatz und Rest. Eine längere Laufzeit, ein größerer Zwischenstand auf der Platte
und mehr Speicher beim Kachelbau sind möglich und im Workflow nicht geprüft. Nach dem ersten Build die Mindestmengen
`POI_TILES_MIN_{SUPPLY,FOOD,LODGING,BIKE}` im Workflow auf etwa die Hälfte der gebauten Zahlen setzen.

## Bekannte Lücken

`osmium export` baut Flächen nur aus Multipolygon-Relationen. Andere Relationen fehlen, darunter viele
`sport=climbing`-Sites (`type=site`). Die Daten sind bis zu einer Woche alt.

## Stand

Siehe [`STAND.md`](STAND.md): Der Workflow schreibt sie nach jedem Build neu, mit Datum und POI-Zahlen. Der Commit ist
zugleich der Keepalive, denn GitHub deaktiviert Zeitpläne nach 60 Tagen ohne Repo-Aktivität. Die Laufzeiten stehen in den
Logs des Workflows *Build POI tiles*.
