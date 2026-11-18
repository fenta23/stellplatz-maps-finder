# KI-Sidecar — Umsetzungsplan

> Status: **Planung** (kein Code). Stand: 2026-06-15.
> Entscheidung: Inferenz läuft als **Supabase Edge Function**, modell-agnostisch über
> einen **OpenAI-kompatiblen Provider mit offenen Modellen** (Llama/Qwen/Mistral),
> Default **OpenRouter** — kein Vendor-Lock-in, im Open-Source-Geist des Projekts.

## Leitprinzip

Das Sidecar ist **ein schmaler Layer neben der App**, kein Umbau der Slices. Es
**ersetzt keine bestehende Suche** — es übersetzt natürliche Sprache in die zwei
Mechanismen, die schon existieren:

1. **Geocoding** (`SearchBox`, Nominatim direkt aus dem Browser (`core/nominatim.ts`)) — *wo* auf der Karte.
2. **Filter** (`FilterStore` → `filterModel` → `buildOverpassQuery`) — *was* angezeigt wird.

Die App schreibt keinen KI-Anbieter vor: Provider-Base-URL + Key + Modellname kommen
aus Env. Contributor können einen eigenen Key, Groq/OpenRouter oder lokales Ollama
nutzen.

```
AI_PROVIDER_BASE_URL   # Default: https://openrouter.ai/api/v1  (Alt: http://localhost:11434/v1 Ollama)
AI_PROVIDER_KEY        # Secret, nur serverseitig (supabase secrets set)
AI_MODEL               # z.B. meta-llama/llama-3.3-70b-instruct | qwen/qwen-2.5-72b-instruct | mistralai/mistral-large
AI_MAX_TURNS           # Max. KI-Antworten pro Chat (Kosten-Deckel). Default: 5
AI_REQUIRE_AUTH        # "true" → Chat nur für eingeloggte User. Default: "true" (Login nötig; "false" öffnet)
```

---

## Wie wir die vorhandene Suche nutzen

Die NL-Query *„ruhiger Stellplatz mit Entsorgung am Bodensee, max 30 km"* zerfällt in
Teile, die **alle** auf bestehende Bausteine mappen — nichts wird neu erfunden:

