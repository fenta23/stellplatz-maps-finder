# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Zwei neue Built-in-Filter: „Hütte" und „Schutzhütte".** „Hütte" fasst `tourism=wilderness_hut` (unbewirtschaftete Selbstversorgerhütte) und `tourism=alpine_hut` (bewirtschaftet) in zwei ORed Selektoren zusammen. „Schutzhütte" nimmt `amenity=shelter`, schließt aber die drei häufigsten `shelter_type`-Werte per `≠` aus — **~90 % aller `amenity=shelter` in Deutschland sind Bushaltestellen-Wartehäuschen** (`public_transport` 49 %), dazu kommen `picnic_shelter` (21 %) und `gazebo` (11 %). Im Raum München reduziert das 2733 Treffer auf 242. Mehr Ausschlüsse gehen nicht: das Backend akzeptiert pro Statement nur vier Tag-Filter (s. u.). Overpass' `!=` matcht auch Objekte *ohne* den Key, Shelter ohne `shelter_type` bleiben also drin — das sind oft genau die interessanten Waldhütten. „Hütte" hat `order` 7 und greift damit vor „Schutzhütte" (8), sonst landet eine Hütte mit zusätzlichem `amenity=shelter` im falschen Filter. Zwei neue Icons (`hut` = Haus mit Kamin, `shelter` = offenes Dach auf Pfosten, bewusst nicht das Zelt des Campingplatz-Filters) in `CUSTOM_POI_ICONS`, damit auch im Custom-POI-Editor und in der Filter-Icon-Auswahl verfügbar. Beide Filter sind **`enabled: false`** ausgeliefert: der Chip ist in der Leiste sichtbar (dafür zählt nur `hidden`), aber inaktiv — bestehende Nutzer bekommen nicht ungefragt zwei neue POI-Typen auf die Karte, ein Tap schaltet sie an.
- **Onboarding-Wizard (4 Schritte).** Ersetzt das statische Hilfe-Overlay durch einen interaktiven Wizard, der beim ersten Besuch aufgeht und jederzeit über den Menüpunkt „Hilfe" erneut aufgerufen werden kann. Schritt 1: Feature-Überblick. Schritt 2: Filter-Auswahl — abgewählte Filter werden direkt ausgeblendet (nicht nur deaktiviert), sodass die Filter-Leiste unaufgeräumt bleibt. Schritt 3: vollständiger „Verantwortungsvoll unterwegs"-Kodex inline. Schritt 4: optionales Konto-Angebot mit „Lieber später"-Ausweg. Fortschritts-Dots in der Sticky-Top-Bar; auf Schritt 1 verschmilzt die Leiste nahtlos mit dem Hero-Hintergrund. „Überspringen" jederzeit sichtbar, committed keine Änderungen.


- **Neue Seite „Verantwortungsvoll unterwegs".** Eine eigenständige, grafisch gestaltete Inhaltsseite (eigener Slice `features/responsibility/`) über respektvollen Umgang mit Natur, Umwelt und Mitmenschen beim (Wild-)Campen. Positiv & einladend statt Verbots-Liste: Hero mit Naturverlauf, ein 6-Punkte-**Kodex** mit Icon-Kacheln (Spuren, Wasser, Ruhe, Respekt, Natur, Region), eine ehrliche Einordnung der Rechtslage („Wo darf ich übernachten?") mit farbcodierten Status-Chips (Skandinavien/Jedermannsrecht als Vorbild) und ein Abschluss-Callout mit dem Leitsatz „Besser gehen, als du kamst." sowie Link zu Leave No Trace. Erreichbar über einen prominenten Menüpunkt (Blatt-Icon) direkt unter „Notizen". Rein statisch, kein Backend.
- **iOS-Splash-Screens (`apple-touch-startup-image`).** Beim Start der zum Homescreen hinzugefügten PWA zeigt iOS jetzt einen Marken-Splash (Camper-Van + Sichelmond auf `#4B5640`) statt eines weißen Bildschirms. Quelle: `public/splash.svg` (1024×1024). 38 gerätespezifische PNGs erzeugt `@vite-pwa/assets-generator` über die eigene Config `pwa-assets.splash.config.ts` (getrennt von der Icon-Config, da der Generator ein Preset auf alle `images` anwendet und gleiche Dateinamen sonst kollidieren). Die `<link>`-Tags stehen in `index.html`. Bewusst nur Light-Variante (einfarbiges Grün matcht beide Color-Schemes → halb so viele Dateien); eine eigene `name`-Funktion umgeht einen Generator-Bug, bei dem Datei- (`…-2048x2732.png`) und Link-Name (`…-light-2048x2732.png`) auseinanderliefen.
- **Mobile: Topbar und Filter-Leiste kollabieren bei Karten-Interaktion.** Sobald der Nutzer die Karte per Drag oder Pinch-Zoom bewegt, werden `#topbar` und `#filter-panel` ausgeblendet und durch eine schmale, über der Karte schwebende Button-Leiste (`#float-controls`) mit Menü-, Such- und Filter-Icon ersetzt. Die Karte nutzt sofort die volle Höhe. Ein Tap auf einen der Float-Buttons stellt die komplette UI wieder her. Die Float-Controls teilen das vereinheitlichte Overlay-Styling (s. u.). Nur auf Mobile (≤600px).
- **Desktop: Layer-Switcher weicht dem Detail-Panel aus.** Öffnet sich das POI-Detail-Panel (340px rechte Sidebar), bekommt der Leaflet-Layer-Switcher (Position `topright`) einen `margin-right: 340px` — er bleibt sichtbar, statt verdeckt zu werden. Gesteuert via `body.detail-open`-Klasse.
- **`MapService.onZoomStart()`** — neuer Event für Zoom-Gesten (Pinch/Scroll), analog zum bestehenden `onDragStart()`. Wird für den Mobile-UI-Collapse genutzt.

### Changed
- **Panels: einheitliches Page/Modal-Muster.** Alle Overlay-Panels der `.fav-panel`-Familie (Favoriten, Notizen, Filter verwalten, Google-Maps-Import, Info, Datenschutz, Impressum) verhalten sich jetzt einheitlich responsiv: **mobil (≤600px) vollflächige Page, Desktop (≥601px) zentriertes Modal** (max. 560px, gerundete Ecken, dezent abgedunkelter Hintergrund). Umsetzung rein zentral in `styles/shell.css`, kein HTML-Umbau. Der Scrim wird als `box-shadow` (außerhalb der Box) gezeichnet statt als Pseudo-Layer — sonst würde die Abdunkelung durch transparente Inhaltsbereiche (z. B. Listenzeilen) in die Karte durchbluten. Mobile-Darstellung unverändert. Auch das Login-/Konto-Modal wurde farblich angeglichen: Karten-Hintergrund von `--surface` (weiß) auf `--bg` (Papier) wie die übrigen Modals, Backdrop von 0,45 auf 0,28 abgedunkelt.
- **Map-Overlay-Controls: vereinheitlichtes Styling.** Zoom-Buttons, Layer-Switcher, Map-Actions und Float-Controls teilen jetzt eine konsistente Design-Sprache: `border-radius: 8–12px` (statt 4px eckig / 24px Pill), semi-transparenter Hintergrund (`rgba(255,255,255,0.88)`) mit `backdrop-filter: blur(10px)`, und weicher, einheitlicher Schatten (`0 2px 10px rgba(44,40,34,0.12)`). Kein Element sticht mehr optisch heraus.

