import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
// Shared shell + design tokens — must load before any feature CSS (cascade base).
import '@/styles/shell.css'
import { MapService, getUserLocation } from '@/features/map/MapService.js'
import { createLeafletMarkerAdapter } from '@/features/map/leafletAdapter.js'
import { createLocationMarker } from '@/features/map/locationMarker.js'
import { panPoiIntoView, centerPoiInView } from '@/features/map/panIntoView.js'
import { createLeafletPoiHighlight } from '@/features/map/poiHighlight.js'
import { PoiMarkerManager } from '@/features/pois/PoiMarkerManager.js'
import type { OsmPoi } from '@/features/pois/OverpassClient.js'
import { createPoiTileSource } from '@/features/pois/poiTiles.js'
import { POI_TILES_BASE } from '@/core/config.js'
import { PoiDetailPanel } from '@/features/poi-detail/PoiDetailPanel.js'
import { collectTagImages, loadMapillaryImages, loadNearby, loadNotes } from '@/features/poi-detail/poiData.js'
import { loadPoiSummary } from '@/features/ai/AiClient.js'
import type { AiIntent } from '@/features/ai/intentSchema.js'
import { nearbyIconSvg } from '@/features/poi-detail/PoiDetailPanel.js'
import { createLeafletTargetMarker } from '@/features/map/targetMarker.js'
import { createNearbyWiring } from './nearbyWiring.js'
import { FilterPanel } from '@/features/filters/FilterPanel.js'
import { LocalFilterStore } from '@/features/filters/FilterStore.js'
import { SyncedFilterStore } from '@/features/filters/RemoteFilterStore.js'
import { FilterConfigPanel } from '@/features/filters/FilterConfigPanel.js'
import { routeRowTexts } from './routeRows.js'
import { setPoiMetaRegistry, typeLabel, typeIcon } from '@/features/pois/poiMeta.js'
import { filterIconPath, PERSONAL_FILTER_ID } from '@/features/filters/filterModel.js'
import { DEFAULT_PERSONAL_COLOR } from '@/features/custom-pois/CustomPoiMarkerManager.js'
import { type StyleResolver } from '@/features/pois/PoiMarkerManager.js'
import { LocalFavoritesStore } from '@/features/favorites/FavoritesStore.js'
import { SyncedFavoritesStore } from '@/features/favorites/RemoteFavoritesStore.js'
import { FavoritesListPanel } from '@/features/favorites/FavoritesListPanel.js'
import { toFavoritePoi, favoriteToPoi } from '@/features/favorites/poiLabel.js'
import { LocalNotesStore, toNoteTarget, noteToPoi } from '@/features/notes/NotesStore.js'
import { SyncedNotesStore } from '@/features/notes/RemoteNotesStore.js'
import { NotesListPanel } from '@/features/notes/NotesListPanel.js'
import { SideMenu, type MenuEntry } from '@/features/menu/SideMenu.js'
import { clearAppCache } from '@/features/menu/clearAppCache.js'
import { UpdateBanner, watchServiceWorkerUpdates } from '@/features/update/UpdateBanner.js'
import { getSupabaseClient } from '@/features/auth/authClient.js'
import { createAuth, type Auth } from '@/features/auth/auth.js'
import { AuthPanel } from '@/features/auth/AuthPanel.js'
import { InfoPanel } from '@/features/info/InfoPanel.js'
import { DatenschutzPanel } from '@/features/info/DatenschutzPanel.js'
import { ImpressumPanel } from '@/features/info/ImpressumPanel.js'
import { HelpPanel } from '@/features/help/HelpPanel.js'
import { HelpSeenStore } from '@/features/help/HelpSeenStore.js'
import { WhatsNewOverlay } from '@/features/whats-new/WhatsNewOverlay.js'
import { WhatsNewStore, shouldShowWhatsNew } from '@/features/whats-new/WhatsNewStore.js'
import { APP_VERSION } from '@/core/version.js'
import { ResponsibilityPanel } from '@/features/responsibility/ResponsibilityPanel.js'
import { createSession } from './session.js'
import { createSelection } from './selection.js'
import { createPoiRefresher, fetchSignature } from './poiRefresher.js'
import { initImport } from './importWiring.js'
import { createRouteWiring } from './routeWiring.js'
import { shouldCenterOnUser } from './startupCenter.js'
import { createProfileWiring } from './profileWiring.js'
import { createSearchBoxWiring } from './searchBoxWiring.js'
import { createUiCollapse } from './uiCollapse.js'
import { AiFilterUndoStore, applyAiFilterPlan, planAiFilterApply, restoreAiFilters } from './aiFilterApply.js'
import { createRouteEditWiring } from './routeEditWiring.js'
import { TravelModeStore } from '@/features/route-planner/TravelModeStore.js'
import { LocalProfileStore } from '@/features/profile/ProfileStore.js'
import { createRoutePoiLoader } from './routePoiLoader.js'
import { LocalRouteStore } from '@/features/route/RouteStore.js'
import { createLeafletRouteLayer } from '@/features/map/leafletRouteLayer.js'
import { initCustomPois } from './customPoiWiring.js'
import { initAuthSync } from './authWiring.js'
import { geocode } from '@/core/nominatim.js'
import {
  SVG_STAR, SVG_NOTE, SVG_USER, SVG_INFO, SVG_UPLOAD, SVG_HELP, SVG_LEAF, SVG_ROUTE, SVG_PROFILE,
} from './icons.js'
// Cross-cutting responsive overrides — must load AFTER all feature CSS so the
// media-query rules win over feature base rules of equal specificity.
import '@/styles/responsive.css'