| NL-Fragment            | Bestehender Baustein                                   | Aktion                                     |
|------------------------|--------------------------------------------------------|--------------------------------------------|
| „am Bodensee"          | `SearchBox` / Nominatim (`core/nominatim.ts`)         | Karte dorthin springen (unverändert)       |
| „Stellplatz"           | `FilterDef` `camper` (built-in)                        | `FilterStore.setEnabled('camper', true)`   |
| „mit Entsorgung"       | `FilterDef` `dump` (built-in)                          | `FilterStore.setEnabled('dump', true)`     |
| nicht built-in (z.B. „mit Dusche") | `FilterDef` aus `TagCondition`s            | `FilterStore.put(adHocDef)` (wie FilterConfigPanel) |
| „max 30 km"            | `DirectionsService`-Distanz                            | clientseitige Nachfilterung der Marker     |

### Der entscheidende Punkt: Validierungsschicht existiert bereits

Offene Modelle sind bei striktem JSON/Tag-Output schwächer als Claude. Aber die App
hat die Schutzschicht schon — die KI muss nur in deren Vokabular sprechen:

- `isValidTagToken` / `isValidCondition` / `isValidSelector` (`filterModel.ts:170-198`)
- `FilterStore.put()` ruft intern `normalize()` → built-in-Tags sind gesperrt, ungültige
  User-Filter werden **verworfen** (`FilterStore.ts:39-60`).

→ **Kaputter KI-Output kann nichts erzeugen, was nicht ohnehin gültiges Filter-Vokabular
ist.** Schlimmstenfalls: ein Feld wird ignoriert. Das ist die Halluzinations-Absicherung.

### UX: eine Suchbox, KI als Dialog darin (keine zweite Bar)

Die `SearchBox` bleibt der Geocode-Default (tippen → Orts-Vorschläge, Enter → bester
Treffer). Daneben sitzt im Input ein **„✨ Mit KI suchen"-Button**, der ein **KI-Dialog
direkt in der Box** öffnet. Im Chat wird der volle Scope abgehandelt — inkl. **Rückfragen**,
wenn die Anfrage unterspezifiziert ist („ruhiger Platz" — wie weit weg? mit Strom?).

### Chat→Ergebnis-Brücke (der Kernmechanismus)

Jede KI-Antwort liefert **constrained JSON pro Turn** (robuster bei offenen Modellen als
echtes Tool-Calling):

```jsonc
{
  "status": "clarify",                                             // clarify | ready | offtopic
  "reply": "Wie weit darf der Platz von Konstanz entfernt sein?",  // Chat-Bubble
  "intent": null
}
// … wenn genug Infos da sind:
{
  "status": "ready",
  "reply": "Alles klar — Camper-Stellplätze mit Entsorgung am Bodensee.",
  "intent": {
    "place": "Bodensee",                 // → geocode (bestehender Pfad), optional
    "enableFilters": ["camper", "dump"], // → setEnabled, nur bekannte IDs
    "adHocFilters": [                    // → put(), via isValidSelector validiert
      { "name": "Dusche", "iconId": "shower", "selectors": [
        { "elements": ["node"], "tags": [{ "key": "amenity", "value": "shower" }] } ] }
    ],
    "route": null                        // oder { "from": "Konstanz" | null, "to": "Lindau", "mode": "foot"|"bike"|"car"|null }
                                         // → belegt das Routenformular der Suchbox vor (keine automatische Berechnung)
  }
}
// … bei themenfremder Anfrage:
{
  "status": "offtopic",
  "reply": "Ich helfe nur beim Finden von Stell-/Campingplätzen & Co. auf der Karte. Wonach suchst du?",
  "intent": null
}
```

Ablauf im KI-Dialog:
1. `clarify` → nur `reply` als Bubble. Chat läuft weiter (Rückfragen).
2. `ready` → `reply` + **Ergebnis-Karte** aus `intent`
   („➜ Camper + Entsorgung · Bodensee · ≤30 km") mit Primär-Button **„Auf Karte zeigen"**.
3. Klick → `intent` durch die **bestehende Validierung** (`isValidSelector` etc.) →
   `FilterStore.setEnabled/put` + Geocode-Sprung → **Dialog schließt** → normaler
   POI-Refresh läuft.
4. `offtopic` → nur die Hinweis-Bubble, **kein** `intent`, keine Karte. (siehe Scope-Guard)

**„Das Ergebnis" ist die Karte selbst** — keine separate Ergebnisliste. Der Chat befüllt
am Ende exakt denselben `FilterStore` + Geocode-Pfad, den die App schon hat.

Designentscheidungen:
- **Bestätigen statt Auto-Apply** (empfohlen): Karte ändert sich erst auf Button-Klick →
  keine Überraschung, kein Overpass-Call mitten im Chat. Alternative: Live-Vorschau hinter
  der Box (magischer, aber kostet pro Turn Tile/Overpass-Last).
- **Verfeinerung**: „und jetzt noch Wasserstellen dazu" → neuer `intent`, gleicher
  Mechanismus; Chat bleibt offen.

Client validiert jedes `intent` gegen das Schema **vor** jeder Mutation.

### Scope-Guard: Off-Topic blocken

Der KI-Dialog ist **kein allgemeiner Chatbot** — es soll nur beim Finden von
Stell-/Campingplätzen, Wasser, Entsorgung etc. auf der Karte helfen. Mehrschichtig:

1. **System-Prompt (serverseitig, im Handler fixiert)**: enge Rollenbeschreibung +
   „Bei themenfremden Anfragen: `status: "offtopic"`, freundlich zurück zum Thema lenken,
   **kein** `intent`." Der Prompt liegt im Backend, nicht im Client → vom Nutzer nicht
   überschreibbar.
2. **Strukturierter `status: "offtopic"`** statt freiem Text → die UI behandelt es
   deterministisch (nur Hinweis-Bubble, keine Karte), unabhängig vom genauen Wortlaut.
3. **Harte Absicherung im Client**: Auch wenn das Modell bei Off-Topic doch ein `intent`
   mitschickt, wird es verworfen — `enableFilters` akzeptiert nur **bekannte Filter-IDs**,
   `adHocFilters` nur, was `isValidSelector` passiert. Ein „erzähl mir einen Witz" kann
   also strukturell keinen gültigen Karten-Zustand erzeugen.
4. **Token-Deckel pro Antwort** klein halten → begrenzt Prompt-Injection-Ausuferung.

Grenzen offener Modelle: der System-Prompt ist keine 100%-Garantie gegen Jailbreaks.
Punkt 3 (Allowlist-Validierung) ist die eigentliche Sicherheit — selbst ein „ausgetrickstes"
Modell kann nur Filter aus dem erlaubten Vokabular setzen, nichts anderes.

---

## Architektur (fügt sich in das bestehende Muster)

### Backend — `supabase/functions/api/`

```
aiHandler.ts          # neuer Handler im Router (wie die 7 bestehenden Endpunkte)
_shared/aiClient.ts   # dünner OpenAI-kompatibler fetch-Wrapper (provider-agnostisch)
```

- Route: `POST /api/ai` mit `{ task: "summarize" | "chat", ... }`.
  - `summarize`: `{ tags }` → ein Satz-Block (Phase 1).
  - `chat`: `{ messages: [{role, content}, …] }` → ein Turn `{ reply, ready, intent }`.
    Verlauf kommt vom Client (stateless Edge Function); Backend hält keine Session.
- **Rate-Limiter** aus `_shared/utils.ts` wiederverwenden — bei LLM-Calls Pflicht.
  Achtung: ein Chat = mehrere Calls → pro-User/IP-Deckel auf **Calls je Zeitfenster**, nicht nur je Request.
- CORS-Allowlist greift automatisch (`fenta23.github.io`, localhost, capacitor).
- **Retry-Schleife**: JSON-Parse + Schema-Check; bei Fehler ein Korrektur-Prompt,
  dann Fallback („kein Filter erkannt" / „keine Zusammenfassung verfügbar").

### Frontend — neue vertikale Slice

```
features/ai/  AiClient.ts        # → apiUrl('/api/ai'), hält Chat-Verlauf
              AiSearchDialog.ts  # KI-Dialog in der Suchbox: Bubbles + Ergebnis-Karte + "Auf Karte zeigen"
              aiSearchDialog.html # Template (core/template.ts clone/ref)
              intentSchema.ts    # intent-JSON-Schema + Validierung (nutzt filterModel-Validatoren)
```

- Importiert **keine** Interna anderer Slices (Projekt-Regel). Verdrahtung in `app/`:
  der „✨"-Button in der `SearchBox` (bzw. die Zeile „Mit KI suchen“) öffnet den Dialog; „Auf Karte zeigen" ruft die in
  `app/` injizierten Callbacks (FilterStore-Mutation + Geocode-Sprung).
- Der Chat schreibt am Ende in `FilterStore` + nutzt den vorhandenen Geocode-Pfad —
  keine neue Ergebnis-Darstellung.

---

## Durchstich-Reihenfolge

### Phase 1 — POI-Tag-Zusammenfassung (kleinster End-to-End-Beweis) — ✅ IMPLEMENTIERT

Code: `supabase/functions/_shared/aiClient.ts`, `supabase/functions/api/aiHandler.ts`
(Route `/api/ai`, Task `summarize`), Frontend `src/client/features/ai/AiClient.ts` +
`PoiDetailPanel.setSummaryLoading()/updateSummary()`. Tests: `AiClient.test.ts` (6).
**Noch zu tun zum Scharfschalten**: Edge-Function deployen (`/api/ai`) +
`AI_PROVIDER_KEY` (OpenRouter) als Secret setzen. Ohne Key: Block bleibt aus.


OSM-Tags (`motorhome=yes`, `capacity`, `fee`, `maxstay`, `surface` …) → 2–3 Sätze Klartext.

- Daten liegen schon im `PoiDetailPanel` (`poi.tags`). Kein neuer Datenfluss.
- **Cache in Postgres** analog `poi_cache`: Key = POI-ID + Tag-Hash + Modellname, TTL 30 Tage.
  Derselbe Platz kostet nur einmal Tokens.
- UI: ein Block im `PoiDetailPanel`, lazy beim Aufklappen.
- Beweist die ganze Pipeline: Edge → Provider, Secret-Handling, Cache, Rate-Limit, neue Slice.
- **Faktentreue**: Zusammenfassung nur aus vorhandenen Tags, nichts dazuerfinden
  (Preis/Öffnung). Prompt entsprechend hart einschränken.

### Phase 2 — KI-Suche als Dialog in der Suchbox — ✅ IMPLEMENTIERT

Code: Edge-Task `chat` in `aiHandler.ts` (Turn-Limit, Scope-Guard, JSON+Retry,
optionales Auth-Gate). Frontend: `intentSchema.ts` (Allowlist-Validierung, getestet),
`AiSearchDialog.ts` + `aiSearchDialog.html`, `AiClient.sendAiChat`, „✨"-Button in der
`SearchBox` (`onAiSearch`), Apply-Wiring in `app/main.ts` (`applyAiIntent` → FilterStore + Geocode).
Tests: `intentSchema.test.ts`. Das frühere `maxDistanceKm` ist entfernt (wurde nie angeschlossen).
Eine KI-Suche **ersetzt** die aktiven Filter (`app/aiFilterApply.ts`), der Chip „Filter vor KI-Suche"
in der Filterleiste stellt den vorherigen Stand wieder her. Routenwünsche (`route`) gehen an den
Planer (`planFromNames` in `app/routePlannerWiring.ts`).

Baut auf Phase-1-Infrastruktur (gleicher Handler, gleicher Provider-Wrapper).

- „✨ Mit KI suchen"-Button in der `SearchBox` → KI-Dialog.
- Pro Turn constrained JSON `{ reply, ready, intent }`; Rückfragen bis `ready`.
- Ergebnis-Karte + „Auf Karte zeigen" → `intent` validieren → `FilterStore` + Geocode →
  Dialog schließt → POI-Refresh. Das Ergebnis ist die Karte.
- **Deutsch testen** — echte deutsche Queries (inkl. Rückfrage-Dialoge) sind das
  Risiko-Feld bei offenen Modellen.

---

## Kosten & Missbrauch (offene GitHub-Page, KI nur mit Login)

- Rate-Limit **pro IP** + täglicher Gesamt-Deckel im Handler. Chat = **mehrere Calls pro
  Sitzung** → Deckel auf Calls/Zeitfenster.
- **`AI_MAX_TURNS` (Default 5)**: harter Deckel auf KI-Antworten pro Chat. Erreicht →
  Handler antwortet mit Hinweis „bitte Suche neu starten", Client deaktiviert die Eingabe.
  Client zählt mit, Backend erzwingt es (Client-Zähler ist manipulierbar).
- **`AI_REQUIRE_AUTH` (Default true)**: der Handler lässt nur eingeloggte User durch
  (prüft Supabase-JWT); `false` öffnet ihn — kein Code-Deploy nötig, nur Secret
  umsetzen. Zusätzlich schützen Rate-Limit + `AI_MAX_TURNS`.
- **OpenRouter** als Default-Provider: größte Auswahl offener Modelle hinter einer
  OpenAI-kompatiblen API, einfacher Modellwechsel per `AI_MODEL`, eigenes Spending-Limit
  im OpenRouter-Dashboard. Base-URL bleibt austauschbar (z.B. lokales Ollama).

---

## Tests (Projekt-Regeln: jedes Feature hat Tests, jeder Bug bekommt einen Test)

- `aiClient` (BE): Provider-Wrapper, Retry-Schleife, Schema-Validierung — **gegen Fixtures,
  ohne echten Netz-Call**, inkl. absichtlich kaputtem JSON.
- `aiSearchSchema` (FE): NL-JSON → Filter-State-Mapping; ungültige IDs/Selektoren werden
  verworfen.
- Edge-Validierung wie bei den anderen Handlern.
- Caching: Hit/Miss + Tag-Hash-Stabilität.

---

## Offene Entscheidungen vor Phase 1

1. ~~Provider~~ → **OpenRouter** (entschieden). Spending-Limit im Dashboard setzen.
2. ~~Gating~~ → Login nötig (`AI_REQUIRE_AUTH` Default `true`, entschieden).
3. ~~Max. Turns~~ → **5**, per `AI_MAX_TURNS` konfigurierbar (entschieden).
4. **Modell**: Llama 3.3 70B vs. Qwen 2.5 72B vs. Mistral Large — nach Deutsch-Qualität
   (inkl. Rückfrage-Dialogen) im echten Test entscheiden. (einzige verbleibende Frage)