### Fixed
- **POI-Marker luden gar nicht mehr, da die Overpass-Mirrors Server-Traffic gezielt blocken.** Nach dem Entfernen der toten Mirrors (s. u.) zeigte Logging in der Edge Function: alle drei verbleibenden Mirrors lehnten Anfragen von Supabase- und GitHub-Actions-Cloud-IPs sofort ab (`403`/`406` in <150ms) — keine Überlastung, eine gezielte Blockade von Rechenzentrums-Traffic. Von echten Browsern (Nutzer-IPs) aus liefern dieselben Mirrors weiterhin normal. `OverpassClient.fetchPois` ruft die drei Mirrors deshalb jetzt **direkt aus dem Browser** auf (sequentieller Fallback, 10 s Timeout pro Mirror, respektiert weiterhin ein Abbruch-Signal bei Kartenbewegung) statt über den Supabase-Proxy. Der serverseitige Postgres-Cache (`poi_cache`) entfällt dadurch für den Haupt-POI-Fetch; `/api/overpass` bleibt als Endpoint bestehen (für spätere Wiederverwendung), wird vom Client aber nicht mehr aufgerufen. `/api/nearby` ist von diesem Umbau noch nicht betroffen und bleibt vorerst über den Proxy. Neue Mirror-Liste in `core/overpassEndpoints.ts`. Neue Fallback-Tests in `OverpassClient.test.ts`.
- **`/nearby`-Endpoint fiel komplett aus, sobald der erste konfigurierte Overpass-Mirror die Anfrage ablehnte.** `handleNearby` rief immer nur `OVERPASS_ENDPOINTS[0]` auf, ohne Fallback — anders als der Haupt-Overpass-Proxy. Aufgefallen, als das Vorziehen von `overpass.openstreetmap.fr` (s. u.) den CI-Integrationstest `nearby accepts valid coordinates` mit `403` scheitern ließ: der Mirror lehnte genau diese Anfrage ab, obwohl er für andere Requests gesund war. `handleNearby` probiert jetzt sequentiell alle konfigurierten Mirrors durch, bevor es aufgibt. Neue Tests in `nearbyHandler.test.ts`.
- **Overpass-Proxy lieferte seit dem 14.09. durchgehend `503 All Overpass endpoints unreachable`.** Zwei der fünf konfigurierten Mirrors (`overpass.kumi.systems`, `overpass.openstreetmap.ru`) sind aktuell komplett unerreichbar (reiner Connection-Timeout, 0/3 Proben von mehreren Netzwerken aus) — in der sequentiellen Fallback-Kette verbrannten sie trotzdem je 10 s Timeout-Budget, bevor überhaupt der zuverlässigste verbleibende Mirror (`overpass.openstreetmap.fr`) versucht wurde. Beide toten Mirrors aus `OVERPASS_ENDPOINTS` entfernt, `overpass.openstreetmap.fr` an erste Stelle, `RACE_COUNT` von 2 auf 3 erhöht (jetzt werden alle drei verbleibenden Mirrors parallel gerace't statt teilweise sequentiell probiert). Betraf auch den täglichen GitHub-Warmup-Job. Ob zusätzlich Cloud-IP-Filterung der verbleibenden Mirrors eine Rolle spielt, ist noch nicht abschließend geklärt.
- **Desktop-Dialoge (Favoriten, Notizen, Filter verwalten, Google-Maps-Import, Info, Datenschutz, Impressum) waren unter Safari extrem schmal statt der vorgesehenen 560px.** `.fav-panel.open` zentrierte das Modal per `inset: 0; margin: auto` mit explizitem `height: fit-content` — Safari berechnet die Breite in dieser Kombination (fixed + inset auf allen Seiten + auto-Margin + `fit-content`-Höhe) falsch. `height: fit-content` entfernt, damit greift die Spec-konforme Shrink-to-fit-Berechnung über `height: auto` + `margin: auto`, optisch identisch, aber ohne den WebKit-Bug. Die Query-Allowlist im Backend (`_shared/utils.ts`, `STATEMENT`) erlaubt pro Statement nur `{1,4}` Tag-Filter; alles darüber beantwortet der Endpoint mit `400 Unsupported query shape`. Weil **alle** aktiven Filter in einer einzigen Overpass-Query landen, blieb dadurch nicht bloß der eine Filter leer, sondern die ganze Karte. Der Client erlaubte aber bis zu 6 Bedingungen — sowohl in `isValidSelector()` als auch im „Filter verwalten"-Editor (Button „Bedingung hinzufügen"). Beide hängen jetzt an der neuen Konstante `MAX_SELECTOR_CONDITIONS = 4` mit Verweis auf die Backend-Regex. Aufgefallen am Filter „Schutzhütte", der mit 6 Bedingungen ausgeliefert wurde und beim Einschalten die Karte leerte; er nutzt jetzt 4. Regressionstests prüfen, dass kein Built-in, kein Template und keine generierte Query das Limit überschreitet.
- **Onboarding-Wizard zeigte inaktive Filter als ausgewählt.** Schritt 2 berechnete „ausgewählt" allein aus `hidden` und schrieb beim Übernehmen auch nur `setHidden`. Ein Filter mit `enabled: false`, der nicht `hidden` ist, erschien dadurch als angehakt, obwohl `isFilterActive` (`!hidden && enabled`) ihn inaktiv lässt — die Karte blieb leer, und ein Klick auf die Karte schaltete ihn nie ein. `resetFilterState()` nutzt jetzt `isFilterActive()`, und `applyFilters()` ruft zusätzlich `setEnabled(id, true)`, wenn ein noch nicht eingeschalteter Filter ausgewählt wird. Fiel bei der Einführung der opt-in-Filter „Hütte"/„Schutzhütte" auf.
- **Karte zeigte „API KEY REQUIRED"-Wasserzeichen.** CARTO brennt seit 2026 einen Wasserzeichen-Hinweis in keylose Voyager-Tiles (`basemaps.cartocdn.com` antwortet weiterhin mit HTTP 200, aber die PNGs enthalten die Overlay-Schrift). Der Basis-Layer akzeptiert jetzt einen Build-Zeit-Key `VITE_CARTO_API_KEY` (kostenlos über <https://carto.com/basemaps/apikey>, 5 Mio Tiles/Monat), der als `?key=` an die Tile-URL gehängt wird. Ohne Key wird CARTO gar nicht mehr angefragt, sondern auf **Esri World Street Map** zurückgefallen (keyless, derselbe Host wie der Satellit-Layer) — inkl. angepasster Attribution ohne CARTO-Credit. Neue Funktion `buildMapLayerConfig(cartoKey)` mit Regressionstests für beide Pfade.
- **Route-Endpoint lieferte 503.** Der Valhalla-Routing-Server (`valhalla1.openstreetmap.de`) war nicht erreichbar. Der Handler wurde auf OSRM umgestellt — zuerst auf `router.project-osrm.org`, dann auf `routing.openstreetmap.de`, weil Letzteres getrennte Instanzen pro Verkehrsmodus betreibt (`routed-car`, `routed-bike`, `routed-foot`) und dadurch echte fuß-/fahrradspezifische Routen liefert (statt wie `project-osrm.org` für alle Modi dieselbe Auto-Route). Zusätzlich wurde der Catch-Block entschärft: Fehler werden jetzt geloggt statt still geschluckt, Timeouts (504) und Netzwerkfehler (503) werden unterschieden, und der Handler hat eine vollständige Test-Suite (15 Tests). Frontend-seitig gibt `routeErrorMessage()` jetzt deutsche Fehlertexte analog zur Overpass-`statusMessages.ts`.
- **PWA-Update-Race-Condition: CSS/JS laden nach Update manchmal nicht.** Der Update-Handler (`watchServiceWorkerUpdates`) schickte `SKIP_WAITING` und rief sofort `location.reload()` auf — ohne auf die tatsächliche Aktivierung des neuen Service Workers zu warten. Diese Race-Condition führte dazu, dass beim Reload noch der alte SW (oder ein unvollständig aktivierter neuer SW) die Navigation bearbeitete und CSS-/JS-Ressourcen aus dem Cache fehlten. Jetzt wartet der Handler nach `skipWaiting()` auf das `controllerchange`-Event (garantiert abgeschlossene Aktivierung inkl. `cleanupOutdatedCaches`) und fällt nach 3 s Timeout auf Reload zurück. Zusätzlich wurde `clientsClaim: true` in der Workbox-Konfig gesetzt, damit der aktivierte SW sofort alle Clients übernimmt und `controllerchange` zuverlässig feuert. Regressionstests in `UpdateBanner.test.ts`. Beim Überfahren einer Zeile wurde nur der Hauptbereich eingefärbt, die Papierkorb-Zelle blieb außen vor (sichtbare Naht), und der Lösch-Button hatte einen fremdfarbigen roten Hover-Block. Jetzt färbt der Hover die **ganze Zeile** einheitlich (`.fav-item:hover`), die Buttons bleiben transparent; der Papierkorb zeigt als dezente Lösch-Affordanz beim direkten Hover nur noch ein rotes Icon statt eines Block-Hintergrunds.
- **KI-Suche-Button („✨") blieb für ausgeloggte Nutzer sichtbar.** Das Login-Gating setzte das `hidden`-Attribut des Buttons, aber `.search-ai { display: flex }` (Klassen-Selektor) überstimmt das Attribut — derselbe Spezifitäts-Fehler wie beim 3-Punkte-Menü (s. u.). Jetzt wird die `.hidden`-Klasse getoggelt (wie beim Clear-Button); Button startet `search-ai hidden`. Backend-Gate (401) und die POI-Zusammenfassung waren korrekt — nur der Button war optisch nicht versteckt. Regressionstest in `SearchBar.test.ts` (prüft die `.hidden`-Klasse, nicht das Attribut).
- **Funktionsloses 3-Punkte-Menü bei OSM-POIs entfernt.** Das Kebab-Menü (Bearbeiten/Löschen) ist nur für eigene/importierte POIs gedacht. Bei OSM-POIs erschien der Button trotzdem — ohne Funktion —, weil `.poi-menu-wrap { display: inline-flex }` das `hidden`-Attribut der Vorlage überstimmte. Der Wrapper wird für Nicht-Custom-POIs jetzt gar nicht mehr gerendert. Regressionstest in `PoiDetailPanel.test.ts`.
- **Favoriten-Sync über mehrere Geräte: Entfernen eines Favoriten wurde nicht synchronisiert.** Beim Reload auf Gerät B wurden lokal gecachte Favoriten, die auf Gerät A bereits gelöscht wurden, als „Gast-Favoriten" fehlklassifiziert und zurück auf den Server gepusht — die Löschung wurde rückgängig gemacht. Ursache: `connect()` in `SyncedFavoritesStore` (und analog in Notes, Custom POIs, Filters) merged nur additiv (`addMany`/`applyRemote`) ohne synced-IDs-Tracking. Fix: `syncedIds`-Set in localStorage persistiert, Reconciliation unterscheidet echte Gast-Items von Stale-Deletions, Merge erfolgt via `replaceAll` (nicht additiv), 30 s Polling hält laufend synchron. Gleicher Fix in `SyncedNotesStore`, `SyncedCustomPoiStore`, `SyncedFilterStore`. Zusätzlich `user_id`-Filter in allen `remove()`-Backend-Calls als Defense-in-Depth. Regressionstests in allen vier Remote-Store-Testdateien.
- **Mobile: Karte springt beim Ausblenden des Headers nicht mehr.** Beim Zoomen oder Ziehen der Karte auf Mobile (≤600px) kollabierten Topbar und Filter-Leiste per `display: none`, wodurch der Map-Container (`position: absolute` in `#content`) größer wurde und die Karte um die Header-Höhe nach oben sprang. Fix: `#map` ist jetzt `position: fixed; inset: 0;` — immer viewport-füllend, unabhängig vom Header. Topbar und Filter-Panel liegen als Overlay darüber; ihr Ein-/Ausblenden ändert die Map-Größe nicht. `panIntoView` berücksichtigt den korrekten sichtbaren Kartenausschnitt (`effectiveMapTop`). Leaflet-Controls (Zoom, Layer-Switcher) standardmäßig 110px nach unten verschoben, bei `ui-collapsed` wieder auf 0.
- **Routen-Linie auf Satelliten-Layer schlecht erkennbar.** Die Oliv-/Grüntöne der Routen (`#5E6B4F`, `#3F6B4A`) verschwanden fast auf dem grünen ESRI-Satelliten-Hintergrund. `DirectionsService.setSatelliteMode()` schaltet die Linien jetzt dynamisch auf grelles Pink (`#FF1493`) um — sowohl für die Haupt- als auch die Nearby-Route. Der Umschalter feuert über das neue `MapService.onBaseLayerChange()`-Event, das `createLayerSwitcher` jetzt bei jedem Layer-Wechsel auslöst.

### Changed
- **CSS aus `index.html` in Feature-Slices ausgelagert.** Der `<style>`-Block (~3060 Zeilen) wurde aufgeteilt: `index.html` (3108 → 135 Zeilen) behält nur noch kritisches Shell-CSS inline (Design-Tokens, Reset, `#topbar`, `#map` — verhindert FOUC vor dem JS-Bundle). Der Rest liegt jetzt co-located pro Feature (`features/<slice>/<slice>.css`, im jeweiligen Entry-Modul importiert) plus zwei geteilte Dateien: `styles/shell.css` (Status-Toast, Side-Menu, geteilte `.fav-panel`-Shell, SVG-Icon-Sizing) und `styles/responsive.css` (cross-cutting Mobile-`@media`-Block). Reine Verschiebung, kein Regelwechsel — Kaskade über die Import-Reihenfolge in `main.ts` gesichert (Shell zuerst, responsive zuletzt). Alle 608 Tests grün.
- **Eigene Domain `camp-finder.de` (statt `fenta23.github.io/stellplatz-maps-finder/`).** Build-Base von `/stellplatz-maps-finder/` auf `/` umgestellt, PWA-Manifest `start_url`/`scope` auf `/`, SPA-404-Redirect auf `/`, `public/CNAME` mit `camp-finder.de` für GitHub Pages. CORS um `https://camp-finder.de` + `https://www.camp-finder.de` erweitert. **Manuell noch nötig:** GitHub Pages Custom Domain setzen + HTTPS erzwingen, DNS bei netcup (4× A auf GitHub-Pages-IPs + `www` CNAME), Edge-Function `api` neu deployen.
- **Detail-Panel auf Mobile kompakter.** Das untere Sheet ist jetzt `50dvh` hoch (statt `60dvh + 30px`), sodass mehr von der Karte sichtbar bleibt. Header und die Button-Leiste (Route hierhin / Losfahren / Von hier / Google Maps) haben auf Mobile reduzierte Paddings und Schriftgrößen — die Aktionen bleiben gut tippbar, brauchen aber weniger Höhe.
- **Sekundäre Aktionen 3-spaltig auf Mobile.** „Losfahren", „Von hier" und „Google Maps" stehen auf Mobile nebeneinander in einer Zeile (spart eine Button-Zeile, Footer 128 → 91 px). Desktop bleibt unverändert beim 2 + 1-Layout (Google Maps volle Breite in eigener Zeile).
- **Filter-Leiste bleibt einzeilig (Overflow-Menü).** Chips, die nicht in eine Zeile passen, wandern hinter einen „…"-Button, der ein Dropdown mit den restlichen Filtern öffnet — statt wie bisher (`flex-wrap`) auf Mobile in eine zweite Zeile umzubrechen. Die Anzahl sichtbarer Chips wird per Messung der verfügbaren Breite bestimmt (pure `computeVisibleCount`, getestet) und bei jedem Resize/Re-Render neu berechnet; „+" und „⚙️" bleiben fix angepinnt. Skaliert auf beliebig viele Filter und greift auf allen Breiten (Desktop zeigt bei genug Platz weiterhin alle Chips).

### Added
- **`createEventScope()` (core/events).** Utility, das `addEventListener`-Aufrufe unter einem `AbortController` bündelt. `dispose()` entfernt alle registrierten Listener in einem Zug — kein manuelles `removeEventListener` mehr nötig. Typed Overloads für `Document`, `Window` und `HTMLElement`.

### Changed
- **Overpass-Endpunkte: paralleles Racing + selbstlernende Reihenfolge.** `handleOverpass()` racet nicht mehr streng sequenziell (immer ab `osm.hpi.de`, bis zu 5×15 s), sondern feuert die zwei gesündesten Endpunkte parallel (`Promise.any`, Timeout 10 s) und fällt nur bei Bedarf durch den Rest. Neue pure Heuristik [`overpassRanking.ts`](supabase/functions/_shared/overpassRanking.ts) sortiert die Endpunkte pro Edge-Isolate nach beobachteter Latenz (EWMA) und Fehlern: ein langsamer/abstürzender Mirror wird automatisch nach hinten geschoben und erholt sich nach einer Cooldown-Phase wieder. Best-effort In-Memory-State, keine DB-Schreiblast.
- **Event-Listener-Cleanup in 9 Klassen.** `SideMenu`, `SearchBar`, `AuthPanel`, `FilterConfigPanel`, `NotesListPanel`, `FavoritesListPanel`, `InfoPanel`, `PoiDetailPanel` und `AiSearchModal` nutzen jetzt `createEventScope()` statt loser `document.addEventListener`-Aufrufe ohne Gegenstück. Alle Klassen haben ein neues `destroy()`.

### Removed
- **Google-OAuth-Login.** Provider war nie fertig konfiguriert und entfällt — Anmeldung läuft jetzt ausschließlich passwortlos per E-Mail-OTP-Code. Google-Button, `signInWithGoogle`/`signInWithOAuth`, OAuth-Styles und der „oder per E-Mail"-Divider entfernt. (Google-Maps-**Import** und Routing-Links sind davon unberührt.)

### Added
- **KI-Sidecar Phase 2: Natürlichsprachige Suche (Chat-Modal).** Neuer „✨"-Button in der Suchleiste öffnet ein kleines Chat-Modal — keine zweite Suchleiste. Der Chat stellt bei vagen Anfragen Rückfragen (z. B. „wie weit entfernt?") und übersetzt das Gespräch in die **bestehenden** Mechanismen: Geocode-Sprung + `FilterStore` (built-in Filter aktivieren oder Ad-hoc-Filter aus OSM-Tags anlegen). Bei „ready" erscheint eine Ergebnis-Karte mit „Auf Karte zeigen" → Filter werden gesetzt, Karte springt, Modal schließt. **Scope-Guard** gegen Off-Topic: enger System-Prompt + strukturierter `offtopic`-Status + harte Allowlist-Validierung im Client ([`intentSchema.ts`](src/client/features/ai/intentSchema.ts)) — ein „ausgetrickstes" Modell kann strukturell nur bekannte Filter setzen, nichts anderes. Turn-Limit per `AI_MAX_TURNS` (Default 5). **KI nur für eingeloggte Nutzer:** der `/api/ai`-Endpunkt verlangt Login (Default an, abschaltbar per `AI_REQUIRE_AUTH=false`), der „✨"-Button ist für Ausgeloggte ausgeblendet und die POI-Zusammenfassung wird gar nicht erst angefragt. Edge-Task `chat` mit JSON-Output + Korrektur-Retry.
- **KI-Sidecar Phase 1: POI-Zusammenfassung.** Das Detail-Panel zeigt jetzt eine kurze, deutschsprachige KI-Zusammenfassung der OSM-Tags eines Ortes („Wohnmobilstellplatz, 12 Plätze, gebührenpflichtig …"). Neuer Edge-Endpunkt `POST /api/ai` (Task `summarize`) als provider-agnostischer, OpenAI-kompatibler Wrapper ([`_shared/aiClient.ts`](supabase/functions/_shared/aiClient.ts)) — Default-Provider **OpenRouter**, per Env austauschbar (`AI_PROVIDER_BASE_URL`/`AI_PROVIDER_KEY`/`AI_MODEL`, auch lokales Ollama). Ergebnis wird in `poi_cache` gecacht (Key = Modell + Tag-Hash, TTL 30 Tage), Rate-Limit 30/min pro IP. Ohne konfigurierten Key liefert der Endpunkt `{ summary: null }` und das Panel blendet den Block aus (graceful degradation). Prompt ist hart auf Faktentreue eingeschränkt (nur vorhandene Tags, nichts dazuerfinden). Neue Slice `features/ai/`. Plan: [`docs/ai-sidecar-plan.md`](docs/ai-sidecar-plan.md).
- **PWA-Login per 6-stelligem Code (OTP).** Der E-Mail-Login fragt jetzt nach `Code senden` einen 6-stelligen Code ab (`verifyOtp`), statt nur auf den Magic-Link zu setzen. Damit funktioniert die Anmeldung in der installierten Home-Screen-PWA: kein Browser-Redirect mehr, die Session landet direkt im Storage-Kontext der PWA (auf iOS haben Safari und PWA getrennte Storages, weshalb der Link-Flow dort die PWA nie eingeloggt hat). `AuthPanel` mit Zwei-Schritt-Ablauf (E-Mail → Code), Magic-Link bleibt als Browser-Fallback nutzbar.
- **`npm run deploy:email`** ([`scripts/deploy-email-templates.mjs`](scripts/deploy-email-templates.mjs)) pusht die Auth-E-Mail-Templates aus `supabase/templates/` via Management-API ins gehostete Projekt — die HTML-Dateien sind jetzt Source of Truth statt manueller Dashboard-Kopie. `magic-link.html` enthält jetzt `{{ .Token }}` (OTP-Code) plus Link als Fallback.
- **Google Maps Import.** Neue Funktion im Seitenmenü: „Google Maps importieren" öffnet ein Erklär-Panel mit zwei Varianten — JSON (`Meine Orte mit Beschriftungen`) und CSV (`Gespeicherte Orte`) inkl. Dateipfaden aus Google Takeout. Bei CSVs werden `/search/LAT,LNG`-URLs direkt importiert, `/place/NAME`-URLs via Nominatim-Geokodierung aufgelöst. Alle importierten POIs sind editierbar.
- **Data-driven Filter-System.** Statt hartcodierter POI-Typen werden Filter jetzt über einen `FilterStore` (localStorage + Supabase-Sync) verwaltet. Neue `FilterConfigPanel` zum Anlegen/Bearbeiten/Löschen von Filtern inkl. 16 Vorlagen (Tankstelle, Supermarkt, Restaurant, …). Filter haben zwei Ebenen: `hidden` (Config-Switch → in Chip-Leiste ausblenden) und `enabled` (Chip-Klick → POIs auf Karte an/aus).
- **Supabase-Tabelle `poi_filters`** (Migration 0006) für benutzersynchrone Filter-Definitionen.
- **Overpass-Query data-driven:** `buildOverpassQuery` + `classifyElement` in `filterModel.ts` bauen Query und Klassifikation aus beliebigen `FilterDef[]`.

### Changed
- **Detail-Panel: „OpenStreetMap"-Link → „Google Maps".** Der externe Link öffnet jetzt Google Maps statt OSM. `buildGoogleMapsPoiLink` baut einen Such-Link aus Name + Koordinaten (`?api=1&query=<Name> <lat>,<lon>`), sodass im besten Fall direkt die passende Place-Karte selektiert ist; ohne Name fällt es auf einen Koordinaten-Pin zurück.
- **`main.ts` refactored** (501→350 Zeilen). Import-Wiring, Custom-POI-Wiring, Auth-Sync und SVG-Icons in eigene Module unter `app/` ausgelagert.
- **`PoiDetailPanel` aufgeräumt:** `show()` in Sub-Renderer (`renderFav`/`renderMenu`/`renderRoute`/`renderTags`) aufgeteilt, Constructor-Event-Wiring in `wireGlobalEvents()`, Listener mit generischem `subscribe()`-Helper DRY gemacht (337→316 Zeilen).
- **`FilterConfigPanel` verkleinert:** `buildEditorForm` in `buildTemplates`/`buildNameField`/`buildAppearance`/`buildTagsSection`/`buildActions` aufgeteilt, `el()`-DOM-Helper (381→328 Zeilen).
- **`fetchPois`** akzeptiert `FilterDef[]` statt `PoiType` – Abfrage und Klassifikation sind jetzt vollständig datengetrieben.
- **`poiRefresher`** holt Daten für alle aktiven OSM-Filter (built-in + benutzerdefiniert), nicht nur die 6 Standard-Typen.
- **`PoiMarkerManager`** nutzt `StyleResolver` → Marker-Farbe und -Icon sind live aus dem FilterStore konfigurierbar.
- **`poiMeta`** (Labels/Icons) über `PoiMetaRegistry` an den FilterStore angebunden.
- **`CustomPoiMarkerManager`** erhält Farbe aus dem personal-Filter.
- **Lade-Banner** umbenannt: „Lade Stellplätze…" → „Suche Orte…"

### Fixed
- **Doppeltes „X" in der Suchleiste.** Das `<input type="search">` zeigte zusätzlich das native Browser-Cancel-X (`::-webkit-search-cancel-button`) neben dem eigenen `.search-clear`-Button. Natives X jetzt per `appearance: none` ausgeblendet.
- **Overpass-Cache-Warmup scheiterte bei einzelnen transienten Region-Fehlern.** Die strikte `fail=0`-Prüfung färbte den nächtlichen Warmup rot, sobald auch nur 1 von 27 Regionen einen Overpass-Aussetzer hatte (z. B. „25 ok, 2 failed"). Jetzt best-effort: Abbruch nur bei breitem Ausfall (`ok=0` oder `>8` Fehler).
- **Crash beim Klick auf Custom-/Google-Import-POIs (`Cannot read properties of undefined (reading 'select')`).** `initCustomPois` destrukturierte `selection` aus den Deps, während es in `main.ts` noch nicht zugewiesen war (Zirkulärabhängigkeit: `selection` braucht `customPois.editCurrent`, `customPois` braucht `selection`) → die Klick-Closure hielt für immer `undefined`. OSM-POIs waren ok (lazy `let`-Zugriff), Custom-POIs brachen. Fix: `selection` wird jetzt als Getter (`getSelection: () => selection`) lazy reingereicht.
- **Custom-POI-Editor: „Bitte einen Namen eingeben" beim Editieren importierter POIs.** `querySelector('[data-ref="name"]')` fand das `<h2>` aus dem Detail-Panel vor dem `<input>` im Editor → Name wurde immer als leer erkannt. Queries jetzt auf `.custom-poi-editor` gescoped.
- **Custom-POI-Marker: nach Edit wieder alter Name beim Neuklick.** `CustomPoiMarkerManager.updatePois()` hat existierende Marker übersprungen → deren `onClick`-Closure hielt den ursprünglichen POI. Marker mit geänderten Daten werden jetzt neu erstellt.
- **Detail-Panel blockierte die Karten-Controls (`pointer-events`).** Der Host `#detail-panel` ist ein 340 px breiter, absolut positionierter Streifen am rechten Rand (z-index 1) und fängt Klicks ab – auch wenn das eigentliche Panel `display: none` ist. Dadurch war u. a. der Layer-Switcher (Karte/Satellit) oben rechts nicht mehr bedienbar. Host jetzt `pointer-events: none`, das sichtbare `.poi-detail-panel` `pointer-events: auto` → der leere Streifen lässt Klicks zur Karte durch, das offene Panel fängt seine eigenen weiter ab. Mobil unberührt (Host dort `position: static`).

### Added
- **Info-Panel im Side-Menü** – zeigt App-Info, Version und den CHANGELOG.md direkt in der App an
- **Löschen-Button (X) in der Searchbar** – leert das Suchfeld mit einem Klick
- **Nightly Overpass Cache Warmup** – 27 Regionen werden täglich via GitHub Actions vorgewärmt
- Integrationstests für Edge Functions (`npm run test:int`) – 14 HTTP-Tests gegen alle 7 Endpunkte
- CI: Integrationstests laufen gegen Production-EF vor jedem Frontend-Deploy

### Changed
- **Routing-Toggle als Leaflet-Control** (unten links) – Routing-Modus (🚗/🚲/🚶) aus der Filterleiste in ein kompaktes Karten-Control ausgelagert; Filter-Panel entlastet
- **Locate + Routing horizontal kombiniert** – beide Buttons liegen jetzt nebeneinander in einer Zeile
- Express-Server durch Supabase Edge Function `api` ersetzt
- Frontend-Hosting: Render → GitHub Pages (via GitHub Actions)
- API-Proxy via `VITE_API_BASE` → Supabase Edge Functions URL
- Overpass-Cache: PostgREST → `supabase-js` Client

### Added
- `supabase/functions/api/`: 7 Handler (health, overpass, geocode, route, nearby, mapillary, notes) + Router
- `supabase/functions/_shared/utils.ts`: Ports der Server-Utilities (isValidPoiQuery, snapBboxInQuery, decodeValhallaPolyline, etc.)
- GitHub Actions Workflow: `deploy-pages.yml` für automatischen Build + Deploy
- `public/404.html`: SPA-Fallback für GitHub Pages

### Fixed
- **iOS PWA Vollbild** – Karte per `position:absolute` in `#content` verankert; ios-spezifische `100vh`/`100%`-Kämpfe; Detail-Panel mobil Buttons unten angedockt; doppeltes `safe-area-inset` entfernt
- **SW-Update** – Polling alle 3 Minuten + sofortiger Check bei PWA cold start + focus-event als Fallback für iOS PWA
- **SW-Registrierung** ohne `virtual:pwa-register` (manuelles `navigator.serviceWorker.register`)
- **Auth redirect URL** inkl. Pfad (GitHub Pages Subdir)
- **auth-input + search-input `font-size: 16px`** (verhindert iOS-Zoom bei Fokus)
- **Keyboard nach Suche** wird nach Auswahl eines Ergebnisses ausgeblendet
- **Detail-Panel** 30px tiefer positioniert
- **Auth-Close-Button** Touch-Target vergrößert
- **Sidebar** – veraltete "v4"-Version aus Header entfernt
- CORS: nur bekannte Origins werden akzeptiert (github.io, capacitor://localhost)

### CI
- Unit-Tests vor Integrationstests in der CI-Pipeline
- Integrationstests laufen gegen Production-EF vor jedem Frontend-Deploy

### Cache
- **Overpass-Cache TTL 7→30 Tage**, BBOX_SNAP 0.05→0.2° – reduziert Overpass-Queries bei wiederholtem Pan/Zoom
- Mapillary-Rate-Limit: 20 req/min pro IP via Supabase-Backend
- **„Mein Standort"-Button auf der Karte.** Ein Control unten links zentriert die Karte (Zoom 15) auf den aktuellen Standort; ist noch keiner bekannt, wird einer angefragt (mit Status-Hinweis, Fehlertoleranz bei Ablehnung). `MapService.onLocate` + `createLocateControl`.
- **Einheitlicher Map-Control-Look.** Zoom-In/Out, Layer-Switcher und Standort-Button haben jetzt dieselbe Optik (Größe, Hover-Tint, Lucide-Icons): Leaflets „+/−"-Glyphen wurden durch Lucide-Plus/Minus ersetzt, das Zoom-Styling an Layer/Locate angeglichen (`#map`-gescopt, um Leaflets eigenes CSS zu überschreiben).
- **Navigation: freier Startpunkt + „Losfahren"-Deeplink.** Routen gingen bisher immer vom aktuellen Standort aus. Jetzt:
  - **Von hier starten**: ein POI lässt sich als Routenstart setzen (Button im Detail-Panel) → Folge-Ziele werden von dort geroutet (z.B. Parkplatz → Stellplatz). Funktioniert **auch ohne Standortfreigabe**. Das Panel zeigt den aktuellen Start („Start: …") mit Reset auf „Mein Standort".
  - **Losfahren (Navi)**: öffnet echtes Turn-by-Turn in **Google bzw. Apple Maps** (plattform-erkannt) mit Start + Ziel + Verkehrsmittel — die App plant, das Telefon-Navi fährt. Ersetzt den alten reinen „In Google Maps öffnen"-Link.
  - Routing-State über `session.routeOrigin` + `resolveOrigin`; Deeplink-Builder (`buildGoogleDirectionsLink`/`buildAppleDirectionsLink`/`buildNavLink`) in `DirectionsService`.
  - **Kompaktere Aktions-Buttons**: die sekundären Panel-Aktionen (Losfahren, Von hier, OpenStreetMap) liegen jetzt in einem 2-Spalten-Raster statt full-width gestapelt.
  - **Docked Action-Footer**: die Aktions-Leiste ist als Footer am unteren Panel-Rand fixiert (Header oben fix, Mitte scrollt) — Buttons bleiben immer erreichbar, auch bei viel Inhalt.
  - **⋮-Overflow-Menü**: POI-bezogene Aktionen (Bearbeiten/Löschen für eigene POIs) wandern aus der Button-Leiste in ein Kebab-Menü im Header (schließt bei Außenklick/Escape, ARIA-Menu).
- **Klettergebiete als POI-Typ.** Neuer Filter „Klettern" (Lucide-Berg-Icon, lila Marker) zeigt OSM-`sport=climbing` (Crags, Klettergärten, Hallen) als Nodes/Ways/Relations. Standardmäßig an, über die Filterleiste umschaltbar. Keine Server-Änderung nötig — die Query-Grammatik-Allowlist akzeptiert den Tag-Filter bereits.
- **Eigene POIs (Custom POIs)** — Nutzer können eigene Punkte auf der Karte anlegen, bearbeiten und löschen:
  - Anlegen über den **„+"-Button** (Platzierungs-Modus) oder **Rechtsklick / Long-press** auf die Karte.
  - **Editor-Modal** mit Lucide-**Icon-Picker** (20 Icons), Name, Adresse, Kontakt, Details (Gebühr/Kapazität/Öffnungszeiten/Betreiber/Beschreibung) und eigener Notiz.
  - Eigene Marker mit dem gewählten Icon; Klick öffnet den Detail-View, von dort **Bearbeiten/Löschen**. Über den Filter ein-/ausblendbar.
  - Speicherung **lokal + optionaler Supabase-Sync** bei Login (`SyncedCustomPoiStore`, analog zu Favoriten/Notizen): lokaler Mirror ist führend für Reads, Writes gehen im Hintergrund durch, Sync-Fehler blockieren nie die UI. Beim Login werden Server-POIs in den Mirror gemerged (lokale Kopie gewinnt bei gleicher ID) und der vereinte Stand hochgeschoben. Migration `0005_custom_pois.sql` (Tabelle + RLS, `user_id = auth.uid()`); optionale Felder/Timestamps liegen in der `data`-jsonb-Spalte.
  - Slice `features/custom-pois/` (lokaler + synchronisierter Store, Editor, MarkerManager, Modell) inkl. Unit-Tests.

### Fixed
- **Auth-Panel: TDZ-ReferenceError beim Session-Recovery.** `getStats` im AuthPanel griff per Closure auf `favorites`/`notes` zu, die erst später mit `const` deklariert wurden – Sobald Supabase asynchron eine Session recovered, feuert der Subscriber → AuthPanel rendert → TDZ-Zugriff → `ReferenceError`. Deklarationen jetzt vor den Auth-Block gezogen.
- **Nearby-Route-Toast zeigte „undefined" vor dem Namen.** Beim Antippen eines „In der Nähe"-Eintrags wurde ein nicht existierendes `item.icon` in den Status-Toast interpoliert (der Toast rendert reinen Text, kann also kein Icon zeigen). Nachricht jetzt über die pure `nearbyRouteMessage(item, route)` (`Name · Distanz · Dauer zu Fuß`) — mit Regressions-Test.
- **PWA-Update-Benachrichtigung erscheint jetzt zuverlässig.** Ursache war ein Widerspruch zwischen `registerType: 'autoUpdate'` (skipWaiting + automatischer Reload) und dem manuellen Update-Banner, das auf `updatefound` lauschte — Races (Listener zu spät angehängt; schon-wartender SW feuert nicht erneut) und der Auto-Reload überholte das Banner. Umstellung auf den **Prompt-Flow**: `registerType: 'prompt'`, SW-Registrierung selbst über `virtual:pwa-register` (im Bundle → `script-src 'self'`-konform, `injectRegister: null`), Banner an `onNeedRefresh` gekoppelt (feuert auch bei bereits wartendem SW), Button ruft `updateSW(true)` (skipWaiting + Reload). Zusätzlich Re-Check auf neue Version bei Tab-Fokus für lang laufende (installierte) Sessions.
- **Custom-POI-Editor: Layout & Mobil.** Icon-Picker + Name liegen jetzt voller Breite oben, darunter zwei balancierte Spalten (Adresse/Kontakt | Details/Notiz) statt einer überlangen linken Spalte mit Loch unten rechts. Auf Mobil (`max-width: 639px`) öffnet der Editor **vollflächig** und überdeckt den Detail-View korrekt (Editor-`z-index` von 1000 → 1900, über dem mobilen Detail-Bottom-Sheet `1100`); Overlay mit Dim-Hintergrund.

### Changed
- **Alle Emojis durch Lucide-SVG-Icons ersetzt** — konsistentes, modernes Erscheinungsbild ohne System-Emojis:
  - POI-Typen (Parkplatz, Stellplatz, Camping, Entsorgung, Wasser) via `typeIcon()` in `poiMeta.ts`
  - Filter-Buttons, Marker-Icons, Favoriten-/Notizen-Liste, Side-Menü, Detail-Panel (Close, Heading, Route-Button, Heart)
  - Auth-Profil (Favoriten/Notizen-Zeile), Topbar-Logo, Nearby-Server-Icons
  - Map-Marker-Badges (Herz + Notiz) als skalierte Lucide-Pfade
  - Lade-Indikator-Emoji in `PoiDetailPanel` ersetzt
- **Routing-Modus**: Native `<select>`-Dropdown mit Emoji-Optionen (🚗🚲🚶) durch Segment-Button-Gruppe mit Lucide-SVGs (`car`/`bike`/`person-standing`) ersetzt — besser sichtbar und touch-freundlich
- **SideMenu**: `decorate`-Callback setzt Icons per `innerHTML` (unterstützt jetzt SVGs, nicht nur Emoji-Strings)
- **CSS-SVG-Sizing**: Einheitliche Größen-Regeln für alle neuen Inline-SVGs in Headings, Buttons und Close-Icons
- **POI-Laden: eine Query pro neuem Gebiet + Client-Akkumulation (Performance).** Das Problem war, dass der Cache-Key der *exakte* (gesnappte) Viewport-BBox war — Zoom/Pan erzeugten neue Keys und verwendeten bereits gesehene Flächen nicht wieder. Jetzt:
  - Jeder geladene POI landet in einem **Client-Store**; die geladenen 0,05°-Rasterzellen werden als „covered" markiert (`features/pois/coverage.ts`).
  - Ein Refresh zeichnet den Store, auf den Viewport zugeschnitten. Dadurch: **gesehener Viewport → 0 Requests, sofort** (Zoom-in/Pan-zurück/Revisit); **teils neuer Viewport → genau eine Query, nur über die Bounding-Box der noch nicht gesehenen Zellen** (ein dünner Streifen beim Pannen); **kalter Viewport → eine einzige Query** (wie vor der Umstellung, kein Kaltstart-Regress).
  - Höchstens **eine** Overpass-Query gleichzeitig: die vorige In-Flight-Query wird bei einem neueren Refresh abgebrochen → schnelles Pannen flutet den Upstream nicht (löst die 429s).
  - 250-ms-Debounce auf Karten-Bewegungen. POIs werden für **alle Typen** geladen → Filter-Umschalten ist reine Marker-Sichtbarkeit, **kein Refetch**.
  - Server-Rate-Limit `/api` 60 → 300/min (Headroom; Origin-Guard bleibt der Missbrauchsschutz).
  - Hinweis: Der Service Worker cached Overpass nie (POST + im Dev aus) — relevant sind Server-Cache (Supabase/In-Memory) + dieser neue Client-Store.

### Security
- **Overpass-Query-Validierung** (`/api/overpass`): Nur noch die App-eigene Query-Form (bbox-begrenzte `node`/`way`/`relation`-Tag-Filter, `out center tags`, Timeout ≤ 30 s, ≤ 40 Statements) wird zum Upstream durchgereicht — beliebiges Overpass-QL (around-Filter, Rekursion `>;`, `out body`-Dumps ohne bbox, Riesen-Timeouts) → 400, bevor Cache oder Upstream berührt werden. Grammatik-Allowlist statt Tag-Allowlist: neue POI-Typen funktionieren ohne Server-Anpassung (per Property-Test gegen den echten Client-`buildQuery` abgesichert).
- **API-Härtung nach Security-Audit** (Audit-Ergebnis: keine kritischen Lücken; npm audit 0, RLS live verifiziert, Service-Key nicht im Bundle, Header/CSP stark):
  - **Origin-Guard für `/api/*`**: Cross-Site-Browser-Traffic (fremde `Origin`- bzw. `Sec-Fetch-Site`-Header) wird mit 403 abgewiesen — fremde Websites können die Proxies nicht mehr als Relay missbrauchen bzw. per no-cors-Spray Upstream-Quotas (v. a. Mapillary-Token) verbrennen. Header-lose Clients (curl, alte Browser) passieren weiter; Backstop bleibt das Rate-Limit. Zusätzliche Origins (z. B. `capacitor://localhost` für native Builds) via `ALLOWED_ORIGINS`-Env.
  - **Eigenes, engeres Rate-Limit für `/api/mapillary`** (20/min) — schützt das Token-Budget.
  - **Strikte Koordinaten-Validierung** überall: gemeinsamer `parseLatLon`-Helper (`Number.isFinite` + Range-Check) ersetzt das laxe `parseFloat`/`isNaN` in `nearby`/`mapillary`/`notes`; `route` nutzt ihn ebenfalls.
  - Dev-Fix: Vite-Proxy mit `changeOrigin: false`, damit Same-Origin-POSTs den Origin-Guard passieren (Host = Origin-Host).
  - Rate-Limiter jetzt pro App-Instanz (hermetische Tests). 12 neue Tests.

### Fixed
- **Such-Dropdown wurde hinter der Karte gerendert** (z-index): `#map` bekommt einen eigenen Stacking-Context unter der Topbar, damit Leaflets Marker-/Control-Panes nicht mehr über die Autocomplete-Vorschläge gezeichnet werden.

### Changed
- POI-Details (Bilder / „In der Nähe" / Community-Hinweise) laden jetzt **auch ohne Standortfreigabe** — bisher hingen sie am Routing-Pfad und blieben ohne Standort leer. Dadurch funktionieren u. a. die anklickbaren Nearby-Routen auch ohne aktive Geolocation.

### Added
- **Routen zu Nearby-POIs.** Die „In der Nähe"-Einträge im Detailpanel sind jetzt anklickbar: ein Tipp zeichnet einen **zweiten, gestrichelten Track in anderer Farbe** (blau) vom geöffneten POI zum Nearby-POI (zu Fuß) und zeigt Distanz + Zeit als Hinweis. `/api/nearby` liefert dafür jetzt Koordinaten; neue `DirectionsService.routeSecondary`/`clearSecondaryRoute` (getrennt von der Haupt­route); aktiver Eintrag wird hervorgehoben.
- **Google-Login (OAuth)** als mail-freie Alternative zum Magic-Link: Button „Mit Google anmelden" im Konto-Modal (`auth.signInWithGoogle` → `signInWithOAuth`, voller Redirect, kein Mailversand). Magic-Link bleibt zusätzlich verfügbar.
- **Profil-Übersicht** im Konto-Modal: E-Mail, Anmeldemethode (Google / E-Mail), „Mitglied seit" und Live-Zähler für Favoriten + Notizen, plus Abmelden. Setup-Doku für den Google-Provider in der README.

### Changed
- **Overpass: HPI-Instanz (`osm.hpi.de`) zuerst** + robusterer Fallback. Die Endpoint-Liste wird der Reihe nach probiert; bei **Timeout, 429 und allen 5xx (inkl. 504 Gateway Timeout)** wird jetzt der nächste Endpoint versucht statt den Fehler durchzureichen. Behebt die abbrechenden/langsamen Requests (overpass-api.de lieferte u. a. 504-HTML). Per-Versuch-Timeout auf 15 s.
- **HTML-Views als `.html`-Partials statt imperativem `createElement`-Code:** Markup lebt jetzt in eigenen `.html`-Dateien pro View (per Vite `?raw` importiert) — kein Dependency, keine Template-Engine, kein Magic, CSP-safe (kein `eval`).
  - **Iteration steht im HTML, nicht in TS:** Listen tragen `data-list` + ein `<template data-row>` (die Wiederhol-Einheit) + optional `[data-empty]`; Bindings über `data-text="key"` und `data-on="name"`. TS liefert nur noch Daten + Handler. Neuer Helfer `core/bind.ts` (`renderList`).
  - Helfer `core/template.ts` (`clone`/`ref`/`cloneFragment`) für Shell-Markup + `core/pagination.ts` (gemeinsamer Seiten-Footer beider Listen).
  - Migriert: `SideMenu`, `AuthPanel`, `FavoritesListPanel`, `NotesListPanel`, **`PoiDetailPanel`** (Shell als Partial, Tag-Tabelle als `<template data-row>`). Das ersetzt die große HTML-Template-String-`renderHtml` und beseitigt deren `esc()`/`innerHTML`-XSS-Fläche (Werte jetzt via `textContent`, Links als echte `<a>` mit `safeUrl`).
- Favoriten-Liste zeigt die **persönliche Notiz** (mit 📝) als Unterzeile, falls vorhanden — sonst wie bisher den Typ. Macht Favoriten leichter unterscheidbar; aktualisiert sich live beim Speichern einer Notiz.

### Added
- **Persönliche Notizen pro POI** (Slice `features/notes/`):
  - Block **„📝 Meine Notiz"** im Detailpanel (Textfeld + Speichern), klar getrennt von den Community-OSM-Hinweisen. Speichern beim Klick und beim Verlassen des Felds; leeres Feld löscht die Notiz.
  - Neuer Menüeintrag **„📝 Notizen"** → Overlay-Liste aller Orte mit Notiz (Notiztext als Vorschau), Tippen → Karte zentrieren + Detail öffnen, Löschen pro Eintrag.
  - Speicherung lokal (localStorage) + bei Login zu Supabase gesynct (RLS pro Nutzer); Merge bei Login als Union, **lokale Bearbeitung gewinnt** bei Konflikt und beide Seiten werden konsistent. Migration `0004_notes.sql`.
  - 31 neue Tests (`NotesStore` inkl. Persist/Merge, `SyncedNotesStore`-Sync/Write-Through/Disconnect, `NotesListPanel`, `poiMeta`).
- **Favoriten-Liste** als Vollbild-Overlay über der Karte, erreichbar über zwei neue Menüeinträge **„🗺️ Karte"** und **„⭐ Favoriten"**:
  - Paginierte Liste (8/Seite) aller Favoriten mit Typ-Icon, Name (bzw. Typ als Fallback) und Entfernen-Button.
  - Klick auf einen Favoriten → Overlay schließt, Karte zentriert auf den POI und startet die Route vom Standort (`selection.select`).
  - Neue Pure-Helfer `paginate`, `poiLabel` (Typ-Icon/Label, `toFavoritePoi`/`favoriteToPoi`); neue `FavoritesListPanel`-Komponente.
  - 27 neue Tests (Store-Snapshots inkl. Legacy-Migration, Panel-Rendering/Pagination/Select/Remove, `paginate`, `poiLabel`).

### Changed
- POI-Metadaten (Typ-Icon/Label) nach `features/pois/poiMeta.ts` und `paginate` nach `src/shared/paginate.ts` ausgelagert — von Favoriten- und Notizen-Liste gemeinsam genutzt (DRY).
- **Favoriten speichern jetzt einen POI-Snapshot** (Name + Koordinaten + Typ) statt nur der ID — damit die Liste ohne Live-Overpass-Abfrage funktioniert (auch offline / außerhalb des aktuellen Ausschnitts). `IFavoritesStore.toggle` nimmt nun ein `FavoritePoi`, neue `list()`-Methode; Migration `0003_favorites_snapshot.sql` ergänzt die Supabase-Spalten (nullable → alte Zeilen bleiben gültig). Alt-Favoriten (nur IDs) im localStorage werden migriert: Herz am Marker bleibt, in der Liste erscheinen sie erst nach erneutem Favorisieren.
- Install-Button (⬇️) aus der Topbar entfernt — auf iOS war er nur ein Hinweis, kein echter Install-Trigger. Der `install`-Slice (`installPrompt.ts`) bleibt erhalten und wird später als Hilfe-Eintrag im Seitenmenü wiederverwendet.

### Removed
- **„v4"-Badge** aus dem App-Header entfernt.
- **„Karte"-Menüpunkt** aus dem Seitenmenü entfernt (nicht mehr benötigt).

## [0.9.0] - 2026-06-07

### Added
- **Server-Favoriten (Supabase)** — Phase 3 der Server-Erweiterung:
  - Neue `favorites`-Tabelle (`supabase/migrations/0002_favorites.sql`), RLS-geschützt: jede:r sieht/ändert nur eigene Zeilen (`auth.uid() = user_id`). Zugriff direkt vom authentifizierten Client über den anon-Key — **kein Express/Service-Role nötig**.
  - `SyncedFavoritesStore` (Slice `features/favorites/`): gleiche **synchrone** `IFavoritesStore`-Schnittstelle, lokaler Mirror bleibt für sofortige Reads maßgeblich. Bei Login werden Gast-Favoriten (localStorage) mit den Server-Favoriten **gemerged** (Union), Toggles schreiben im Hintergrund durch (`createSupabaseFavoritesBackend`). Sync-Fehler blockieren nie die UI.
  - `LocalFavoritesStore.addMany()` für den Merge (fügt hinzu ohne zu entfernen, benachrichtigt einmal).
  - Verdrahtung in `app/main.ts`: ein gemeinsamer `auth`, `auth.onChange` → `connect`/`disconnect` + Marker-Favoriten aktualisieren.
  - 13 neue Tests (`SyncedFavoritesStore`-Merge/Write-Through/Disconnect/Fehlerfälle, `addMany`).

## [0.8.0] - 2026-06-07

### Added
- **Login (Supabase Auth, Magic-Link)** — Phase 2 der Server-Erweiterung:
  - Neuer Slice `features/auth/`: `authClient` (Client aus `VITE_SUPABASE_*`), `createAuth` (sendMagicLink/signOut/currentUser/onChange), pure `isValidEmail`, `AuthPanel` (Modal).
  - ☰-Menü-Eintrag **„👤 Konto"** → Modal: passwortloser Login per E-Mail bzw. „Angemeldet als … · Abmelden".
  - **Gated:** ohne `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` ist Login einfach aus → PR sicher mergebar.
  - `@supabase/supabase-js` als Client-Dependency; Server-CSP `connect-src` um die Supabase-Origin erweitert; `render.yaml` + `.env.example` um die `VITE_SUPABASE_*` ergänzt.
  - 16 neue Tests (`isValidEmail`, `createAuth` mit Mock-Client, `AuthPanel`-Rendering/Flows).
  - Gebrandete deutsche E-Mail-Templates (Confirm signup + Magic Link) unter `supabase/templates/` zum Einpflegen ins Supabase-Dashboard.

### Changed
- POI-Cache-Auswahl im Test immer In-Memory (`NODE_ENV==='test'`) — Suite bleibt hermetisch, auch wenn lokal eine `.env` mit Supabase-Keys liegt.
- README aktualisiert: Tech-Stack (CARTO Voyager + Esri, PWA, Supabase), Features, Supabase-Setup, pluggable Cache-Hinweis.

## [0.7.0] - 2026-06-07

### Added
- **Sidebar-Menü** (`features/menu/`): Hamburger-Button (☰) in der Topbar öffnet einen Slide-in-Drawer mit Backdrop; ESC/Backdrop schließen. Datengetriebene Einträge — leicht erweiterbar.
- Erster Eintrag **„Cache leeren & neu laden"**: löscht alle Service-Worker-Caches + meldet den SW ab und lädt neu → erzwingt die frischeste App-Version (Nutzerdaten in localStorage bleiben). Behebt die SW-Stale-Krux ohne DevTools.
- 9 neue Tests (`clearAppCache`, `SideMenu`)

## [0.6.0] - 2026-06-07

### Added
- **Persistenter POI-Cache (Supabase Postgres)** — Phase 1 der Server-Erweiterung:
  - Pluggable async `PoiCache`-Interface mit zwei Implementierungen: `createSupabaseCache` (persistent, via PostgREST + `fetch` — **keine neue Server-Dependency**) und `createInMemoryCache` (Fallback).
  - Aktiv, sobald `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` gesetzt sind; sonst In-Memory-Fallback → **PR sofort sicher mergebar**, der Cache überlebt dann Render-Restarts.
  - TTL 7 Tage (OSM-POIs ändern sich langsam). Cache-Fehler werden geschluckt — nie im Request-Pfad.
  - SQL-Migration `supabase/migrations/0001_poi_cache.sql` (Tabelle `poi_cache`, RLS an, service-role-only).
  - `render.yaml` + `.env.example` um `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` erweitert.
  - 10 neue Tests (In-Memory-TTL/Eviction, Supabase get/set inkl. Stale-/Fehlerfälle).

### Changed
- Overpass-Route nutzt jetzt das async `PoiCache`-Interface (`await cache.get/set`) statt der synchronen `getCached/setCached`.

## [0.5.0] - 2026-06-07

### Changed
- **Frischer, erdiger „Camper"-Look** über ein CSS-Design-Token-System (`:root`-Variablen, keine neue Dependency):
  - Palette: warmes Off-White, Oliv/Forest-Akzent (`#5E6B4F` / Topbar `#4B5640`) statt Tech-Blau, Terrakotta für Links/Highlights, Sand-/Tinten-Töne
  - Weichere Rundungen, ruhigere Schatten, aufgeräumte Komponenten (Topbar, Filter-Chips, Dropdown, Suche, Detail-Panel, Badges, Lightbox)
- **Karten-Default: CARTO Voyager** (clean, gedämpft, erdig — gratis, kein API-Key) statt OSM-Standard; Satellit bleibt als zweiter Layer
- App-Icon-Hintergrund auf Oliv, Camper-Fenster auf gedämpftes Slate (statt Tech-Blau); PWA `theme_color`/`background_color` + `theme-color`-Meta angepasst
- Routen-Polylinien (Auto/Rad/Fuß) und Standort-Marker auf die erdige Palette umgestellt

### Fixed
- CSP: `img-src` um `*.basemaps.cartocdn.com` erweitert (sonst blockt die Karte in Production)

## [0.4.1] - 2026-06-07

### Changed
- **Client auf Vertical Slices umgestellt** — Organisation nach Feature statt technischer Schicht: `app/` (Composition Root), `core/`, `features/{map,pois,poi-detail,routing,search,filters,favorites,install}`. Pfad-Aliase `@/` → `src/client/`, `@shared/` → `src/shared/` (Vite + tsconfig).
- **`main.ts` von 364 → ~150 Zeilen** (reines Wiring). Aus der God-`init()` extrahiert:
  - `app/session.ts` — expliziter UI-State statt verstreuter Closure-`let`s
  - `app/selection.ts` — der zuvor 3-fach duplizierte „select → route → show → load"-Flow (Marker-Klick / Navigate / Routing-Wechsel) an einer Stelle
  - `app/poiRefresher.ts` — Bounds → Overpass → Marker → Status (Abort/Slow-Hint/Zoom-Guard gekapselt)
  - `features/map/leafletAdapter.ts` — Leaflet-`MapAdapter`-Implementierung (war inline)
  - `features/map/locationMarker.ts`, `features/map/panIntoView.ts` (pure Pan-Mathematik)
  - `features/pois/statusMessages.ts` (pure Overpass-Fehler-/Count-Texte)
  - `features/poi-detail/poiData.ts` (Wikimedia/Mapillary/Nearby/Notes-Lader + pure Helpers)
- 24 neue Unit-Tests für die extrahierten Pure-Units + Selection-Controller (258 gesamt). Verhalten unverändert (Browser-Smoke verifiziert).

## [0.4.0] - 2026-06-07

### Added
- **PWA (installierbare App)**: `vite-plugin-pwa` (Workbox) erzeugt Service Worker + Web-App-Manifest. App ist auf iOS/Android/Desktop zum Home-Bildschirm hinzufügbar und lädt die Shell offline.
  - Caching-Strategien: App-Shell precache · OSM-/Esri-Tiles `CacheFirst` (gedeckelt, nur besuchte — tile-policy-freundlich) · `/api/*` `NetworkFirst` (kurz offline-resilient)
  - Grafisches App-Icon (Camper-Van + Mond, Camping/Overnighter-Thema) auf Markenblau — generiert aus `public/logo.svg` via `@vite-pwa/assets-generator` (`npm run generate-pwa-assets`)
  - iOS-Meta-Tags (`apple-mobile-web-app-*`, apple-touch-icon), `theme-color`, `viewport-fit=cover` + Safe-Area-Insets (Notch/Home-Indicator)
  - „Installieren"-Button (Chrome/Android via `beforeinstallprompt`) bzw. iOS-Hinweis „Teilen → Zum Home-Bildschirm"
- **Capacitor-Vorbereitung**: `apiUrl()` / `VITE_API_BASE` entkoppelt den Client vom Same-Origin-API — relativ im Web/PWA, absolut (Render-URL) für spätere native Builds. Alle API-Fetches umgestellt.
- 13 neue Tests (`apiUrl`-Auflösung, Install-Affordance + Plattform-Erkennung)

### Changed
- `.claude/launch.json` — Production-Launch-Config (`stellplatz-prod`, `node dist/server/index.js`) für PWA-/SW-Tests gegen den echten Express-Build

## [0.3.9] - 2026-06-06

### Changed
- **Filterleiste kompakter**: POI-Buttons zeigen nur noch Icons (🅿️ 🚐 ⛺ 🚿 🚰) statt Icon + Text — Klartext bleibt als `title`/`aria-label` erhalten
- **Routenmodus als Dropdown**: Auto/Fahrrad/Fußweg sind statt drei Buttons jetzt ein icon-only `<select>` (🚗/🚲/🚶, Klartext als `title`) — spart Platz, Mobile-Filterleiste passt jetzt in **eine** Zeile
- Dropdown ist immer rechtsbündig (`margin-left: auto`, Desktop + Mobile); `.filter-spacer`-Hilfs-Div entfernt
- **Status-Anzeige als schwebendes Toast**: „Lade Stellplätze…" / „Bitte weiter reinzoomen…" liegt jetzt als absolut positioniertes Pill oben mittig über der Karte statt im Flex-Flow — schiebt die Karte beim Ein-/Ausblenden nicht mehr nach unten (kein Layout-Shift)

### Fixed
- **Mobile-Filterleiste**: POI- und Routing-Buttons liefen am rechten Rand aus dem Bild (`flex-wrap: nowrap`) — auf Mobilgeräten war die Routing-Auswahl (Auto/Fahrrad/Fußweg) gar nicht erreichbar. Jetzt bricht die Leiste um: POI-Chips in eigene(r) Zeile(n), Routing-Modus darunter, kompaktere Buttons
- **Mobile-Detail-Panel war nie sichtbar** — zwei zusammenwirkende Bugs:
  1. Der `#detail-panel`-Host kollabiert auf 0px Breite (einziges Kind ist `position: absolute`), wodurch das Panel rechts außerhalb des Schirms landete → Fix: `position: fixed` relativ zum Viewport
  2. `z-index: 20` lag unter Leaflets Karten-Panes (Tile 200, Marker 600), die mangels Stacking-Context auf `#map` im Root-Stacking-Context rendern → das Panel verschwand *hinter* der Karte. Fix: `z-index: 1100` (über Panes + Controls)
- Zusätzlich: abgerundete obere Ecken + Schatten, Höhe `60dvh` (dynamische Viewport-Höhe, korrekt mit mobiler Browser-Toolbar)
- **Karten-Pan beim POI-Klick**: auf Mobile schiebt die Karte den angeklickten POI jetzt nach **oben** in den sichtbaren Streifen über dem Bottom-Sheet (statt wie auf Desktop horizontal neben das Seitenpanel)

## [0.3.8] - 2026-06-06

### Changed
- Overpass-Cache: TTL 5 min → 25 min, max. Einträge 200 → 20.000 — weniger Upstream-Requests, längere Vorhaltung bei der Spielwiesen-Nutzung

## [0.3.7] - 2026-06-06

### Added
- **Private Parkplätze visuell unterscheidbar**: Parkplätze mit `access=private`/`no` erhalten ein graues Marker-Icon mit Schloss-Badge (unten links), öffentliche bleiben blau
- `isPrivateParking()` — pure Klassifizierer in `OverpassClient.ts` (öffentlich = `yes`/`public`/`permissive`/`customers` oder kein Tag; privat = `private`/`no`)
- 13 neue Tests (Klassifizierer + Icon-Varianten + Persistenz durch Favoriten-Toggle)

### Changed
- `buildIcon(type, isFavorite, isPrivate?)` — dritter Parameter; Schloss- und Herz-Badge kombinierbar ohne Kollision (Schloss unten links, Herz oben rechts)

### Added
- **Satelliten-Ansicht**: Layer-Switcher oben rechts (Leaflet `L.control.layers`) schaltet zwischen „Karte" (OSM) und „Satellit" (Esri World Imagery) um — Marker bleiben in beiden Ansichten sichtbar
- Esri-Tiles sind gratis und ohne API-Key nutzbar; Attribution „Luftbilder © Esri, Maxar, Earthstar Geographics" wird automatisch eingeblendet
- `BASE_LAYER_CONFIGS` + `buildBaseLayers()` als pure, testbare Funktionen in `MapService.ts` (7 neue Tests)

## [0.3.5] - 2026-06-06

### Added
- ESC-Taste schließt die Sidebar (Detail-Panel) — außer wenn die Lightbox gerade offen ist (die hat ihren eigenen ESC-Handler)
- 4 neue Tests für das ESC-Verhalten in `PoiDetailPanel.test.ts`

## [0.3.4] - 2026-06-06

### Changed
- `OverpassClient.ts` → `parseElements`: `map().filter((p): p is OsmPoi => p !== null)` → `filter(notNullUndefined)` (typisiertes Predikat aus `shared/common`)
- `PoiDetailPanel.ts` → `typeLabel`: alle 5 POI-Typen abgedeckt (dump/water fehlten), `coalesce('Ort')` als Fallback
- `PoiDetailPanel.ts` → `renderNoteText`: URL-Truncation via `strEllipsisLen(45)` aus `shared/str`
- `shared/str.ts` → `strEllipsisLen`: `'...'` → `'…'` (Unicode-Ellipsis-Zeichen)

### Fixed
- `OverpassClient.ts` → `fetchPois`: `signal: undefined` via bedingtem Spread (Fehler mit `exactOptionalPropertyTypes: true`)
- `index.test.ts` → `decodeJsonParam`: fehlende Non-null-Assertion für `match![1]!` (Fehler mit `noUncheckedIndexedAccess`)

## [0.3.3] - 2026-06-06

### Added
- `src/shared/` — FP-Utilities, aus dem `util-manipulation`-Ordner extrahiert und bereinigt:
  - `fp.ts` — `compose` (getypte Overloads bis 6 Stufen), `coalesce`, `curry`, `flip`, `findOrDefault`, `not`
  - `common.ts` — `notNullUndefined`, `isNullUndefined`, `jsonCopy`, `jsonEqual`, `jsonDiff`
  - `str.ts` — `strNonNull`, `strTrim`, `strCompareAlphanumeric`, `strPadLeftWithZeroN`, `strEllipsisLen`, u. a.
  - `array.ts` — `arrayFilterNotEmpty`, `arrayUnique`, `arraySortByKey`, `arrayRemove`, u. a.
  - Vollständige Test-Suite für alle vier Module (94 neue Tests)

### Changed
- `routes/geocode.ts` — Query-Normalisierung via `compose(strTrim, strNonNull)` statt manuellem `String() + trim()`
- `routes/notes.ts` — `notNullUndefined` als Type-Guard für ersten Comment; `filter/map/filter` → `flatMap` (entfernt `[0]!`-Non-null-Assertion)
- `tsconfig.server.json` — `rootDir: src/server` → `src`, `outDir: dist/server` → `dist`; inkludiert jetzt `src/shared/**/*.ts`

### Removed
- `src/util-manipulation/` — Angular/RxJS/Date-Cruft entfernt; die nutzbaren Teile leben jetzt in `src/shared/`
  - Entfernt: `rxjs/` (Angular-Decorators + RxJS), `date/` (15 Dateien, nicht benötigt), `sort.ts` (`@angular/common`-Abhängigkeit), `fp/math.ts` (triviale Math-Wrapper), alle Nx/Angular-Konfigdateien

## [0.3.2] - 2026-06-06

### Changed
- **Server-Refactoring**: `src/server/index.ts` (417 Zeilen, alles in einer Datei) aufgeteilt in:
  - `config.ts` — Konstanten (Endpoints, UA, Cache-Parameter)
  - `cache.ts` — reine Cache-Funktionen (`createCache`, `getCached`, `setCached`)
  - `geo.ts` — reine Geo-Funktionen (`snapBboxInQuery`, `haversineMeters`, `decodeValhallaPolyline`)
  - `routes/health.ts`, `routes/overpass.ts`, `routes/geocode.ts`, `routes/route.ts`, `routes/nearby.ts`, `routes/mapillary.ts`, `routes/notes.ts`
  - `index.ts` jetzt nur noch Middleware-Wiring + Bootstrap (~55 Zeilen)
- Route-Handler als Factory-Funktionen (`createXxxRouter()`) — Composition via Parameter, keine Vererbung, keine globale State
- `nearby.ts`: `NEARBY_ICONS` + `NEARBY_LABELS` → `KIND_META` zusammengeführt (DRY)
- `nearby.ts`: `filter` + `map` + `filter(null)` → `flatMap` (lesbarer)
- `route.ts`: Koordinaten-Parsing in pure `parseCoordPair()` extrahiert
- `geo.ts`: `decodeValhallaPolyline` mit `decodeVarInt` helper — klare Rückgabe `{ value, nextIndex }`

## [0.3.1] - 2026-06-05

### Fixed
- Render build: vite 8→7 (rolldown/binding-linux-ppc64-gnu fehlende Version crashte npm install auf Linux)
- Render build: `npm install` statt `npm ci`, Node-Version-Pin entfernt (Render nutzt Node 24 default)
- Lockfile neu generiert nach npm 11/10 Inkompatibilität

## [0.3.0] - 2026-06-05

### Added
- **Render.com Deployment**: `render.yaml` — ein einziger Web Service (Express) serviert `/api/**` + statischen Client-Build; Build/Start/Health-Check vorkonfiguriert
- `tsconfig.server.json` — separates TS-Kompilierungsziel für den Server (`node16`-Auflösung, kein DOM, Ausgabe nach `dist/server/`)
- `npm run build:client` / `npm run build:server` — separate Build-Targets; `npm run build` führt beide aus
- **Security Hardening** (vollständiger Codebase-Review):
  - `safeUrl()` in PoiDetailPanel — blockt `javascript:`-Protokoll in OSM `website`/`phone`/`email`-Tags (XSS)
  - `helmet` — CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
  - `app.set('trust proxy', 1)` — korrektes `req.ip` hinter Load Balancer
  - Overpass-Body-Limit 4 kb (DoS-Mitigation)
  - Koordinatenvalidierung (`isFinite` + Bereichsprüfung) in `/api/route`
  - Viewbox-Format-Validierung in `/api/geocode`
  - Mapillary-Token aus URL-Query-Param → `Authorization`-Header (verhindert Log-Leakage)

### Changed
- `.env.example` — Firebase-Hinweise durch Render-Hinweise ersetzt

## [0.2.0] - 2026-06-04

### Added
- **Favoriten**: Herz-Button (♡/♥) im Detail-Panel-Header — ein Klick markiert einen POI als Favorit
- Favorisierte Marker erhalten ein rotes Herz-Badge (kleiner roter Kreis oben rechts am Marker-Icon)
- Favoriten werden in `localStorage` gespeichert und bleiben nach Reload erhalten
- `LocalFavoritesStore` implementiert `IFavoritesStore`-Interface — vorbereitet für Firebase-Swap (gleiche API, anderer Backing Store)
- `PoiMarkerManager.setFavorites()` aktualisiert alle sichtbaren Marker-Icons live ohne Neu-Laden
- 9 neue Tests für `LocalFavoritesStore`, 4 neue Tests für Marker-Icons (101 Tests gesamt)

## [0.1.9] - 2026-06-04

### Added
- **Öffnungsstatus-Badge**: grüner/roter Streifen unter dem Titel mit "Geöffnet · schließt HH:MM" / "Geschlossen · öffnet HH:MM" (parst `Mo-Fr HH:MM-HH:MM`-Syntax, keine externe Library)
- **„In der Nähe"**: neuer Panel-Abschnitt mit Entfernung zu Tankstelle ⛽, Supermarkt 🛒, Apotheke 💊, Bäckerei 🥐, Entsorgung 🚿, Frischwasser 🚰 (max 2 km, Haversine, sortiert nach Distanz) via neuem `/api/nearby`-Proxy
- **Entsorgung & Wasser als eigene Kartenebene**: zwei neue Filter-Buttons in der Filterleiste; eigene Marker und Overpass-Queries für `amenity=sanitary_dump_station` und `amenity=water_point`
- 6 neue Server-Tests für `/api/nearby`, 2 neue Client-Tests (87 Tests gesamt)

## [0.1.8] - 2026-06-04

### Added
- Bildergalerie im Detail-Panel: scrollbarer Streifen direkt unterhalb der Routen-Zusammenfassung
- OSM `image`-Tag wird sofort angezeigt (direkte URL)
- `wikimedia_commons`-Tag wird via Wikimedia Commons API aufgelöst (client-seitig, CORS-fähig)
- Mapillary Street-Level-Fotos (bis 6 Bilder, ~50 m Radius) über neuen Server-Proxy `/api/mapillary`
- `MAPILLARY_ACCESS_TOKEN` in `.env.example` — ohne Token liefert der Endpunkt ein leeres Array
- 4 neue Server-Tests für `/api/mapillary` (81 Tests gesamt)

## [0.1.7] - 2026-06-04

### Added
- Detail-Panel massiv erweitert: typ-spezifische Tags für Parking (Belag, Höhe, überdacht, bewacht, Park&Ride) und Camping/Stellplatz (Strom, Wasser, Dusche, Toilette, Entsorgung, WLAN, Hunde, Sterne)
- Adressen aus `addr:*`-Tags zusammengesetzt, E-Mail als `mailto:`-Link
- Community-Hinweise aus der OSM Notes API (300 m Radius) laden asynchron nach und erscheinen gelb hervorgehoben unter dem Panel
- Neuer Server-Proxy `/api/notes` (4 Tests)

## [0.1.6] - 2026-06-04

### Added
- Server-seitiger In-Memory-Cache für Overpass-Antworten (TTL 5 min, max 200 Einträge)
- BBox-Snapping auf 0,05°-Raster (~5 km): leicht unterschiedliche Viewports treffen denselben Cache-Eintrag — zweiter Request in der gleichen Region kommt sofort zurück

## [0.1.5] - 2026-06-04

### Fixed
- Routing-Modi liefern jetzt wirklich unterschiedliche Routen: OSRM-Public-Server durch **Valhalla** (`valhalla1.openstreetmap.de`) ersetzt, das `auto`/`bicycle`/`pedestrian` mit eigenen Algorithmen berechnet
- Korrekte API: GET mit `json=`-Param (nicht POST); Polyline-Decoder für Valhalla-6-dezimal-Format
- Server-Proxy transformiert Valhalla-Response in OSRM-kompatibles Format für den Client

## [0.1.4] - 2026-06-04

### Added
- Routing-Modus-Auswahl: 🚗 Auto / 🚲 Fahrrad / 🚶 Fußweg in der Filterleiste
- OSRM-Proxy nutzt jetzt das passende Profil (`driving` / `cycling` / `foot`)
- Polyline-Farbe je Modus: blau (Auto), grün (Fahrrad), orange (Fußweg)
- 3 neue Server-Tests für Modus-Parameter (ungültige Werte → Fallback auf `driving`)

## [0.1.3] - 2026-06-04

### Added
- Marker-Clustering via `leaflet.markercluster` — bei vielen POIs werden Gruppen gebündelt (farbcodiert grün/gelb/orange/rot nach Dichte), einzelne Marker ab Zoom 17

### Fixed
- Overpass `openstreetmap.fr` als erster Endpoint (antwortet in <2s)
- Per-Endpoint-Timeout auf 20s gesetzt; Fallback auf 4 Endpoints statt 3
- Client zeigt "Warte auf Overpass-Server…" nach 8s damit der User weiß dass es normal ist

## [0.1.2] - 2026-06-04

### Changed
- **Komplette Migration auf OpenStreetMap**: Google Maps vollständig entfernt
  - Karte: Google Maps JS API → Leaflet.js mit OSM-Tiles
  - Suche: Google Places Autocomplete → Nominatim (via `/api/geocode` Express-Proxy)
  - Routing: Google Directions API → OSRM (via `/api/route` Express-Proxy)
  - Kein Google Maps API-Key mehr erforderlich, `/api/maps-key` entfernt
  - Externer POI-Link: "In Google Maps öffnen" → "Auf OpenStreetMap anzeigen"
- `SearchBar` neu: eigenes Dropdown-Autocomplete mit Nominatim-Ergebnissen
- `DirectionsService` neu: OSRM-Routing mit GeoJSON-Polyline auf Leaflet-Karte
- `MapService` ersetzt `GoogleMapService` (Leaflet-basiert, kein Google-Typ-Abhängigkeit)

### Added
- 67 Unit-Tests (7 mehr als zuvor: neue SearchBar-Tests + neue Server-Proxy-Tests)

## [0.1.1] - 2026-06-04

### Changed
- Overpass API requests now go through Express proxy (`/api/overpass`) instead of being made directly from the browser — fixes `ERR_CONNECTION_REFUSED` in browser, removes CORS exposure
- Express proxy rotates across 3 Overpass endpoints with a 12s timeout each and a mandatory `User-Agent` header
- Improved error messages: 429 and 503 states now show descriptive German text in the status bar

## [0.1.0] - 2026-06-04

### Added
- Initial project scaffold (Vite + TypeScript + Node.js/Express)
- Express server with Google Maps API key proxy (`/api/maps-key`)
- Rate limiting on API routes
- Google Maps integration with Geolocation start marker
- Overpass API client for querying OSM POIs (parking, camper pitches, campsites) in viewport
- POI marker manager with per-type SVG icons and MarkerClusterer
- Detail side panel with OSM tags (name, hours, phone, website, fees, capacity)
- Google Maps Directions routing with distance/time display and deeplink
- Search bar with Google Places Autocomplete scoped to viewport
- Filter panel with toggleable POI types, state persisted in localStorage
- Unit tests for all modules (Vitest + MSW)
- Git repository initialized
