import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
// Shared shell + design tokens — must load before any feature CSS (cascade base).
import '@/styles/shell.css'
import { MapService, getUserLocation } from '@/features/map/MapService.js'
import { createLeafletMarkerAdapter } from '@/features/map/leafletAdapter.js'
import { createLocationMarker } from '@/features/map/locationMarker.js'
import { panPoiIntoView } from '@/features/map/panIntoView.js'
import { PoiMarkerManager } from '@/features/pois/PoiMarkerManager.js'
import type { OsmPoi } from '@/features/pois/OverpassClient.js'
import { createPoiTileSource } from '@/features/pois/poiTiles.js'
import { POI_TILES_BASE } from '@/core/config.js'
import { DirectionsService, type RoutingMode } from '@/features/routing/DirectionsService.js'
import { PoiDetailPanel } from '@/features/poi-detail/PoiDetailPanel.js'
import { collectTagImages, loadMapillaryImages, loadNearby, loadNotes } from '@/features/poi-detail/poiData.js'
import { loadPoiSummary } from '@/features/ai/AiClient.js'
import { AiSearchModal } from '@/features/ai/AiSearchModal.js'
import type { AiIntent } from '@/features/ai/intentSchema.js'
import { nearbyRouteMessage } from '@/features/poi-detail/nearbyMessage.js'
import { FilterPanel } from '@/features/filters/FilterPanel.js'
import { LocalFilterStore } from '@/features/filters/FilterStore.js'
import { SyncedFilterStore } from '@/features/filters/RemoteFilterStore.js'
import { FilterConfigPanel } from '@/features/filters/FilterConfigPanel.js'
import { setPoiMetaRegistry } from '@/features/pois/poiMeta.js'
import { filterIconPath, PERSONAL_FILTER_ID } from '@/features/filters/filterModel.js'
import { DEFAULT_PERSONAL_COLOR } from '@/features/custom-pois/CustomPoiMarkerManager.js'
import { type StyleResolver } from '@/features/pois/PoiMarkerManager.js'
import { SearchBar } from '@/features/search/SearchBar.js'
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
import { initCustomPois } from './customPoiWiring.js'
import { initAuthSync } from './authWiring.js'
import { geocode } from '@/core/nominatim.js'
import {
  SVG_STAR, SVG_NOTE, SVG_USER, SVG_TRASH, SVG_INFO, SVG_UPLOAD, SVG_SHIELD, SVG_BUILDING, SVG_HELP, SVG_LEAF,
} from './icons.js'
// Cross-cutting responsive overrides — must load AFTER all feature CSS so the
// media-query rules win over feature base rules of equal specificity.
import '@/styles/responsive.css'

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
  const routingToggle = mapService.getRoutingContainer()!
  const directions = new DirectionsService(map)
  mapService.onBaseLayerChange(key => directions.setSatelliteMode(key === 'Satellit'))
  const session = createSession(null)

  // ── Filters ─────────────────────────────────────────────────────────────────
  const filterStore = new SyncedFilterStore(new LocalFilterStore())
  const filterConfigPanel = new FilterConfigPanel(document.body, filterStore)
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
  mapService.onDragStart(() => { userMovedMap = true })
  void requestLocation(statusEl).then(userPos => {
    setStatus('')
    if (userPos) {
      session.userPos = { lat: userPos[0], lon: userPos[1] }
      locationMarker.update(userPos)
      if (!userMovedMap) mapService.setCenter(userPos[0], userPos[1], 13)
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
    poi => void selection.select(poi),
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
  const customPois = initCustomPois({ adapter, mapService, getSelection: () => selection, color: filterStore.get(PERSONAL_FILTER_ID)?.color ?? DEFAULT_PERSONAL_COLOR })
  const personalInit = filterStore.get(PERSONAL_FILTER_ID)
  customPois.markerManager.setVisible(personalInit ? !personalInit.hidden && personalInit.enabled : true)
  customPois.refreshMarkers()

  // ── Selection (now wired after customPois is ready) ──────────────────────────
  selection = createSelection({
    session, directions, panel: detailPanel, favorites,
    panIntoView: poi => {
      const effectiveTop = document.body.classList.contains('ui-collapsed')
        ? 0
        : document.getElementById('filter-panel')?.getBoundingClientRect().bottom ?? 0
      panPoiIntoView(map, mapContainer, poi, effectiveTop)
    },
    loadDetails,
    onNoLocation: () => flashStatus('Kein Startpunkt – Standort freigeben oder „Von hier starten" wählen'),
    getNote: poi => notes.get(String(poi.id)),
    onEditCustomPoi: customPois.editCurrent,
    onDeleteCustomPoi: customPois.deleteCurrent,
    onStartSet: label => flashInfo(`Startpunkt: ${label} – jetzt Ziel wählen`),
    onStartReset: () => flashInfo('Start: mein Standort'),
    isLoggedIn: () => loggedIn,
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
  const { refresh } = createPoiRefresher({
    getBounds: () => mapService.getBounds(),
    setMarkers: pois => markerManager.updatePois(pois),
    setStatus,
    getOsmFilters,
    tiles: poiTiles,
  })
  let lastFetchSignature = fetchSignature(getOsmFilters())

  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  const refreshDebounced = () => {
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => void refresh(), 250)
  }
  mapService.onBoundsChanged(bounds => {
    searchBar.updateBounds(bounds)
    refreshDebounced()
  })
  setTimeout(() => void refresh(), 800)

  filterStore.onChange(() => {
    // A new/edited filter or parking switched on needs data not loaded yet.
    const sig = fetchSignature(getOsmFilters())
    if (sig !== lastFetchSignature) {
      lastFetchSignature = sig
      refreshDebounced()
    }
    markerManager.setActiveTypes(osmFilterIds())
    markerManager.setStyleResolver(styleResolver)
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

  const collapseUI = () => {
    if (!isMobile() || !mapReady) return
    document.body.classList.add('ui-collapsed')
    detailPanel.collapse()
  }
  const expandUI = () => document.body.classList.remove('ui-collapsed')

  mapService.onDragStart(collapseUI)
  mapService.onZoomStart(collapseUI)

  // Float control buttons restore the full UI
  const floatMenu = document.getElementById('float-menu')
  const floatSearch = document.getElementById('float-search')
  const floatFilters = document.getElementById('float-filters')
  const btnMenu = document.getElementById('btn-menu')

  floatMenu?.addEventListener('click', () => { expandUI(); btnMenu?.click() })
  floatSearch?.addEventListener('click', () => {
    expandUI()
    document.querySelector<HTMLInputElement>('.search-input')?.focus()
  })
  floatFilters?.addEventListener('click', () => expandUI())

  // ── Detail panel events ─────────────────────────────────────────────────────
  detailPanel.onNavigate(({ poi }) => void selection.navigate(poi))
  detailPanel.onSetStart(() => selection.setStart())
  detailPanel.onResetStart(() => void selection.resetStart())
  detailPanel.onClose(() => selection.clear())
  detailPanel.onFavoriteToggle(() => {
    if (!session.selectedPoi) return
    favorites.toggle(toFavoritePoi(session.selectedPoi))
    markerManager.setFavorites(favorites.getAll())
  })
  detailPanel.onNoteSave(text => {
    if (!session.selectedPoi) return
    notes.set(toNoteTarget(session.selectedPoi), text)
    markerManager.setNotes(new Set(notes.list().map(n => n.id)))
  })
  detailPanel.onNearbySelect(item => {
    const poi = session.selectedPoi
    if (!poi) return
    void directions
      .routeSecondary({ lat: poi.lat, lon: poi.lon }, { lat: item.lat, lon: item.lon })
      .then(r => flashInfo(nearbyRouteMessage(item, r)))
      .catch(() => flashStatus('Route zum Ziel nicht möglich'))
  })

  // ── Search + routing ────────────────────────────────────────────────────────
  const searchBar = new SearchBar(document.getElementById('search-bar')!)
  searchBar.onPlaceSelected(({ lat, lng }) => mapService.setCenter(lat, lng, 14))

  // ── KI-Suche (Chat-Modal) ─────────────────────────────────────────────────────
  // Translates a chat conversation into the existing FilterStore + geocode paths.
  const applyAiIntent = async (intent: AiIntent): Promise<void> => {
    for (const id of intent.enableFilters) {
      const f = filterStore.get(id)
      if (!f) continue
      if (f.hidden) filterStore.setHidden(id, false)
      filterStore.setEnabled(id, true)
    }
    for (const def of intent.adHocFilters) filterStore.put(def)

    if (intent.place) {
      // geocode() resolves [] on failure — filters still apply either way.
      const [hit] = await geocode(intent.place, { limit: 1 })
      if (hit) mapService.setCenter(Number(hit.lat), Number(hit.lon), 12)
    }
    void refresh()
  }
  const aiModal = new AiSearchModal(document.body, { onApply: applyAiIntent })
  searchBar.onAiSearch(query => aiModal.open(query))

  // KI nur für eingeloggte Nutzer: ✨-Button ein-/ausblenden + Summary-Gate (aiAllowed).
  const setAiAccess = (loggedIn: boolean): void => {
    aiAllowed = loggedIn
    searchBar.setAiEnabled(loggedIn)
    if (!loggedIn) aiModal.close()
  }
  if (auth) {
    auth.onChange(user => setAiAccess(!!user))
    void auth.currentUser().then(user => setAiAccess(!!user)).catch(() => setAiAccess(false))
  } else {
    setAiAccess(false) // ohne konfiguriertes Supabase kein Login → keine KI
  }

  routingToggle.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.routing-opt') as HTMLButtonElement
    if (!btn) return
    const mode = btn.dataset.mode as RoutingMode
    if (mode === session.routingMode) return
    session.routingMode = mode
    routingToggle.querySelector('.active')?.classList.remove('active')
    btn.classList.add('active')
    void selection.reroute()
  })

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

  // ── Side menu ───────────────────────────────────────────────────────────────
  const infoPanel = new InfoPanel(document.body)
  poiTiles.manifest().then(m => infoPanel.setPoiDataDate(m.date)).catch(() => { /* Overpass fallback, no date */ })
  const datenschutzPanel = new DatenschutzPanel(document.body)
  const impressumPanel = new ImpressumPanel(document.body)
  const responsibilityPanel = new ResponsibilityPanel(document.body)
  const helpPanel = new HelpPanel(document.body, {
    filterStore,
    onDismiss: () => {
      helpSeenStore.markSeen()
      whatsNewStore.markSeen(APP_VERSION) // neue Nutzer sehen das 2.0-Overlay nie
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
    responsibilityPanel.close()
  }

  const menuItems: MenuEntry[] = [
    { icon: SVG_STAR, label: 'Favoriten', onSelect: () => { closeAll(); favoritesPanel.open() } },
    { icon: SVG_NOTE, label: 'Notizen', onSelect: () => { closeAll(); notesPanel.open() } },
    { icon: SVG_LEAF, label: 'Verantwortungsvoll unterwegs', onSelect: () => { closeAll(); responsibilityPanel.open() } },
    { icon: SVG_UPLOAD, label: 'Google Maps importieren', onSelect: () => importHandle.open() },
  ]
  if (authPanel) {
    menuItems.push({ icon: SVG_USER, label: 'Konto', onSelect: () => authPanel!.open() })
  }
  menuItems.push({ icon: SVG_HELP, label: 'Hilfe', onSelect: () => { closeAll(); helpPanel.open() } })
  menuItems.push({ icon: SVG_INFO, label: 'Info', onSelect: () => { closeAll(); infoPanel.open() } })
  menuItems.push({ kind: 'divider' })
  menuItems.push({ kind: 'section', label: 'Rechtliches' })
  menuItems.push({ icon: SVG_SHIELD, label: 'Datenschutz', onSelect: () => { closeAll(); datenschutzPanel.open() } })
  menuItems.push({ icon: SVG_BUILDING, label: 'Impressum', onSelect: () => { closeAll(); impressumPanel.open() } })
  menuItems.push({ kind: 'divider' })
  menuItems.push({
    icon: SVG_TRASH,
    label: 'Cache leeren & neu laden',
    onSelect: () => void clearAppCache().then(() => location.reload()),
  })
  const menu = new SideMenu(document.body, menuItems)
  document.getElementById('btn-menu')?.addEventListener('click', () => menu.toggle())

  // ── Update banner ───────────────────────────────────────────────────────────
  const updateBanner = new UpdateBanner()
  watchServiceWorkerUpdates(updateBanner)

  // ── Help overlay: show once on first visit ──────────────────────────────────
  const helpSeen = helpSeenStore.isSeen()
  const forceWhatsNew = import.meta.env.DEV && new URLSearchParams(location.search).has('whatsnew')
  if (forceWhatsNew || shouldShowWhatsNew(helpSeen, whatsNewStore.isSeen(APP_VERSION) ? APP_VERSION : null, APP_VERSION)) {
    new WhatsNewOverlay(document.body, { onDismiss: () => whatsNewStore.markSeen(APP_VERSION) }).open()
  } else if (!helpSeen) {
    helpPanel.open()
  }
}

init().catch(err => {
  console.error('Startup failed:', err)
  const map = document.getElementById('map')
  if (map) map.textContent = `Fehler beim Laden: ${(err as Error).message}`
})
