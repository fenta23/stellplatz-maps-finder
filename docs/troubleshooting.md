# Troubleshooting

Hier stehen Störungen, die schon einmal aufgetreten sind: woran man sie erkennt, wie man sie eingrenzt und wie man sie behebt.

## Schnell-Diagnose

| Symptom | Wahrscheinliche Ursache | Abschnitt |
|---|---|---|
| Ortssuche findet nichts, `/api/geocode` → `403` | Nominatim blockt Cloud-IPs | [OSM-Dienste blocken Cloud-IPs](#osm-dienste-blocken-cloud-ips) |
| Karte bleibt leer, keine POI-Marker | Overpass blockt Cloud-IPs | [OSM-Dienste blocken Cloud-IPs](#osm-dienste-blocken-cloud-ips) |
| Eingebaute POIs laden wieder langsam (9–19 s), Konsole: `POI tiles failed, falling back to Overpass` | POI-Kacheln nicht erreichbar | [POI-Kacheln](#poi-kacheln) |
| POI-Stand im Info-Panel älter als eine Woche | Wöchentlicher Kachel-Build gescheitert | [POI-Kacheln](#poi-kacheln) |
| Routenplaner: „… gerade ausgelastet“ (429) bzw. „… gerade nicht erreichbar“ (5xx, Timeout) | FOSSGIS-OSRM überlastet oder down | [Routenplaner (FOSSGIS-OSRM)](#routenplaner-fossgis-osrm) |
| KI-Suche: „Die KI-Suche ist gerade nicht erreichbar.“ | KI-Provider lehnt ab (Key, Guthaben, Secrets) | [KI-Provider-Ausfall](#ki-provider-ausfall) |
| POI-Zusammenfassung fehlt, `/api/ai` → `502` | dto. | [KI-Provider-Ausfall](#ki-provider-ausfall) |
| KI-Suche: „Das habe ich nicht verstanden …“ | Modell liefert unbrauchbares JSON (seit #90 kein Provider-Fehler mehr) | Prompt bzw. Modell prüfen |

---

## OSM-Dienste blocken Cloud-IPs

**Vorgekommen:** Overpass im September 2026 (#86, #87), Nominatim am 2026-10-02 (#88).

**Symptom:** Ein Edge-Function-Endpoint, der einen OSM-Dienst aufruft, antwortet mit `403`/`406`, z. B. `{"error":"Nominatim error"}`. Unser Code reicht dabei nur den Fehler des Upstreams durch.

**Ursache:** Die öffentlichen Overpass-Mirrors und Nominatim lehnen Anfragen von Rechenzentrums-IPs ab (Supabase Edge, GitHub Actions). Von Nutzer-IPs aus funktioniert dieselbe Anfrage normal, auch mit demselben User-Agent.

**Diagnose:** Dieselbe Anfrage per `curl` vom eigenen Rechner direkt an den Upstream schicken:

```
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://nominatim.openstreetmap.org/search?q=rochlitz&format=json&limit=6"
```

Kommt lokal `200` und über die Edge Function `403`, ist es dieser Block.

**Lösung:** Den Dienst direkt aus dem Browser aufrufen und nicht über den Proxy. Beide Dienste senden CORS-Header.

| Dienst | Client-Code | Verwendet von |
|---|---|---|
| Overpass (POIs) | `src/client/core/overpassFetch.ts` | `OverpassClient`, `nearbyClient` |
| Nominatim | `src/client/core/nominatim.ts` | Suchleiste, KI-Suche, Google-Maps-Import, Ortsfelder im Routenplaner |
| OSRM bei FOSSGIS (`routing.openstreetmap.de`) | `src/client/features/track/osrmRoute.ts` | Routenplaner (`app/routePlannerWiring.ts`) |

`/api/overpass`, `/api/nearby` und `/api/geocode` gibt es serverseitig noch, der Client ruft sie aber nicht mehr auf. Beim Import gilt weiter die Nominatim-Policy von höchstens 1 Anfrage pro Sekunde.

Nicht betroffen sind bisher `/api/mapillary` und `/api/ai`. Map-Tiles laufen grundsätzlich nie über den Proxy.

### Routenplaner (FOSSGIS-OSRM)

Der Routenplaner ruft die öffentlichen OSRM-Instanzen von FOSSGIS (`routing.openstreetmap.de`, Profile `routed-foot`, `routed-bike`, `routed-car`) direkt aus dem Browser ab. Es gibt keine Edge Function dafür, ein Deploy ist nie nötig.

| Symptom (Meldung im Planer) | Ursache | Maßnahme |
|---|---|---|
| „Die Routenberechnung ist gerade ausgelastet …“ | HTTP `429` von FOSSGIS | später erneut versuchen; bei Dauerzustand Nutzungsbedingungen/Limits prüfen |
| „Die Routenberechnung ist gerade nicht erreichbar …“ | HTTP `5xx`, Timeout (15 s), Netzfehler oder unerwarteter OSRM-Code | Dienst per `curl` prüfen (s. u.), sonst Notausgang |
| „Der Routenplaner ist derzeit abgeschaltet.“ | Kill-Switch steht auf `false` | gewollt |

**Diagnose:** `curl -s "https://routing.openstreetmap.de/routed-bike/route/v1/driving/12.37,51.34;12.40,51.31?overview=false"` liefert bei laufendem Dienst `"code":"Ok"`.

**Notausgang:** `ROUTE_PLANNING_ENABLED` in `src/client/features/track/osrmRoute.ts` auf `false` setzen. Der Planer meldet dann „derzeit abgeschaltet“, der Rest der App und der Import (GPX, Komoot) laufen weiter. Es genügt ein Frontend-Deploy.

`routed-foot` ist ein Fußgängerprofil, kein Wanderrouting; es bevorzugt keine Wanderwege.

---

## POI-Kacheln

**Aufbau:** Die eingebauten Filter (Parkplatz, Camper, Camping, Entsorgung, Wasser, Klettern, Hütte, Schutzhütte sowie die Wander-/Rad-Kategorien Trinkwasser, Friedhof, Toilette, Supermarkt, Bäckerei, Unterkunft, Restaurant, Café, Fahrrad-Service, E-Bike-Laden) kommen nicht mehr live von Overpass. Sie werden einmal pro Woche aus den Geofabrik-Extrakten vorberechnet und als statische Kacheln im Daten-Repo [`fenta23/camp-finder-data`](https://github.com/fenta23/camp-finder-data) auf GitHub Pages ausgeliefert. Eigene und KI-Filter fragen weiter live bei Overpass an.

| Teil | Ort |
|---|---|
| Build-Skript (Filter → Kacheln) | `scripts/poi-tiles/build.ts`, `tiles.ts` |
| Workflow + README des Daten-Repos (Vorlage) | `scripts/poi-tiles/data-repo/` |
| Client | `src/client/features/pois/poiTiles.ts`, `app/poiRefresher.ts` |
| Basis-URL | `VITE_POI_TILES_BASE`, Default in `src/client/core/config.ts` |

**Layer:** Kacheln liegen unter `{version}/{layer}/{latIdx}_{lonIdx}.json.gz`. Welcher Filter in welchen Layer gehört, steht in `tileLayerOf` (`filterModel.ts`); der Client lädt einen Layer nur, solange einer seiner Filter aktiv ist.

| Layer | Filter | Geladen |
|---|---|---|
| `parking` | parking | nur bei aktivem Parkplatz-Filter (riesig) |
| `rest` | camper, campsite, dump, water, climbing, hut, shelter | immer |
| `supply` | drinking_water, cemetery, toilets, supermarket, bakery | wenn einer davon aktiv ist |
| `food` | restaurant, cafe | dto. |
| `lodging` | hotel | dto. |
| `bike` | bike_service, ebike_charging | dto. |

**Mehrfach-Zuordnung:** `layersFor` (`tiles.ts`) schreibt ein Objekt in *jeden* Layer, dessen Filter es trifft (Hotel + Restaurant steht in `lodging` und `food`; der Client dedupliziert nach OSM-ID). Ausnahme: Was die `rest`-Filter treffen, steht nicht in `parking` (z. B. `amenity=parking` + `tourism=camp_site`). Ein einfacher Parkplatz, den zusätzlich ein neuer Layer trifft (z. B. `amenity=parking` + `amenity=toilets`), steht in `parking` und in diesem Layer, ist also mit jedem der beiden Filter allein erreichbar. Der Dedupe im Build läuft pro Layer.

**Manifest:** `tiles`/`counts` gelten für alle sechs Layer, `filters.<layer>` listet die Filter-IDs, die der Layer enthält. So erkennt der Client, ob die ausgelieferten Kacheln einen Filter überhaupt kennen; sonst geht dieser Filter live zu Overpass. `tiles.parking`/`tiles.rest` sind unverändert (alte Clients lesen nur diese). Ein Manifest ohne `filters` stammt aus der Zeit vor den neuen Layern: Parkplatz plus die sieben alten `rest`-Filter.

**Mindestmengen:** Der Build bricht ab, wenn ein Layer unter `POI_TILES_MIN_<LAYER>` (z. B. `POI_TILES_MIN_FOOD`) bleibt; fehlend heißt 0. Für `supply`/`food`/`lodging`/`bike` sind im Workflow noch keine gesetzt: nach dem ersten echten Build auf etwa die Hälfte der gebauten Zahlen setzen.

**Ausrollen der neuen Kategorien:**

1. App mergen und deployen.
2. Den Workflow *Build POI tiles* im Daten-Repo per *Run workflow* von Hand starten. Falls die Vorlage geändert wurde (STAND.md, Mindestmengen), vorher `scripts/poi-tiles/data-repo/.github/workflows/build.yml` von Hand ins Daten-Repo kopieren.
3. Bis dieser Build durch ist, kennt das alte Manifest die neuen Filter nicht (`filters` fehlt) und der Client holt die neuen Kategorien live von Overpass.
4. Danach `POI_TILES_MIN_*` für die vier neuen Layer setzen.

**Fallback:** Schlagen Manifest oder Kachel fehl (Netz, `404`, Timeout 5 s bzw. 15 s), laufen die eingebauten Filter für den Ausschnitt wie früher über Overpass. Nach einem gescheiterten Manifest versucht der Client es erst nach 60 s erneut und geht bis dahin direkt zu Overpass. Die App bleibt also benutzbar, ist dann aber so langsam wie vor den Kacheln.

**Diagnose:**

```bash
curl -sS https://fenta23.github.io/camp-finder-data/manifest.json | jq '{version, date, counts, filters, tiles: (.tiles | map_values(length))}'
```

- Manifest fehlt oder ist alt → Actions-Log des Workflows *Build POI tiles* im Daten-Repo ansehen und ihn per *Run workflow* neu starten.
- Ein neuer Build ersetzt das Verzeichnis der alten Version. Offene Tabs bekommen dann `404`, laden das Manifest einmal neu und holen die neue Version.

**Lokal testen:**

```bash
npx tsx scripts/poi-tiles/build.ts --expressions > /tmp/expr.txt
osmium tags-filter sachsen-latest.osm.pbf -e /tmp/expr.txt -O -o /tmp/filtered.osm.pbf
npx tsx scripts/poi-tiles/build.ts /tmp/filtered.osm.pbf /tmp/tiles
# beliebiger statischer Server mit CORS auf :3000, dann:
VITE_POI_TILES_BASE=http://localhost:3000 npm run dev
```

Die Ausdrücke als Datei übergeben (`-e`), nicht per `$(…)`: zsh trennt unquotierte Variablen nicht an Leerzeichen, osmium bekommt dann einen einzigen kaputten Ausdruck und filtert fast alles weg.

**Bekannte Lücke:** `osmium export` baut Flächen nur aus Multipolygon-Relationen. Andere Relationen (z. B. viele `sport=climbing`-Sites mit `type=site`) fehlen in den Kacheln.

---

## KI-Provider-Ausfall

**Vorgekommen:** 2026-10-02 (#90).

**Symptom:** KI-Suche und POI-Zusammenfassung fallen gleichzeitig aus. Vor #90 meldete die Suche dabei fälschlich „Das habe ich nicht verstanden“, und die Zusammenfassung verschwand ohne Hinweis. Seit #90 erscheint „Die KI-Suche ist gerade nicht erreichbar.“, und die Zusammenfassung antwortet mit `502`.

**Wo die KI konfiguriert ist:** ausschließlich in den Supabase-Secrets. Fehlt ein Secret, gilt der Default aus `supabase/functions/_shared/aiClient.ts`.

| Secret | Production-Wert | Default |
|---|---|---|
| `AI_PROVIDER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter |
| `AI_PROVIDER_KEY` | OpenRouter-Key (`sk-or-v1-…`) | — (ohne Key ist die KI aus) |
| `AI_MODEL` | `meta-llama/llama-3.3-70b-instruct` | dto. |

Wir nutzen **OpenRouter**, nicht Mistral direkt. Ein OpenRouter-Key funktioniert nicht gegen `api.mistral.ai` und umgekehrt. Mistral-Modelle laufen über OpenRouter als `mistralai/…`.

**Was am 2026-10-02 schiefging:** Mehrere Ursachen hintereinander, jede verdeckte die nächste:

1. Der OpenRouter-Key war abgelaufen.
2. Nach dem Erneuern zeigten `AI_PROVIDER_BASE_URL`/`AI_MODEL` noch auf Mistral-Werte. Der OpenRouter-Key ging also an Mistral und wurde mit „invalid api token“ abgelehnt.
3. Der Diagnose-Test lief gegen `api.mistral.ai` statt gegen OpenRouter und führte deshalb ebenfalls in die Irre.

**Diagnose in dieser Reihenfolge:**

1. **Key gültig, Guthaben vorhanden?**
   ```
   curl -s https://openrouter.ai/api/v1/key -H "Authorization: Bearer <KEY>"
   ```
   `401`: Key ungültig. Auf `limit_remaining`, `is_free_tier` und `usage` achten. Kostenpflichtige Modelle ohne Guthaben liefern `402`.
2. **Modell erreichbar?**
   ```
   curl -s https://openrouter.ai/api/v1/chat/completions \
     -H "Authorization: Bearer <KEY>" -H "Content-Type: application/json" \
     -d '{"model":"meta-llama/llama-3.3-70b-instruct","messages":[{"role":"user","content":"Hallo"}],"max_tokens":10}'
   ```
3. **Sind die Secrets in Supabase richtig?** `npx supabase secrets list` zeigt nur SHA-256-Digests. Einen erwarteten Wert damit vergleichen:
   ```
   echo -n "<WERT>" | shasum -a 256
   ```
   Klappen 1 und 2, aber die App schlägt trotzdem fehl, alle drei Secrets explizit setzen:
   ```
   npx supabase secrets set AI_PROVIDER_BASE_URL=https://openrouter.ai/api/v1 \
     AI_MODEL=meta-llama/llama-3.3-70b-instruct AI_PROVIDER_KEY=<KEY>
   ```
4. **Genauer Fehler:** Dashboard → Edge Functions → `api` → Logs, nach `AI provider` suchen. Dort stehen Statuscode und Antwort des Providers.

Neue Secrets greifen in der Regel ohne Redeploy.

---

## Supabase-Migrationen

Auf Production ist in der Migrationshistorie nur `0001` eingetragen. `0002`–`0006` wurden von Hand im SQL Editor eingespielt, ebenso `0007`, falls schon geschehen. **`npx supabase db push` nicht verwenden**, es würde `0002`–`0006` erneut ausführen. Neue Migrationen im SQL Editor ausführen.

Um die Historie zu bereinigen, einmalig ausführen, sobald `0007` angewendet ist. Das trägt die Migrationen nur als angewendet ein und führt nichts aus:

```
npx supabase migration repair --status applied 0002 0003 0004 0005 0006 0007
```
