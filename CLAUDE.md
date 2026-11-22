# Stellpatz Maps Finder

## Stack
- **FE**: Vite + TypeScript + Leaflet, hosted on GitHub Pages
- **BE**: Supabase Edge Functions (Deno) — Overpass-Proxy, Cache, Geocode, Mapillary

## Commands
```
npm install       # deps
npm run dev       # Vite :5173 (API via VITE_API_BASE aus .env oder lokaler Proxy :54321)
npm test          # unit tests (Vitest, 1834 tests)
npm run test:int  # integration tests vs Edge Function
npm run typecheck # tsc --noEmit, läuft im CI (PR-Check `ci.yml` + vor dem Deploy)
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
app/        main.ts (Wiring), session.ts (State), selection.ts, poiRefresher.ts, routeWiring.ts, routePoiLoader.ts, routePlannerWiring.ts, routeEditWiring.ts, searchBoxWiring.ts (Koordinator Suchbox), uiCollapse.ts, placeSuggest.ts, aiFilterApply.ts (KI-Suche ersetzt Filter, mit Rückweg)
core/       config.ts (apiUrl), template.ts (clone/ref), bind.ts (renderList), travelMode.ts (Verkehrsmittel), PlaceField (Ortsfeld mit Vorschlägen)
features/
  menu/       SideMenu + clearAppCache
  map/        MapService + leafletAdapter + locationMarker + leafletRouteLayer; Basiskarten (Karte, Satellit, Fahrradkarte, Topo); Kartenknöpfe als Leiste rechts oben (Ebenen, Standort, Route importieren), Zoom nur ohne Touch, Attribution links unten
  pois/       OverpassClient + poiTiles (statische Kacheln) + PoiMarkerManager + poiMeta
  poi-detail/ PoiDetailPanel + poiData (Bilder, Nearby, Notes)
  route/      Route-Import (GPX, Komoot-Link) + Routenberechnung (OSRM) `osrmRoute.ts` + Geometrie + RouteStore + RouteImportDialog + corridor + RoutePanel (POIs entlang der Route) + gpxExport; bis zu 10 gespeicherte Routen in `stellplatz:tracks`
  route-planner/ RoutePlannerPanel (Formular im Slot der Suchbox) + TravelModeStore (Start/Ziel, Verkehrsmittel); PlaceField liegt in `core/`; Verdrahtung in `app/routePlannerWiring.ts`
  search/     SearchBox (aufklappbar: Suchzeile + Modi Route/KI)
  ai/         AiClient, intentSchema (Allowlist; Intent = Ort, Filter, Route), AiSearchDialog (KI-Suche in der Suchbox)
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
- Berechnung per OSRM bei FOSSGIS (`routing.openstreetmap.de`), direkt aus dem Browser (kein Edge-Function-Proxy); Einstieg über die Suchbox (Route-Knopf, „Route hierher“, Import-Dialog „Route planen“); Ergebnis wird wie ein Import als Route (Quelle „Geplant“) gespeichert
- KI-Routenwunsch (`intent.route`) belegt Start/Ziel/Verkehrsmittel nur vor (`planFromNames`), berechnet wird erst auf Knopfdruck; Prompt in `supabase/functions/api/aiHandler.ts` – Änderungen dort brauchen `npm run deploy:edge`
- Geplante Routen sind auf der Karte änderbar: Linie ziehen = Zwischenpunkt (max. 10), Start/Ziel/Zwischenpunkt-Griffe verschieben, Tipp auf Zwischenpunkt entfernt ihn. Der Plan (Punkte + Verkehrsmittel) liegt als `plan` an der Route; eine Anfrage pro Loslassen, ersetzt dieselbe Route (`RouteStore.replace`). Logik: `features/route/routeEdit.ts`, Griffe: `features/map/routeEditHandles.ts`, Verdrahtung: `app/routeEditWiring.ts`. GPX/Komoot und Routen ohne `plan` bleiben unveränderlich
- Kill-Switch `ROUTE_PLANNING_ENABLED` in `features/route/osrmRoute.ts` (schaltet auch das Ändern ab); keine Navigation, `routed-foot` ist kein Wanderrouting

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
- **Eingabefelder (input/textarea/select) immer mit font-size ≥ 16px** — sonst zoomt iOS beim Fokus und zoomt nicht zurück. Basisregel in `styles/shell.css`, geprüft von `styles/inputZoom.test.ts` (scannt alle CSS-Dateien + `index.html`)
- Changelog in CHANGELOG.md (Keep a Changelog) — NACH jedem Commit/PR ergänzen, nicht erst am Ende!

## Agent skills

### Issue tracker

Issues liegen in GitHub Issues (fenta23/stellplatz-maps-finder), Zugriff per `gh`-CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Standard-Vokabular: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` im Repo-Root (werden bei Bedarf angelegt). See `docs/agents/domain.md`.