/** Zoom for a tapped nearby entry: surroundings recognisable. */
const NEARBY_ZOOM = 17

const DEFAULT_CENTER: [number, number] = [51.163, 10.447]

function requestLocation(statusEl: HTMLElement): Promise<[number, number] | null> {
  if (!navigator.geolocation) return Promise.resolve(null)
  statusEl.textContent = 'Standort wird ermittelt…'
  statusEl.className = 'status-loading'
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve([pos.coords.latitude, pos.coords.longitude]),
      () => resolve(null),
      { timeout: 15000, maximumAge: 60000, enableHighAccuracy: false },
    )
  })
}

async function init() {
  // GitHub Pages SPA redirect
  const redirect = sessionStorage.getItem('redirect')
  if (redirect) {
    sessionStorage.removeItem('redirect')
    history.replaceState(null, '', redirect)
  }

  const mapContainer = document.getElementById('map')!
  const statusEl = document.getElementById('status')!

  // ── Early services (auth depends on favorites/notes refs) ───────────────────
  const favorites = new SyncedFavoritesStore(new LocalFavoritesStore())
  const notes = new SyncedNotesStore(new LocalNotesStore())
  const helpSeenStore = new HelpSeenStore()
  const whatsNewStore = new WhatsNewStore()

  const supabase = getSupabaseClient()
  let auth: Auth | null = null
  let authPanel: AuthPanel | null = null
  let loggedIn = false
  if (supabase) {
    auth = createAuth(supabase)
    void auth.currentUser().then(u => { loggedIn = !!u }).catch(() => {})
    auth.onChange(u => { loggedIn = !!u })
    authPanel = new AuthPanel(document.body, auth, {
      getStats: () => ({ favorites: favorites.list().length, notes: notes.list().length }),
    })
  }

  const setStatus = (msg: string, isError = false) => {
    statusEl.textContent = msg
    statusEl.className = isError ? 'status-error' : msg ? 'status-loading' : ''
  }
  const flashStatus = (msg: string) => { setStatus(msg, true); setTimeout(() => setStatus(''), 3000) }
  const flashInfo = (msg: string) => { setStatus(msg); setTimeout(() => setStatus(''), 3500) }

  // ── Map + core services ─────────────────────────────────────────────────────
  // Karte sofort mit Default-Center rendern – die App wartet NICHT (mehr) auf die
  // Geolocation. Der Standort wird unten asynchron ermittelt und zentriert die
  // Karte erst, wenn er vorliegt. So bleiben Menü & Interaktionen sofort bedienbar.
  const mapService = new MapService(mapContainer, DEFAULT_CENTER, 6)
  const map = mapService.getMap()
  const session = createSession(null)

  // ── Filters ─────────────────────────────────────────────────────────────────
  const filterStore = new SyncedFilterStore(new LocalFilterStore())
  let openProfiles: () => void = () => {}
  // Bound once the search box exists (its route planner needs routeWiring, which is created further down).
  let openPlanner: () => void = () => {}
  let offerPoiToPlanner: (poi: OsmPoi) => boolean = () => false
  const filterConfigPanel = new FilterConfigPanel(document.body, filterStore, { onOpenProfiles: () => openProfiles() })
  setPoiMetaRegistry({
    label: id => filterStore.get(id)?.name,
    iconId: id => filterStore.get(id)?.iconId,
  })
  const filterPanel = new FilterPanel(
    document.getElementById('poi-filter')!,
    filterStore,
    { onAdd: () => mapService.startPlacement(), onOpenConfig: () => filterConfigPanel.open() },
  )

  // ── Location marker ─────────────────────────────────────────────────────────
  const locationMarker = createLocationMarker(map)

  // Erst-Standort nicht blockierend ermitteln und Karte zentrieren – aber nur,
  // solange der Nutzer die Karte noch nicht selbst bewegt hat (kein Ruck/Sprung).
  let userMovedMap = false
  // Bound once routeWiring exists (created further down); the location fix arrives later.
  let isRouteActive: () => boolean = () => false
  mapService.onDragStart(() => { userMovedMap = true })
  void requestLocation(statusEl).then(userPos => {
    setStatus('')
    if (userPos) {
      session.userPos = { lat: userPos[0], lon: userPos[1] }
      locationMarker.update(userPos)
      if (shouldCenterOnUser({ userMovedMap, routeActive: isRouteActive() })) mapService.setCenter(userPos[0], userPos[1], 13)
    } else {
      flashStatus('Standort nicht verfügbar – Karte auf Deutschland zentriert')
    }
  })

  navigator.geolocation?.watchPosition(
    pos => {
      const next: [number, number] = [pos.coords.latitude, pos.coords.longitude]
      locationMarker.update(next)
      session.userPos = { lat: next[0], lon: next[1] }
    },
    () => {},
    { maximumAge: 30000, enableHighAccuracy: false },
  )

  mapService.onLocate(() => {
    if (session.userPos) {
      locationMarker.update([session.userPos.lat, session.userPos.lon])
      mapService.setCenter(session.userPos.lat, session.userPos.lon, 15)
      return
    }
    setStatus('Standort wird ermittelt…')
    void getUserLocation().then(pos => {
      if (!pos) { flashStatus('Standort nicht verfügbar'); return }
      session.userPos = { lat: pos[0], lon: pos[1] }
      locationMarker.update(pos)
      mapService.setCenter(pos[0], pos[1], 15)
      setStatus('')
    })
  })

  // ── POI detail ──────────────────────────────────────────────────────────────
  const detailPanel = new PoiDetailPanel(document.getElementById('detail-panel')!)

  // KI-Features (POI-Zusammenfassung + Chat-Suche) nur für eingeloggte Nutzer.
  // Wird nach dem Auth-Setup über auth.onChange gesetzt (siehe unten).
  let aiAllowed = false

  function loadDetails(poi: OsmPoi): void {
    const stillSelected = () => session.selectedPoi?.id === poi.id
    void collectTagImages(poi).then(base => {
      if (stillSelected()) detailPanel.updateImages(base)
      void loadMapillaryImages(poi).then(extra => {
        if (stillSelected()) detailPanel.updateImages([...base, ...extra])
      })
    })
    void loadNearby(poi).then(items => { if (stillSelected()) detailPanel.updateNearby(items) })
    void loadNotes(poi).then(n => { if (stillSelected()) detailPanel.updateNotes(n) })
    if (aiAllowed) {
      detailPanel.setSummaryLoading()
      void loadPoiSummary(poi).then(summary => { if (stillSelected()) detailPanel.updateSummary(summary) })
    } else {
      detailPanel.updateSummary(null) // KI-Zusammenfassung nur für eingeloggte Nutzer
    }
  }

  // ── OSM POI markers ─────────────────────────────────────────────────────────
  const osmFilterIds = () => new Set(filterStore.list().filter(f => !f.hidden && f.enabled && f.kind === 'osm').map(f => f.id))
  const styleResolver: StyleResolver = (filterId) => {
    const f = filterStore.get(filterId)
    return { color: f?.color ?? '#1565C0', iconPath: filterIconPath(f?.iconId ?? 'parking') }
  }
  const markerManager = new PoiMarkerManager(
    createLeafletMarkerAdapter(map),
    poi => { if (!offerPoiToPlanner(poi)) void selection.select(poi) },
    osmFilterIds(),
    styleResolver,
  )
  markerManager.setFavorites(favorites.getAll())
  markerManager.setNotes(new Set(notes.list().map(n => n.id)))

  // ── Selection flow ──────────────────────────────────────────────────────────
  // Declared early because custom POI wiring references it.
  let selection: ReturnType<typeof createSelection>

  // ── Custom POIs ─────────────────────────────────────────────────────────────
  const adapter = createLeafletMarkerAdapter(map)
  const customPois = initCustomPois({ adapter, mapService, getSelection: () => selection, onMarkerTap: poi => offerPoiToPlanner(poi), color: filterStore.get(PERSONAL_FILTER_ID)?.color ?? DEFAULT_PERSONAL_COLOR })
  const personalInit = filterStore.get(PERSONAL_FILTER_ID)
  customPois.markerManager.setVisible(personalInit ? !personalInit.hidden && personalInit.enabled : true)
  customPois.refreshMarkers()

  // ── Selection (now wired after customPois is ready) ──────────────────────────
  // The selected place gets an enlarged icon with a ring above markers and
  // clusters; custom POIs (negative ids) have their own icons → ring only.
  const poiHighlight = createLeafletPoiHighlight(map)
  // Marker for a tapped "In der Nähe" entry (those have no marker of their own).
  // Cleared when the panel closes or another POI is selected (see selection callbacks).
  const nearbyWiring = createNearbyWiring({
    target: createLeafletTargetMarker(map),
    // Close zoom first (no animation), then centre in the part of the map no panel covers.
    centerOn: pos => {
      map.setView([pos.lat, pos.lon], Math.max(map.getZoom(), NEARBY_ZOOM), { animate: false })
      centerPoiInView(map, mapContainer, pos, { top: effectiveMapTop(), ...routeWiring.mapInsets() })
    },
    iconFor: nearbyIconSvg,
    flash: flashInfo,
  })
  /** Viewport y below which the map is visible (bottom of the header/filter bar). */
  const effectiveMapTop = () => document.body.classList.contains('ui-collapsed')
    ? 0
    : document.getElementById('filter-panel')?.getBoundingClientRect().bottom ?? 0
  const showHighlight = (poi: OsmPoi) =>
    poiHighlight.show(poi, poi.id < 0 ? undefined : markerManager.iconUrlFor(poi))
  selection = createSelection({
    session, panel: detailPanel, favorites,
    panIntoView: poi => panPoiIntoView(map, mapContainer, poi, effectiveMapTop()),
    // Picked from the route list: put it in the middle of what is left of the map
    // between header, route panel and detail panel. routeWiring is created further down.
    centerInView: poi => centerPoiInView(map, mapContainer, poi, { top: effectiveMapTop(), ...routeWiring.mapInsets() }),
    loadDetails,
    getNote: poi => notes.get(String(poi.id)),
    onEditCustomPoi: customPois.editCurrent,
    onDeleteCustomPoi: customPois.deleteCurrent,
    isLoggedIn: () => loggedIn,
    getRouteInfo: poi => routeWiring.positionOf(poi), // routeWiring is created further down
    onSelected: poi => { nearbyWiring.clear(); showHighlight(poi); routeWiring.onPoiSelected(poi) },
    onCleared: () => { nearbyWiring.clear(); poiHighlight.clear(); routeWiring.onPoiSelected(null) },
  })

  // ── Auth sync ───────────────────────────────────────────────────────────────
  if (auth && supabase) {
    void initAuthSync({
      auth, supabase, favorites, notes, filterStore,
      connectCustomPois: customPois.connect,
      disconnectCustomPois: customPois.disconnect,
      onFavoritesSynced: () => markerManager.setFavorites(favorites.getAll()),
      onCustomPoisSynced: () => customPois.refreshMarkers(),
      helpSeenStore,
      onHelpSeenFromServer: () => helpPanel.close(),
    })
  }

  // ── POI refresh on map changes ──────────────────────────────────────────────
  // Built-in filters from static tiles, user/AI filters live via Overpass.
  const poiTiles = createPoiTileSource(POI_TILES_BASE)
  const getOsmFilters = () => filterStore.list().filter(f => f.kind === 'osm' && !f.hidden && f.selectors.length > 0)
  const refresher = createPoiRefresher({
    getBounds: () => mapService.getBounds(),
    setMarkers: pois => markerManager.updatePois(pois),
    setStatus,
    getOsmFilters,
    tiles: poiTiles,
  })
  const { refresh } = refresher
  let lastFetchSignature = fetchSignature(getOsmFilters())

  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  const refreshDebounced = () => {
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => void refresh(), 250)
  }
  mapService.onBoundsChanged(() => refreshDebounced())
  setTimeout(() => void refresh(), 800)

  // ── Route import (GPX / Komoot) + POIs along the route ─────────────────────
  // Created before the filter/collapse hooks below, which talk to it. While a
  // route is active the refresher is suspended and the map shows only the
  // corridor POIs.
  const routeStore = new LocalRouteStore()
  // No dragging of the route while a point is being picked on the map (planner, own place).
  const routeLayer = createLeafletRouteLayer(map, undefined, { canEdit: () => !mapService.isPlacing })
  const routeWiring = createRouteWiring({
    store: routeStore,
    layer: routeLayer,
    dialogContainer: document.body,
    panelContainer: document.body,
    flash: flashInfo,
    // The import dialog offers "Route planen": swap it for the planner.
    onOpenPlanner: () => { routeWiring.closeImport(); openPlanner() },
    createLoader: callbacks => createRoutePoiLoader({ getOsmFilters, tiles: poiTiles, ...callbacks }),
    refresher,
    setMarkers: pois => markerManager.updatePois(pois),
    selectPoi: poi => void selection.select(poi, { center: true }),
    isTypeActive: type => osmFilterIds().has(type),
    rowFor: poi => ({
      ...routeRowTexts(poi.tags.name, typeLabel(poi.type), { type: poi.type, now: new Date() }),
      color: styleResolver(poi.type).color,
      iconSvg: typeIcon(poi.type), // our own icon set, not user data
    }),
  })
  isRouteActive = () => routeWiring.isRouteActive()
  // After the route wiring: its store listener draws the line before this one sets the handles.
  createRouteEditWiring({ store: routeStore, layer: routeLayer, flash: flashInfo })

  filterStore.onChange(() => {
    // A new/edited filter or parking switched on needs data not loaded yet.
    const sig = fetchSignature(getOsmFilters())
    const needsRefetch = sig !== lastFetchSignature
    lastFetchSignature = sig
    // With an active route the refresher is suspended; the route wiring reloads the corridor instead.
    if (needsRefetch && !routeWiring.isRouteActive()) refreshDebounced()
    markerManager.setActiveTypes(osmFilterIds())
    markerManager.setStyleResolver(styleResolver)
    // Chip toggles re-assign already loaded POIs (a bakery-café belongs to the
    // active chip) — memory only. After setActiveTypes so visibility is current.
    refresher.reclassify()
    routeWiring.onFiltersChanged(needsRefetch)
    const personal = filterStore.get(PERSONAL_FILTER_ID)
    if (personal) {
      customPois.markerManager.setVisible(!personal.hidden && personal.enabled)
      customPois.markerManager.setColor(personal.color)
    }
  })

  // ── Mobile: collapse topbar/filter + detail panel on map interaction ───────
  const isMobile = () => window.matchMedia('(max-width: 600px)').matches
  let mapReady = false
  setTimeout(() => { mapReady = true }, 800) // skip initial setView zoomstart

  // The header stays while the search box is expanded (route form, AI dialog).
  const uiCollapse = createUiCollapse({
    isMobile,
    isReady: () => mapReady,
    isBoxExpanded: () => searchWiring.isExpanded(), // created further down
    collapseDetail: () => detailPanel.collapse(),
    collapseRoute: () => routeWiring.collapsePanel(),
  })
  const expandUI = () => uiCollapse.expand()

  mapService.onDragStart(() => uiCollapse.collapse())
  mapService.onZoomStart(() => uiCollapse.collapse())

  // Float control buttons restore the full UI
  const floatMenu = document.getElementById('float-menu')
  const floatSearch = document.getElementById('float-search')
  const floatFilters = document.getElementById('float-filters')
  const btnMenu = document.getElementById('btn-menu')

  floatMenu?.addEventListener('click', () => { expandUI(); btnMenu?.click() })
  floatSearch?.addEventListener('click', () => {
    expandUI()
    searchWiring.focusSearch()
  })
  floatFilters?.addEventListener('click', () => expandUI())

  // ── Detail panel events ─────────────────────────────────────────────────────
  detailPanel.onClose(() => selection.clear())
  detailPanel.onFavoriteToggle(() => {
    if (!session.selectedPoi) return
    favorites.toggle(toFavoritePoi(session.selectedPoi))
    markerManager.setFavorites(favorites.getAll())
    showHighlight(session.selectedPoi) // badge changed
  })
  detailPanel.onNoteSave(text => {
    if (!session.selectedPoi) return
    notes.set(toNoteTarget(session.selectedPoi), text)
    markerManager.setNotes(new Set(notes.list().map(n => n.id)))
    showHighlight(session.selectedPoi) // badge changed
  })
  detailPanel.onNearbySelect(item => nearbyWiring.select(item))
  detailPanel.onPlanPoint(role => {
    if (session.selectedPoi) searchWiring.planFromPoi(session.selectedPoi, role)
  })

  // ── KI-Suche ──────────────────────────────────────────────────────────────────
  // An AI search shows exactly what was asked for: the other filters are switched
  // off (not deleted) and the chip in the filter bar brings the previous state back.
  const aiFilterUndo = new AiFilterUndoStore()
  const restoreFiltersBeforeAi = (): void => {
    const snapshot = aiFilterUndo.get()
    if (snapshot) restoreAiFilters(filterStore, snapshot)
    aiFilterUndo.set(null)
    filterPanel.setRestore(null)
  }
  if (aiFilterUndo.get()) filterPanel.setRestore(restoreFiltersBeforeAi)

  const applyAiIntent = async (intent: AiIntent): Promise<void> => {
    const plan = planAiFilterApply(filterStore.list(), intent, aiFilterUndo.get())
    if (plan) {
      applyAiFilterPlan(filterStore, plan)
      aiFilterUndo.set(plan.snapshot)
      filterPanel.setRestore(restoreFiltersBeforeAi)
    }

    // A route wish goes to the planner (search box wiring) — no jump to its destination.
    if (intent.place && !intent.route) {
      // No viewbox on purpose: the AI names the place the user meant, and the bias
      // towards the visible map prefers like-named streets and houses nearby.
      // geocode() resolves [] on failure — filters still apply either way.
      const [hit] = await geocode(intent.place, { limit: 1 })
      if (hit) mapService.setCenter(Number(hit.lat), Number(hit.lon), 12)
    }
    void refresh()
  }

  // ── Search box: place search, route planner, AI dialog ──────────────────────
  // Entries into the planner: route button of the box, menu, import dialog, POI detail, map pick.
  const profileStore = new LocalProfileStore()
  const searchWiring = createSearchBoxWiring({
    container: document.getElementById('search-bar')!,
    planner: {
      geocode,
      getUserPos: () => session.userPos,
      requestUserPos: async () => {
        const pos = await getUserLocation()
        if (!pos) return null
        session.userPos = { lat: pos[0], lon: pos[1] }
        locationMarker.update(pos)
        return session.userPos
      },
      pickPoint: (onPick, onCancel) => mapService.pickPoint(onPick, onCancel),
      markers: { start: createLeafletTargetMarker(map), end: createLeafletTargetMarker(map) },
      getProfiles: () => profileStore.get(),
      modeStore: new TravelModeStore(),
      importRoute: route => routeWiring.importRoute(route),
      isMobile,
      collapseDetail: () => detailPanel.collapse(),
      poiLabel: poi => poi.tags.name ?? typeLabel(poi.type),
      getViewbox: () => {
        const b = mapService.getBounds()
        return b ? { west: b.west, north: b.north, east: b.east, south: b.south } : undefined
      },
    },
    centerOn: (lat, lon) => {
      // The jump must not fold the header away: "Route hierher" is offered there now.
      uiCollapse.hold()
      mapService.setCenter(lat, lon, 14)
    },
    applyAiIntent,
    expandUi: expandUI,
    openImport: () => { closeAll(); routeWiring.openImport() },
  })
  openPlanner = () => { closeAll(); searchWiring.openRoute() }
  offerPoiToPlanner = poi => searchWiring.offerPoi(poi)

  // KI nur für eingeloggte Nutzer: ✨-Knopf und KI-Zeile der Suchbox + Summary-Gate (aiAllowed).
  const setAiAccess = (loggedIn: boolean): void => {
    aiAllowed = loggedIn
    searchWiring.setAiEnabled(loggedIn)
  }
  if (auth) {
    auth.onChange(user => setAiAccess(!!user))
    void auth.currentUser().then(user => setAiAccess(!!user)).catch(() => setAiAccess(false))
  } else {
    setAiAccess(false) // ohne konfiguriertes Supabase kein Login → keine KI
  }

  // ── Favorites & Notes list panels ───────────────────────────────────────────
  const favoritesPanel = new FavoritesListPanel(document.body, {
    getFavorites: () => favorites.list(),
    getNote: id => notes.get(id),
    onSelect: fav => {
      mapService.setCenter(fav.lat, fav.lon, 14)
      void selection.select(favoriteToPoi(fav))
    },
    onRemove: fav => {
      favorites.toggle(fav)
      markerManager.setFavorites(favorites.getAll())
    },
  })
  favorites.onChange(() => favoritesPanel.refresh())

  const notesPanel = new NotesListPanel(document.body, {
    getNotes: () => notes.list(),
    onSelect: note => {
      mapService.setCenter(note.lat, note.lon, 14)
      void selection.select(noteToPoi(note))
    },
    onRemove: note => notes.remove(note.id),
  })
  notes.onChange(() => {
    markerManager.setNotes(new Set(notes.list().map(n => n.id)))
    favoritesPanel.refresh()
    notesPanel.refresh()
  })

  // ── Google Maps Import ──────────────────────────────────────────────────────
  const importHandle = initImport({
    customPoiStore: customPois.store,
    setStatus, flashStatus, flashInfo,
    refreshCustomMarkers: customPois.refreshMarkers,
  })

  mapService.onBaseLayerChange(key => routeWiring.setSatellite(key === 'Satellit'))
  // The base layer is restored from localStorage before any listener exists —
  // bring the route line's colours in line with it once.
  routeWiring.setSatellite(mapService.getBaseLayerLabel() === 'Satellit')
  mapService.onRouteAction(() => routeWiring.openImport())

  // ── Side menu ───────────────────────────────────────────────────────────────
  const infoPanel = new InfoPanel(document.body, {
    onClearCache: () => void clearAppCache().then(() => location.reload()),
  })
  poiTiles.manifest().then(m => infoPanel.setPoiDataDate(m.date)).catch(() => { /* Overpass fallback, no date */ })
  const datenschutzPanel = new DatenschutzPanel(document.body)
  const impressumPanel = new ImpressumPanel(document.body)
  const responsibilityPanel = new ResponsibilityPanel(document.body)
  const profileWiring = createProfileWiring({
    store: profileStore, filterStore, dialogContainer: document.body, flash: flashInfo,
  })
  openProfiles = () => { closeAll(); profileWiring.open() }

  const helpPanel = new HelpPanel(document.body, {
    filterStore,
    profiles: profileWiring.helpProfiles,
    onDismiss: () => {
      helpSeenStore.markSeen()
      whatsNewStore.markSeen(APP_VERSION) // neue Nutzer sehen das Release-Overlay nie
      if (supabase) {
        void supabase.auth.updateUser({ data: { helpSeen: true } })
          .catch(err => console.warn('[help] metadata sync failed:', err))
      }
    },
    onOpenAuth: authPanel ? () => authPanel!.open() : undefined,
  })

  const closeAll = () => {
    infoPanel.close(); datenschutzPanel.close(); impressumPanel.close()
    favoritesPanel.close(); notesPanel.close(); helpPanel.close()
    responsibilityPanel.close(); routeWiring.closeImport(); profileWiring.close()
    searchWiring.close()
  }

  // Route planen läuft über die Suchbox, „Cache leeren“ sitzt im Info-Panel,
  // Datenschutz/Impressum als kleine Links in der Fußzeile.
  const menuItems: MenuEntry[] = [
    { kind: 'section', label: 'Meine Daten' },
    { icon: SVG_STAR, label: 'Favoriten', onSelect: () => { closeAll(); favoritesPanel.open() } },
    { icon: SVG_NOTE, label: 'Notizen', onSelect: () => { closeAll(); notesPanel.open() } },
    { icon: SVG_UPLOAD, label: 'Orte importieren (Google Maps)', onSelect: () => importHandle.open() },
    { icon: SVG_ROUTE, label: 'Route importieren (GPX/Komoot)', onSelect: () => { closeAll(); routeWiring.openImport() } },
    { kind: 'section', label: 'Unterwegs' },
    { icon: SVG_PROFILE, label: 'Profil', onSelect: () => { closeAll(); profileWiring.open() } },
    { icon: SVG_LEAF, label: 'Verantwortungsvoll unterwegs', onSelect: () => { closeAll(); responsibilityPanel.open() } },
    { kind: 'section', label: 'App' },
  ]
  if (authPanel) {
    menuItems.push({ icon: SVG_USER, label: 'Konto', onSelect: () => authPanel!.open() })
  }
  menuItems.push({ icon: SVG_HELP, label: 'Hilfe', onSelect: () => { closeAll(); helpPanel.open() } })
  menuItems.push({ icon: SVG_INFO, label: 'Info', onSelect: () => { closeAll(); infoPanel.open() } })
  const menu = new SideMenu(document.body, menuItems, {
    footerLinks: [
      { label: 'Datenschutz', onSelect: () => { closeAll(); datenschutzPanel.open() } },
      { label: 'Impressum', onSelect: () => { closeAll(); impressumPanel.open() } },
    ],
  })
  document.getElementById('btn-menu')?.addEventListener('click', () => menu.toggle())

  // ── Update banner ───────────────────────────────────────────────────────────
  const updateBanner = new UpdateBanner()
  watchServiceWorkerUpdates(updateBanner)

  // ── Help overlay: show once on first visit ──────────────────────────────────
  const helpSeen = helpSeenStore.isSeen()
  const forceWhatsNew = import.meta.env.DEV && new URLSearchParams(location.search).has('whatsnew')
  if (forceWhatsNew || shouldShowWhatsNew(helpSeen, whatsNewStore.isSeen(APP_VERSION) ? APP_VERSION : null, APP_VERSION)) {
    new WhatsNewOverlay(document.body, {
      onDismiss: () => whatsNewStore.markSeen(APP_VERSION),
      action: { label: 'Profil wählen', onSelect: () => profileWiring.open() },
    }).open()
  } else if (!helpSeen) {
    helpPanel.open()
  }
}

init().catch(err => {
  console.error('Startup failed:', err)
  const map = document.getElementById('map')
  if (map) map.textContent = `Fehler beim Laden: ${(err as Error).message}`
})
