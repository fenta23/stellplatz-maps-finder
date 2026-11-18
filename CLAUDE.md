# Stellpatz Maps Finder

## Stack
- **FE**: Vite + TypeScript + Leaflet, hosted on GitHub Pages
- **BE**: Supabase Edge Functions (Deno) — Overpass-Proxy, Cache, Geocode, Mapillary

## Commands
```
npm install       # deps
npm run dev       # Vite :5173 (API via VITE_API_BASE aus .env oder lokaler Proxy :54321)
npm test          # unit tests (Vitest, 1574 tests)
npm run test:int  # integration tests vs Edge Function
npm run build     # → dist/client/
```

## PWA
- SW via `vite-plugin-pwa`, nur in Production (dev übersprungen)
- API-Calls via `apiUrl()` (`src/client/core/config.ts`): relativ per Vite-Proxy, absolut per `VITE_API_BASE`
- Kein SW-Caching für API/Tiles

## Troubleshooting
Bekannte Störungen (OSM-Cloud-IP-Block, KI-Provider, Migrationen): `docs/troubleshooting.md`

## Dev ohne Docker
`.env` mit `VITE_API_BASE=https://<ref>.supabase.co/functions/v1` setzen → API geht direkt zur Production.

## Frontend (`src/client/`) — vertical slices
```
app/        main.ts (Wiring), session.ts (State), selection.ts, poiRefresher.ts, trackWiring.ts, trackPoiLoader.ts, routePlannerWiring.ts
core/       config.ts (apiUrl), template.ts (clone/ref), bind.ts (renderList)
features/
  menu/       SideMenu + clearAppCache
  map/        MapService + leafletAdapter + locationMarker + leafletTrackLayer; Basiskarten (Karte, Satellit, Fahrradkarte, Topo) mit Ebenen-Umschalter
  pois/       OverpassClient + poiTiles (statische Kacheln) + PoiMarkerManager + poiMeta
  poi-detail/ PoiDetailPanel + poiData (Bilder, Nearby, Notes)
  track/      Route-Import (GPX, Komoot-Link) + Routenberechnung (OSRM) `osrmRoute.ts` + Geometrie + TrackStore + TrackImportDialog + corridor + TrackPanel (POIs entlang der Route) + gpxExport; bis zu 10 gespeicherte Routen in `stellplatz:tracks`
  route-planner/ RoutePlannerPanel + PlaceField + TravelModeStore (Start/Ziel, Verkehrsmittel); Verdrahtung in `app/routePlannerWiring.ts`
  search/     SearchBar
  filters/    FilterPanel
  profile/    Profile Wandern/Radfahren/Camping (Presets, ProfileStore, ProfileDialog)
  favorites/  FavoritesStore (local + Supabase-Sync)
  notes/      NotesStore (local + Supabase-Sync)
  custom-pois/ CustomPoiStore (Editor, MarkerManager)
  auth/       AuthPanel (MagicLink + Google OAuth)
  info/       InfoPanel (Changelog, Open Source, Datenschutz)
  install/    InstallPrompt
  update/     UpdateBanner
  whats-new/  WhatsNewOverlay (Release-Overlay mit CSS-Konfetti) + WhatsNewStore
```
Slices importieren keine Interna anderer Slices — Verdrahtung in `app/`. Typen cross-slice ok.

## Backend (`supabase/functions/`)
```
api/        index.ts (Router + CORS) + *Handler.ts (7 Endpunkte)
_shared/    utils.ts (CORS, Query-Validation, BBox-Snap, Supabase-Client, Rate-Limiter)
```
- **POI-Cache**: Supabase Postgres (Tabelle `poi_cache`, BBox-Snap 0.2°, TTL 30 Tage)
- **CORS**: Erlaubt `fenta23.github.io`, `capacitor://localhost`, `http://localhost:5173` + `ALLOWED_ORIGINS`-Env
- Deploy: `npx supabase functions deploy api --no-verify-jwt`

## Routenplaner
- Berechnung per OSRM bei FOSSGIS (`routing.openstreetmap.de`), direkt aus dem Browser (kein Edge-Function-Proxy); Ergebnis wird wie ein Import als Route (Quelle „Geplant“) gespeichert
- Kill-Switch `ROUTE_PLANNING_ENABLED` in `features/track/osrmRoute.ts`; keine Navigation, `routed-foot` ist kein Wanderrouting

## POI-Kacheln
- Eingebaute Filter kommen aus statischen Kacheln (Daten-Repo `fenta23/camp-finder-data`, wöchentlich aus Geofabrik), eigene/KI-Filter live via Overpass; Fallback auf Overpass
- Build: `scripts/poi-tiles/` (importiert `DEFAULT_FILTERS`/`classifyElement`), Workflow-Vorlage in `scripts/poi-tiles/data-repo/`
- Ebenen: `rest` (immer), `parking`, `supply`, `food`, `lodging`, `bike` (nur solange ein Filter der Ebene aktiv ist); Zuordnung über `tileLayerOf` in `filterModel.ts`. Manifest-Feld `filters` sagt, welche Filter die Kacheln kennen – der Rest läuft live über Overpass
- Neuer eingebauter Filter: erst nach App-Merge **und** Kachel-Build im Daten-Repo aus Kacheln verfügbar
- Details + lokaler Test: `docs/troubleshooting.md#poi-kacheln`

## POI Types (Overpass)
- Parking → `amenity=parking`
- Camper → `tourism=camp_pitch` OR `amenity=parking` + `motorhome=yes`
- Campsite → `tourism=campsite`
- Dump → `amenity=sanitary_dump_station`
- Water → `amenity=water_point`
- Climbing → `sport=climbing`
- Hut / Shelter → `tourism=alpine_hut|wilderness_hut` / `amenity=shelter`
- Seit 3.0 zusätzlich (standardmäßig ausgeblendet): Trinkwasser, Friedhof (Wasser), Toilette, Supermarkt, Bäckerei, Unterkunft, Restaurant, Café, Fahrrad-Service, E-Bike-Laden – Selektoren in `DEFAULT_FILTERS` (`features/filters/filterModel.ts`), dort ist die einzige Quelle

## Principles
- Vanilla TypeScript, kein Framework
- `readonly`, pure functions, explizite Dependencies
- Jedes Feature hat Unit Tests
- **Jeder Bug bekommt einen Test** — ein Regressionstest, der den Bug reproduziert (gegen den alten Code rot, mit dem Fix grün), gehört zum Bugfix dazu
- Changelog in CHANGELOG.md (Keep a Changelog) — NACH jedem Commit/PR ergänzen, nicht erst am Ende!
