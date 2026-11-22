# 🅿️ Stellpatz Finder

> ⚠️ **Absolute Spielwiese.** Dieses Projekt dient ausschließlich zum Experimentieren und Ausprobieren — kein Produktions-Code, keine Garantien, keine Support-Versprechen. Alles kann sich jederzeit ändern oder wegfallen.

Kartenbasierte Web-App für **Wandernde**, **Radfahrende** und **Camper**: Parkplätze, Stellplätze, Campingplätze, Hütten, Trinkwasser, Einkehr und mehr im aktuellen Kartenausschnitt — alles auf Basis von OpenStreetMap, ohne proprietäre APIs. Ein **Profil** (Wandern, Radfahren, Camping) blendet genau die Filter ein, die du brauchst.

![Stellpatz Finder Screenshot](https://placehold.co/900x500/4B5640/fff?text=Stellpatz+Finder)

## Features

- 🧑‍🤝‍🧑 **Profile** (ab 3.0) — Wandern, Radfahren und Camping einzeln oder kombiniert wählen: die passenden eingebauten Filter werden eingeblendet, die übrigen ausgeblendet. Beim ersten Start im Willkommens-Assistenten, später über „Profil“ im Menü oder in „Filter verwalten“; eigene Filter bleiben unberührt
- 🗺️ **Interaktive Karte** (Leaflet) mit automatischem POI-Laden beim Scrollen/Zoomen — Kartenstil **CARTO Voyager** (clean, erdig) + wählbare Kartenebenen über „Ebenen“: **Satellit** (Esri), **Fahrradkarte** (OpenCycleMap bzw. CyclOSM) und **Topografische Karte** (OpenTopoMap); die Auswahl wird gemerkt
- 🅿️ **Parkplätze** (öffentlich vs. privat unterschieden), 🚐 **Camper-Stellplätze**, ⛺ **Campingplätze**, 🚿 **Entsorgungsstationen**, 🚰 **Frischwasserpunkte**
- 🔍 **Suchbox** mit Nominatim-Autocomplete (viewport-basiert); klappt auf für Routenplanung und KI-Suche (angemeldet)
- 🛣️ **Routen importieren oder planen** — Komoot-Link oder GPX laden, oder in der Suchbox Start und Ziel festlegen (Ortssuche, „Mein Standort“, Punkt auf der Karte, oder im POI-Detail „Als Start“/„Als Ziel“) und Fuß, Rad oder Auto wählen. Die Route erscheint auf der Karte; die Orte entlang der Strecke werden nach Kilometern gelistet (Abstand und Abschnitt einstellbar, GPX-Export), bis zu zehn Routen bleiben lokal gespeichert
- 🧭 **Navigation** per Deep-Link an Google Maps bzw. Apple Maps — die App navigiert nicht selbst (kein Turn-by-Turn)
- ❤️ **Favoriten** — Herz-Button im Panel, Herz-Badge auf dem Marker; paginierte Favoriten-Liste im Menü („⭐ Favoriten") mit Tippen → zentrieren. Lokal in localStorage, bei Login zu Supabase synchronisiert (geräteübergreifend)
- 📝 **Persönliche Notizen** — eigenes Notizfeld pro Ort im Detailpanel; paginierte Notizen-Liste im Menü („📝 Notizen"). Lokal + bei Login zu Supabase synchronisiert
- 📸 **Bilder** aus OSM-Tags, Wikimedia Commons und Mapillary
- 📍 **In der Nähe**: Tankstelle, Supermarkt, Apotheke, Bäckerei, Frischwasser, Entsorgung (bis 2 km)
- 📝 **Community-Hinweise** aus der OSM Notes API
- 🕐 **Öffnungsstatus-Badge** (parst `opening_hours`-Tag live)
- 📱 **Installierbare PWA** — Home-Bildschirm, Offline-Shell, „Cache leeren & neu laden" im Info-Panel
- 🔒 Kein Google; läuft ohne API-Keys (Mapillary & Supabase optional)

## Tech Stack

| Schicht | Technologie |
|---|---|
| Karte | [Leaflet](https://leafletjs.com) + [markercluster](https://github.com/Leaflet/Leaflet.markercluster) · [CARTO Voyager](https://carto.com) / [Esri](https://www.esri.com) / [Thunderforest](https://www.thunderforest.com) / [CyclOSM](https://www.cyclosm.org) / [OpenTopoMap](https://opentopomap.org) Tiles |
| POI-Daten | [Overpass API](https://overpass-api.de) (OpenStreetMap) |
| Geocoding | [Nominatim](https://nominatim.org) |
| Routenberechnung | [OSRM](https://project-osrm.org) bei [FOSSGIS](https://routing.openstreetmap.de) (OpenStreetMap-Daten), direkt aus dem Browser |
| Navigation | Deep-Link an Google Maps / Apple Maps |
| Frontend | Vanilla TypeScript, [Vite](https://vite.dev), PWA ([vite-plugin-pwa](https://vite-pwa-org.netlify.app)) |
| Backend | [Supabase Edge Functions](https://supabase.com/edge-functions) (Deno) — Proxy + Cache |
| Persistenz | [Supabase](https://supabase.com) Postgres — persistenter POI-Cache, Auth (Magic-Link), Favoriten + Notizen (RLS) |
| Hosting | [GitHub Pages](https://pages.github.com) (statischer Build) |

## Lokale Entwicklung

```bash
# Abhängigkeiten installieren
npm install

# Supabase lokal starten (braucht Docker)
supabase start

# Entwicklungsserver starten (Vite :5173 + Edge Functions :54321)
npm run dev

# Tests ausführen
npm test
```

Öffne [http://localhost:5173](http://localhost:5173) im Browser.

**Optionale Umgebungsvariablen** (`.env` aus `.env.example` kopieren):
```
MAPILLARY_ACCESS_TOKEN=   # Mapillary Street-Level-Fotos aktivieren
SUPABASE_URL=             # für Overpass-Cache (optional)
SUPABASE_SERVICE_KEY=     # service_role key
```

## Deployment

### Frontend (GitHub Pages)

Bei jedem Push auf `main` baut die GitHub Action und deployt automatisch:

1. https://github.com/fenta23/stellplatz-maps-finder/settings/secrets/actions → folgende Secrets setzen:
   - `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
2. Variable setzen:
   - `VITE_API_BASE` = `https://<project>.supabase.co/functions/v1`

### Backend (Supabase Edge Functions)

```bash
supabase login
supabase link --project-ref <deine-ref>
supabase functions deploy api --no-verify-jwt
supabase secrets set MAPILLARY_ACCESS_TOKEN=...
```

`SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` sind automatisch in der Edge Function Runtime verfügbar.

## Als App installieren (PWA)

Die App ist eine **Progressive Web App** — installierbar auf Handy & Desktop.

- **Android / Chrome / Edge:** „Installieren"-Button oben rechts oder Browser-Menü → „App installieren".
- **iOS / Safari:** Teilen-Symbol → „Zum Home-Bildschirm".

Service Worker lokal testen:
```bash
npm run build && npx serve dist/client
```

App-Icon ändern: `public/logo.svg` anpassen, dann `npm run generate-pwa-assets`.

## Später: native App via Capacitor

```bash
npm i -D @capacitor/cli @capacitor/core
npx cap init
# webDir auf dist/client zeigen
# VITE_API_BASE auf GitHub Pages URL setzen
npx cap add ios / add android
```

## Architektur

```
Browser (GitHub Pages)
  │
  ├── GET /            → dist/client/ (Vite-Build, Leaflet-App)
  └── GET/POST /api/** → Supabase Edge Function `api`
                            ├── /api/overpass   → Overpass API (gecached via Postgres)
                            ├── /api/geocode    → Nominatim
                            ├── /api/nearby     → Overpass API
                            ├── /api/mapillary  → Mapillary Graph API (20 req/min limitiert)
                            └── /api/notes      → OSM Notes API
```

Die Edge Function cached Overpass-Antworten via Supabase Postgres (BBox-Snapping auf 0,05°-Raster, TTL 7 Tage).

### Supabase (persistenter Cache, Login, Favoriten, Notizen)

1. Supabase-Projekt anlegen → **Project Settings → API**: Project URL + Keys holen
2. Migrationen im **SQL Editor** ausführen: alle unter `supabase/migrations/` (poi_cache, favorites, notes, custom_pois)
3. Env-Vars setzen:
   - Edge Function: `MAPILLARY_ACCESS_TOKEN` via `supabase secrets set`
   - Client (Login + Favoriten): `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (Build-Zeit)
4. **Authentication → URL Configuration**: Site URL + Redirect-URLs eintragen

#### Login-Methoden

- **Google (OAuth, ohne Mailversand — empfohlen):**
  1. [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services → Credentials** → „Create OAuth client ID" → Typ **Web application**.
  2. **Authorized redirect URI**: `https://<project-ref>.supabase.co/auth/v1/callback`
  3. Client-ID + Secret in **Supabase → Authentication → Providers → Google** eintragen.
  4. GitHub Pages-URL in Redirect-Allowlist eintragen.
- **Magic-Link (E-Mail):** funktioniert ohne Setup, hängt am Mailversand (Rate-Limit) → eigenes SMTP für Produktion.

## Datenquellen & Lizenzen

Alle Kartendaten © [OpenStreetMap-Mitwirkende](https://www.openstreetmap.org/copyright), lizenziert unter [ODbL](https://opendatacommons.org/licenses/odbl/).  
Bilder: © jeweilige Urheber (Wikimedia Commons / Mapillary).

## Contributing

Issues und PRs willkommen. Bitte für jedes Feature einen eigenen Branch anlegen (`feat/...`) und einen PR gegen `main` öffnen.
