import type { CSSProperties } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Form, Modal, Table } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import AddMonthlyLocationWizardModal from '../features/monthlyRoutes/AddMonthlyLocationWizardModal'
import { isTechnicianDemoLibraryLocation } from '../features/monthlyRoutes/technicianDemoRoute'
import {
  MAP_ROUTE_UNASSIGNED,
  compareMonthlyRouteFilterNames,
  isLngLatInViewport,
  normalizeMapCoordinates,
  parseYearMonth,
  toMonthKey,
  type GeocodeCandidate,
  type LibraryLocation,
  type LibraryPayload,
  type MapViewportBounds,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import { apiJson, isAbortError } from '../lib/apiClient'
import { PROCESSING_PAGE_TITLE_COMPACT_CLASS } from '../styles/pageTypography'

/** Build markers in slices so typing / focus stays responsive with hundreds of pins. */
const MAP_MARKER_BATCH_SIZE = 80

const EMPTY_MAP_LOCATIONS: LibraryLocation[] = []

function sameRouteSelection(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const bSet = new Set(b)
  return a.every((route) => bSet.has(route))
}

function MapRouteSwatch({ color }: { color: string }) {
  return (
    <span className="monthly-map-panel__route-swatch" style={{ backgroundColor: color }} aria-hidden />
  )
}

function MapPanelTab({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`monthly-map-panel__tab${active ? ' monthly-map-panel__tab--active' : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

const MAP_SEARCH_DEBOUNCE_MS = 250

const MAP_SEARCH_RESULTS_STYLE: CSSProperties = {
  maxHeight: '13rem',
  overflowY: 'auto',
}

/** Add Location card — top-right row, left of Mapbox zoom (+/−) so controls stay usable */
const FLOAT_ADD_LOCATION_STYLE: CSSProperties = {
  position: 'absolute',
  top: '0.75rem',
  right: '3.5rem',
  zIndex: 15,
}

export default function MonthlyRoutesMapPage() {
  const mapDataYear = useMemo(() => new Date().getFullYear(), [])
  const currentYearStart = `${mapDataYear}-01-01`

  const [mapPayload, setMapPayload] = useState<LibraryPayload | null>(null)
  const [mapLoading, setMapLoading] = useState(false)
  const [selectedMapRoutes, setSelectedMapRoutes] = useState<string[]>([])
  const [mapSidebarPanel, setMapSidebarPanel] = useState<'filters' | 'viewport'>('filters')
  const [mapSearchQuery, setMapSearchQuery] = useState('')
  const [mapSearchCandidates, setMapSearchCandidates] = useState<GeocodeCandidate[]>([])
  const [mapSearchLoading, setMapSearchLoading] = useState(false)
  const [mapSearchError, setMapSearchError] = useState<string | null>(null)
  const [showMapSearchResults, setShowMapSearchResults] = useState(false)
  const [showCreateLocationModal, setShowCreateLocationModal] = useState(false)
  const [placementLocation, setPlacementLocation] = useState<LibraryLocation | null>(null)
  const [placementQuery, setPlacementQuery] = useState('')
  const [placementCandidates, setPlacementCandidates] = useState<GeocodeCandidate[]>([])
  const [placementRouteValue, setPlacementRouteValue] = useState('')
  const [placementLoading, setPlacementLoading] = useState(false)
  const [placementSaving, setPlacementSaving] = useState(false)
  const [placementError, setPlacementError] = useState<string | null>(null)
  const [placementRouteError, setPlacementRouteError] = useState<string | null>(null)
  const [showPlacementAddressPanel, setShowPlacementAddressPanel] = useState(false)
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const mapMarkersRef = useRef<mapboxgl.Marker[]>([])
  const mapSearchInputRef = useRef<HTMLInputElement | null>(null)
  const mapSearchDebounceTimerRef = useRef<number | null>(null)
  const [mapViewportBounds, setMapViewportBounds] = useState<MapViewportBounds | null>(null)

  const mergeUpdatedLocation = useCallback((updated: LibraryLocation) => {
    setMapPayload((prev) =>
      prev
        ? {
            ...prev,
            locations: prev.locations.some((loc) => loc.id === updated.id)
              ? prev.locations.map((loc) => (loc.id === updated.id ? { ...loc, ...updated } : loc))
              : [updated, ...prev.locations],
          }
        : prev
    )
    setPlacementLocation((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev))
  }, [])

  /** Full-year unpaginated dataset for the map; independent of library filters on Monthly Routes page. */
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setMapLoading(true)

    const params = new URLSearchParams()
    const fallback = parseYearMonth(currentYearStart) ?? { year: mapDataYear, month: 1 }
    const start = fallback
    const finish = { year: fallback.year, month: 12 }
    params.set('from_month', toMonthKey(start.year, start.month))
    params.set('to_month', toMonthKey(finish.year, finish.month))
    params.set('unpaginated', 'true')
    params.set('include_coordinates', 'true')

    apiJson<LibraryPayload>(`/api/monthly_routes/library?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (active) setMapPayload(data)
      })
      .catch((err) => {
        if (!isAbortError(err) && active)
          setMapPayload({
            locations: [],
            month_columns: [],
            meta: { routes: [], min_month: null, max_month: null },
          })
      })
      .finally(() => {
        if (active) setMapLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [mapDataYear])

  const mapLocationsRaw = mapPayload?.locations ?? EMPTY_MAP_LOCATIONS
  /** Match library default: hide cancelled and training-demo (R99) markers on the map. */
  const mapLocations = useMemo(
    () =>
      mapLocationsRaw.filter((loc) => {
        if ((loc.status_normalized || '').trim().toLowerCase() === 'cancelled') return false
        if (isTechnicianDemoLibraryLocation(loc)) return false
        return true
      }),
    [mapLocationsRaw]
  )
  const routeOptions = mapPayload?.meta.routes ?? []
  const routeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    mapLocations.forEach((loc) => {
      const route = (loc.test_day || '').trim()
      if (!route) return
      counts[route] = (counts[route] ?? 0) + 1
    })
    return counts
  }, [mapLocations])
  const mapRouteOptions = useMemo(() => {
    const routes = new Set<string>()
    mapLocations.forEach((loc) => {
      const route = (loc.test_day || '').trim()
      if (route) routes.add(route)
    })
    return Array.from(routes).sort(compareMonthlyRouteFilterNames)
  }, [mapLocations])

  const mapUnassignedCount = useMemo(
    () => mapLocations.filter((loc) => !(loc.test_day || '').trim()).length,
    [mapLocations]
  )

  useEffect(() => {
    setSelectedMapRoutes((prev) => {
      const prevSet = new Set(prev)
      const hasUnassignedData = mapUnassignedCount > 0

      let routesSelection: string[]
      const prevRouteIds = mapRouteOptions.filter((r) => prevSet.has(r))
      const prevMentionsNamedRoute = prev.some((p) => mapRouteOptions.includes(p))

      if (prevRouteIds.length > 0) {
        routesSelection = prevRouteIds
      } else if (!prevMentionsNamedRoute && prev.length === 0) {
        routesSelection = [...mapRouteOptions]
      } else {
        routesSelection = []
      }

      let includeUnassigned = prevSet.has(MAP_ROUTE_UNASSIGNED)
      if (!prevMentionsNamedRoute && prev.length === 0 && hasUnassignedData) {
        includeUnassigned = true
      }
      if (!hasUnassignedData) includeUnassigned = false

      const next = [...routesSelection]
      if (includeUnassigned && hasUnassignedData) next.push(MAP_ROUTE_UNASSIGNED)
      return sameRouteSelection(prev, next) ? prev : next
    })
  }, [mapRouteOptions, mapUnassignedCount])

  const openPlacementEditor = useCallback((loc: LibraryLocation) => {
    setPlacementLocation(loc)
    setPlacementRouteValue((loc.test_day || '').trim())
    setPlacementQuery((loc.display_address || loc.address || '').trim())
    setPlacementCandidates([])
    setPlacementError(null)
    setPlacementRouteError(null)
    setShowPlacementAddressPanel(false)
  }, [])

  const closePlacementEditor = useCallback(() => {
    setPlacementLocation(null)
    setPlacementQuery('')
    setPlacementRouteValue('')
    setPlacementCandidates([])
    setPlacementError(null)
    setPlacementRouteError(null)
    setPlacementLoading(false)
    setPlacementSaving(false)
    setShowPlacementAddressPanel(false)
  }, [])

  const applyPlacementCandidate = useCallback(
    async (candidate: GeocodeCandidate) => {
      if (!placementLocation) return
      setPlacementSaving(true)
      setPlacementError(null)
      try {
        const response = await apiJson<{ location: LibraryLocation }>(
          `/api/monthly_routes/library/${placementLocation.id}/placement`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              display_address: candidate.display_address,
              latitude: candidate.latitude,
              longitude: candidate.longitude,
            }),
          }
        )
        mergeUpdatedLocation(response.location)
        closePlacementEditor()
      } catch (err) {
        if (typeof err === 'object' && err && 'error' in err) {
          setPlacementError(String((err as { error: unknown }).error))
        } else {
          setPlacementError('Unable to save marker placement.')
        }
      } finally {
        setPlacementSaving(false)
      }
    },
    [closePlacementEditor, mergeUpdatedLocation, placementLocation]
  )

  const saveAssignedRoute = useCallback(async () => {
    if (!placementLocation) return
    if (!placementRouteValue.trim()) {
      setPlacementRouteError('Route is required.')
      return
    }
    setPlacementSaving(true)
    setPlacementRouteError(null)
    try {
      const response = await apiJson<{ location: LibraryLocation }>(
        `/api/monthly_routes/library/${placementLocation.id}/assign_route`,
        {
          method: 'PATCH',
          body: JSON.stringify({ test_day: placementRouteValue.trim() }),
        }
      )
      mergeUpdatedLocation(response.location)
      closePlacementEditor()
    } catch (err) {
      if (typeof err === 'object' && err && 'error' in err) {
        setPlacementRouteError(String((err as { error: unknown }).error))
      } else {
        setPlacementRouteError('Unable to assign route.')
      }
    } finally {
      setPlacementSaving(false)
    }
  }, [closePlacementEditor, mergeUpdatedLocation, placementLocation, placementRouteValue])

  const filteredMapLocations = useMemo(() => {
    const allowed = new Set(selectedMapRoutes)
    const showUnassignedMarkers = allowed.has(MAP_ROUTE_UNASSIGNED)
    return mapLocations.filter((loc) => {
      const route = (loc.test_day || '').trim()
      if (!route) {
        if (!showUnassignedMarkers) return false
      } else if (!allowed.has(route)) {
        return false
      }
      return normalizeMapCoordinates(loc.latitude, loc.longitude) != null
    })
  }, [mapLocations, selectedMapRoutes])

  const routesVisibleInMapViewport = useMemo(() => {
    if (!mapViewportBounds) {
      return {
        totalMarkers: 0,
        unassignedInView: 0,
        namedRoutes: [] as Array<{ name: string; inView: number; inRoute: number }>,
      }
    }
    const routeTotals = new Map<string, number>()
    let unassignedInView = 0
    let totalMarkers = 0
    for (const loc of filteredMapLocations) {
      const coords = normalizeMapCoordinates(loc.latitude, loc.longitude)
      if (!coords) continue
      if (!isLngLatInViewport(coords.lng, coords.lat, mapViewportBounds)) continue
      totalMarkers += 1
      const route = (loc.test_day || '').trim()
      if (!route) unassignedInView += 1
      else routeTotals.set(route, (routeTotals.get(route) ?? 0) + 1)
    }
    const namedRoutes = Array.from(routeTotals.entries())
      .map(([name, inView]) => ({
        name,
        inView,
        inRoute: routeCounts[name] ?? 0,
      }))
      .sort((a, b) => compareMonthlyRouteFilterNames(a.name, b.name))
    return { totalMarkers, unassignedInView, namedRoutes }
  }, [filteredMapLocations, mapViewportBounds, routeCounts])

  const routeColor = useCallback((route: string) => {
    const palette = [
      '#2f63d7',
      '#d63384',
      '#198754',
      '#fd7e14',
      '#6f42c1',
      '#0dcaf0',
      '#dc3545',
      '#20c997',
      '#6610f2',
      '#ffc107',
    ]
    const value = route.trim().toUpperCase()
    let hash = 0
    for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0
    return palette[hash % palette.length]
  }, [])

  const mapToken = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined

  useEffect(() => {
    if (!mapContainerRef.current || !mapToken) return
    if (mapRef.current) return

    mapboxgl.accessToken = mapToken
    mapRef.current = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/outdoors-v12',
      center: [-123.1207, 49.2827],
      zoom: 9,
    })

    mapRef.current.addControl(new mapboxgl.NavigationControl(), 'top-right')
    mapRef.current.on('load', () => {
      mapRef.current?.resize()
    })
    return () => {
      mapMarkersRef.current.forEach((marker) => marker.remove())
      mapMarkersRef.current = []
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [mapToken])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    mapMarkersRef.current.forEach((marker) => marker.remove())
    mapMarkersRef.current = []

    const prepared = filteredMapLocations.flatMap((loc) => {
      const coords = normalizeMapCoordinates(loc.latitude, loc.longitude)
      return coords ? [{ loc, coords }] : []
    })

    let cancelled = false
    let rafId: number | null = null
    const bounds = new mapboxgl.LngLatBounds()
    let index = 0

    const flushBatch = () => {
      if (cancelled) return
      const end = Math.min(index + MAP_MARKER_BATCH_SIZE, prepared.length)
      for (; index < end; index += 1) {
        const { loc, coords } = prepared[index]
        const route = (loc.test_day || '').trim()
        const el = document.createElement('div')
        el.style.width = '12px'
        el.style.height = '12px'
        el.style.borderRadius = '50%'
        el.style.backgroundColor = routeColor(route)
        el.style.border = '2px solid #ffffff'
        el.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.15)'
        el.style.cursor = 'pointer'

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([coords.lng, coords.lat])
          .addTo(map)

        el.addEventListener('click', (ev) => {
          ev.stopPropagation()
          if (!marker.getPopup()) {
            const popupBody = document.createElement('div')
            const addressEl = document.createElement('strong')
            addressEl.textContent = loc.display_address || loc.address
            popupBody.appendChild(addressEl)
            popupBody.appendChild(document.createElement('br'))
            const routeTextEl = document.createElement('span')
            routeTextEl.textContent = `Route: ${route || '—'}`
            popupBody.appendChild(routeTextEl)
            popupBody.appendChild(document.createElement('br'))
            const detailLink = document.createElement('a')
            detailLink.href = `/monthlies/locations/${loc.id}`
            detailLink.className = 'btn btn-sm btn-outline-primary mt-2 d-inline-block'
            detailLink.textContent = 'Location page'
            popupBody.appendChild(detailLink)
            popupBody.appendChild(document.createElement('br'))
            const openButton = document.createElement('button')
            openButton.type = 'button'
            openButton.className = 'btn btn-sm btn-primary mt-2'
            openButton.textContent = 'Edit placement'
            openButton.addEventListener('click', () => {
              openPlacementEditor(loc)
            })
            popupBody.appendChild(openButton)
            marker.setPopup(new mapboxgl.Popup({ offset: 10 }).setDOMContent(popupBody))
          }
          marker.togglePopup()
        })

        mapMarkersRef.current.push(marker)
        bounds.extend([coords.lng, coords.lat])
      }

      if (index < prepared.length) {
        rafId = window.requestAnimationFrame(flushBatch)
      } else if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 50, maxZoom: 13 })
      }
    }

    rafId = window.requestAnimationFrame(flushBatch)

    return () => {
      cancelled = true
      if (rafId != null) window.cancelAnimationFrame(rafId)
      mapMarkersRef.current.forEach((marker) => marker.remove())
      mapMarkersRef.current = []
    }
  }, [filteredMapLocations, openPlacementEditor, routeColor])

  useEffect(() => {
    if (!placementLocation) {
      setPlacementCandidates([])
      setPlacementLoading(false)
      setPlacementError(null)
      return
    }
    if (!showPlacementAddressPanel) {
      setPlacementCandidates([])
      setPlacementLoading(false)
      return
    }
    const query = placementQuery.trim()
    if (query.length < 3) {
      setPlacementCandidates([])
      setPlacementLoading(false)
      setPlacementError(null)
      return
    }

    let active = true
    const controller = new AbortController()
    setPlacementLoading(true)
    setPlacementError(null)
    const params = new URLSearchParams({ q: query })
    apiJson<{ candidates: GeocodeCandidate[] }>(
      `/api/monthly_routes/geocode_candidates?${params.toString()}`,
      { signal: controller.signal }
    )
      .then((data) => {
        if (active) setPlacementCandidates(data.candidates || [])
      })
      .catch((err) => {
        if (!isAbortError(err) && active) {
          setPlacementCandidates([])
          setPlacementError('Unable to fetch address candidates.')
        }
      })
      .finally(() => {
        if (active) setPlacementLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [placementLocation, placementQuery, showPlacementAddressPanel])

  useEffect(() => {
    const query = mapSearchQuery.trim()
    if (query.length < 3 || !showMapSearchResults) {
      setMapSearchCandidates([])
      setMapSearchLoading(false)
      setMapSearchError(null)
      return
    }

    let active = true
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setMapSearchLoading(true)
      setMapSearchError(null)
      const params = new URLSearchParams({ q: query })
      apiJson<{ candidates: GeocodeCandidate[] }>(
        `/api/monthly_routes/geocode_candidates?${params.toString()}`,
        { signal: controller.signal }
      )
        .then((data) => {
          if (active) setMapSearchCandidates((data.candidates || []).slice(0, 3))
        })
        .catch((err) => {
          if (!isAbortError(err) && active) {
            setMapSearchCandidates([])
            setMapSearchError('Unable to fetch address suggestions.')
          }
        })
        .finally(() => {
          if (active) setMapSearchLoading(false)
        })
    }, MAP_SEARCH_DEBOUNCE_MS)

    return () => {
      active = false
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [mapSearchQuery, showMapSearchResults])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      mapRef.current?.resize()
    }, 120)
    return () => window.clearTimeout(timer)
  }, [])

  const applyRoutesInViewportSnapshot = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const b = map.getBounds()
    if (!b) return
    setMapViewportBounds({
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    })
  }, [])

  useEffect(() => {
    if (!mapRef.current) return
    const onResize = () => {
      mapRef.current?.resize()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const onWindowClick = () => {
      setShowMapSearchResults(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowMapSearchResults(false)
    }
    window.addEventListener('click', onWindowClick)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('click', onWindowClick)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (mapSearchDebounceTimerRef.current != null) {
        window.clearTimeout(mapSearchDebounceTimerRef.current)
        mapSearchDebounceTimerRef.current = null
      }
    }
  }, [])

  const handleMapSearchInputChange = useCallback((nextValue: string) => {
    if (mapSearchDebounceTimerRef.current != null) {
      window.clearTimeout(mapSearchDebounceTimerRef.current)
      mapSearchDebounceTimerRef.current = null
    }
    mapSearchDebounceTimerRef.current = window.setTimeout(() => {
      setMapSearchQuery(nextValue)
      mapSearchDebounceTimerRef.current = null
    }, MAP_SEARCH_DEBOUNCE_MS)
  }, [])

  const handleMapSearchSelect = useCallback((candidate: GeocodeCandidate) => {
    if (mapSearchInputRef.current) {
      mapSearchInputRef.current.value = candidate.display_address
    }
    setMapSearchQuery(candidate.display_address)
    setShowMapSearchResults(false)
    mapRef.current?.flyTo({
      center: [candidate.longitude, candidate.latitude],
      zoom: 16,
      essential: true,
    })
    new mapboxgl.Popup({ closeButton: false, closeOnClick: true, offset: 14 })
      .setLngLat([candidate.longitude, candidate.latitude])
      .setText(candidate.display_address)
      .addTo(mapRef.current as mapboxgl.Map)
  }, [])

  return (
    <div className="monthly-routes-map-page">
      <div ref={mapContainerRef} className="monthly-routes-map-page__canvas" />

      {!mapToken ? (
        <div
          className="position-absolute top-50 start-50 translate-middle text-danger small px-3 text-center"
          style={{ zIndex: 12 }}
        >
          Missing <code>VITE_MAPBOX_TOKEN</code>. Add it to frontend env to render the map.
        </div>
      ) : null}

      {/*
        Side panel: full height within map shell (top/bottom inset). Search + chrome stay fixed;
        route table scrolls inside .monthly-routes-map-page__side-panel-scroll — no page scrollbar.
      */}
      <Card
        className="monthly-routes-map-page__side-panel app-surface-card monthly-map-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <Card.Body className="monthly-map-panel__body d-flex flex-column gap-2">
          <div className="monthly-map-panel__header flex-shrink-0">
            <h1 className={`${PROCESSING_PAGE_TITLE_COMPACT_CLASS} m-0`}>Route map</h1>
            <span className="monthly-map-panel__meta">
              {mapLoading ? 'Loading…' : `${filteredMapLocations.length} markers`}
            </span>
          </div>

          <div className="monthly-map-panel__search flex-shrink-0">
            <div className="app-topbar-location-search">
              <div className="app-topbar-location-search__field">
                <i className="bi bi-search app-topbar-location-search__icon" aria-hidden />
                <Form.Control
                  type="search"
                  size="sm"
                  ref={mapSearchInputRef}
                  placeholder="Search address on map…"
                  className="app-topbar-location-search__input"
                  aria-label="Search address on map"
                  aria-expanded={showMapSearchResults}
                  onFocus={() => setShowMapSearchResults(true)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    setShowMapSearchResults(true)
                    handleMapSearchInputChange(e.target.value)
                  }}
                />
              </div>
            </div>
            {showMapSearchResults ? (
              <div className="monthly-map-panel__search-results" style={MAP_SEARCH_RESULTS_STYLE}>
                {mapSearchLoading ? (
                  <div className="monthly-map-panel__search-empty">Searching…</div>
                ) : mapSearchError ? (
                  <div className="monthly-map-panel__search-empty text-danger">{mapSearchError}</div>
                ) : mapSearchQuery.trim().length < 3 ? (
                  <div className="monthly-map-panel__search-empty">Type at least 3 characters.</div>
                ) : mapSearchCandidates.length === 0 ? (
                  <div className="monthly-map-panel__search-empty">No matching addresses.</div>
                ) : (
                  <div className="d-flex flex-column gap-1 p-1">
                    {mapSearchCandidates.map((candidate) => (
                      <button
                        key={`${candidate.display_address}-${candidate.latitude}-${candidate.longitude}`}
                        type="button"
                        className="monthly-map-panel__search-option"
                        onClick={() => handleMapSearchSelect(candidate)}
                      >
                        {candidate.display_address}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <div className="monthly-map-panel__tabs flex-shrink-0" role="tablist" aria-label="Map sidebar panel">
            <MapPanelTab
              active={mapSidebarPanel === 'filters'}
              label="Route filters"
              onClick={() => setMapSidebarPanel('filters')}
            />
            <MapPanelTab
              active={mapSidebarPanel === 'viewport'}
              label="In map view"
              onClick={() => setMapSidebarPanel('viewport')}
            />
          </div>

          <div className="monthly-routes-map-page__side-panel-scroll d-flex flex-column gap-2 min-h-0">
          {mapSidebarPanel === 'filters' ? (
            <>
              <div className="monthly-map-panel__toolbar flex-shrink-0">
                <Button
                  size="sm"
                  variant="outline-secondary"
                  className="monthly-map-panel__toolbar-btn"
                  onClick={() => {
                    const next = [...mapRouteOptions]
                    if (mapUnassignedCount > 0) next.push(MAP_ROUTE_UNASSIGNED)
                    setSelectedMapRoutes(next)
                  }}
                >
                  <i className="bi bi-check2-all" aria-hidden />
                  All
                </Button>
                <Button
                  size="sm"
                  variant="outline-secondary"
                  className="monthly-map-panel__toolbar-btn"
                  onClick={() => setSelectedMapRoutes([])}
                >
                  <i className="bi bi-x-lg" aria-hidden />
                  Clear
                </Button>
              </div>
              <div className="monthly-map-panel__hint flex-shrink-0">
                {mapLoading
                  ? 'Loading map locations…'
                  : `${mapRouteOptions.length} route${mapRouteOptions.length === 1 ? '' : 's'}${
                      mapUnassignedCount > 0 ? ` · ${mapUnassignedCount} unassigned` : ''
                    }`}
              </div>
              <div className="monthly-map-panel__table-wrap overflow-auto flex-grow-1 min-h-0">
                <Table striped hover className="mb-0 align-middle monthly-map-panel__table">
                  <thead>
                    <tr>
                      <th className="text-center monthly-map-panel__show-col">Show</th>
                      <th>Route</th>
                      <th className="text-end">Markers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapUnassignedCount > 0 ? (
                      <tr>
                        <td className="text-center">
                          <Form.Check
                            id="map-route-unassigned"
                            type="checkbox"
                            className="m-0"
                            aria-label="Show unassigned on map"
                            checked={selectedMapRoutes.includes(MAP_ROUTE_UNASSIGNED)}
                            onChange={(e) => {
                              setSelectedMapRoutes((prev) => {
                                if (e.target.checked) {
                                  if (prev.includes(MAP_ROUTE_UNASSIGNED)) return prev
                                  return [...prev, MAP_ROUTE_UNASSIGNED]
                                }
                                return prev.filter((r) => r !== MAP_ROUTE_UNASSIGNED)
                              })
                            }}
                          />
                        </td>
                        <td>
                          <span className="monthly-map-panel__route-label">
                            <MapRouteSwatch color={routeColor('')} />
                            <span>Unassigned</span>
                          </span>
                        </td>
                        <td className="text-end tabular-nums">{mapUnassignedCount}</td>
                      </tr>
                    ) : null}
                    {mapRouteOptions.map((route) => {
                      const count = routeCounts[route] ?? 0
                      return (
                        <tr key={route}>
                          <td className="text-center">
                            <Form.Check
                              id={`map-route-${route}`}
                              type="checkbox"
                              className="m-0"
                              aria-label={`Show ${route} on map`}
                              checked={selectedMapRoutes.includes(route)}
                              onChange={(e) => {
                                setSelectedMapRoutes((prev) => {
                                  if (e.target.checked) return [...prev, route]
                                  return prev.filter((r) => r !== route)
                                })
                              }}
                            />
                          </td>
                          <td>
                            <span className="monthly-map-panel__route-label">
                              <MapRouteSwatch color={routeColor(route)} />
                              <span>{route}</span>
                            </span>
                          </td>
                          <td className="text-end tabular-nums">{count}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Table>
              </div>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline-primary"
                className="monthly-map-panel__viewport-btn w-100 flex-shrink-0"
                onClick={applyRoutesInViewportSnapshot}
                disabled={!mapToken}
              >
                <i className="bi bi-crosshair" aria-hidden />
                {mapViewportBounds != null && routesVisibleInMapViewport.totalMarkers > 0
                  ? 'Refresh routes in view'
                  : 'Find routes in view'}
              </Button>
              <div className="monthly-map-panel__hint flex-shrink-0">
                {mapViewportBounds == null
                  ? 'Pan or zoom the map, then find routes in the current view.'
                  : `${routesVisibleInMapViewport.totalMarkers} marker${
                      routesVisibleInMapViewport.totalMarkers === 1 ? '' : 's'
                    } in viewport`}
              </div>
              <div className="monthly-map-panel__table-wrap overflow-auto flex-grow-1 min-h-0">
                {mapViewportBounds == null ? null : (
                  <Table striped hover className="mb-0 align-middle monthly-map-panel__table">
                    <thead>
                      <tr>
                        <th>Route</th>
                        <th className="text-end">In view</th>
                        <th className="text-end">In route</th>
                      </tr>
                    </thead>
                    <tbody>
                      {routesVisibleInMapViewport.totalMarkers === 0 ? (
                        <tr>
                          <td colSpan={3} className="text-muted">
                            None in current view.
                          </td>
                        </tr>
                      ) : (
                        <>
                          {routesVisibleInMapViewport.unassignedInView > 0 ? (
                            <tr>
                              <td>
                                <span className="monthly-map-panel__route-label">
                                  <MapRouteSwatch color={routeColor('')} />
                                  <span>Unassigned</span>
                                </span>
                              </td>
                              <td className="text-end tabular-nums">
                                {routesVisibleInMapViewport.unassignedInView}
                              </td>
                              <td className="text-end tabular-nums">{mapUnassignedCount}</td>
                            </tr>
                          ) : null}
                          {routesVisibleInMapViewport.namedRoutes.map(({ name, inView, inRoute }) => (
                            <tr key={`viewport-${name}`}>
                              <td>
                                <span className="monthly-map-panel__route-label">
                                  <MapRouteSwatch color={routeColor(name)} />
                                  <span>{name}</span>
                                </span>
                              </td>
                              <td className="text-end tabular-nums">{inView}</td>
                              <td className="text-end tabular-nums">{inRoute}</td>
                            </tr>
                          ))}
                        </>
                      )}
                    </tbody>
                  </Table>
                )}
              </div>
            </>
          )}
          </div>
        </Card.Body>
      </Card>

      <div className="monthly-map-panel__add-location" style={FLOAT_ADD_LOCATION_STYLE}>
        <Button
          size="sm"
          variant="primary"
          className="monthly-map-panel__add-btn fw-semibold"
          onClick={() => setShowCreateLocationModal(true)}
        >
          <i className="bi bi-plus-lg" aria-hidden />
          Add Location
        </Button>
      </div>

      <AddMonthlyLocationWizardModal
        show={showCreateLocationModal}
        onHide={() => setShowCreateLocationModal(false)}
        routeOptions={routeOptions}
        onCreated={mergeUpdatedLocation}
      />

      <Modal
        show={Boolean(placementLocation)}
        onHide={closePlacementEditor}
        centered
        className="monthly-map-placement-modal"
      >
        <Modal.Header closeButton className="monthly-map-placement-modal__header">
          <Modal.Title className="monthly-map-placement-modal__title">Edit marker</Modal.Title>
        </Modal.Header>
        <Modal.Body className="monthly-map-placement-modal__body">
          {placementLocation ? (
            <div className="d-flex flex-column gap-2">
              <div>
                <div className="text-muted">Current</div>
                <div className="fw-semibold">{placementLocation.display_address || placementLocation.address}</div>
                <Link
                  to={`/monthlies/locations/${placementLocation.id}`}
                  className="small d-inline-block mt-1"
                >
                  Open location page
                </Link>
              </div>
              <Form.Group>
                <Form.Label className="small mb-1">Assign route</Form.Label>
                <div className="d-flex gap-2">
                  <Form.Select
                    size="sm"
                    value={placementRouteValue}
                    onChange={(e) => setPlacementRouteValue(e.target.value)}
                    disabled={placementSaving}
                  >
                    <option value="">Select route…</option>
                    {routeOptions.map((route) => (
                      <option key={route} value={route}>
                        {route} ({routeCounts[route] ?? 0})
                      </option>
                    ))}
                  </Form.Select>
                  <Button size="sm" onClick={saveAssignedRoute} disabled={placementSaving}>
                    {placementSaving ? 'Saving...' : 'Save Route'}
                  </Button>
                </div>
              </Form.Group>
              {placementRouteError ? <div className="text-danger small">{placementRouteError}</div> : null}
              <div className="d-flex align-items-center gap-2 flex-wrap">
                {!showPlacementAddressPanel ? (
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    onClick={() => {
                      setShowPlacementAddressPanel(true)
                      setPlacementError(null)
                    }}
                    disabled={placementSaving}
                  >
                    Edit display address / map pin
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    onClick={() => {
                      setShowPlacementAddressPanel(false)
                      setPlacementCandidates([])
                      setPlacementLoading(false)
                      setPlacementError(null)
                    }}
                    disabled={placementSaving}
                  >
                    Hide address lookup
                  </Button>
                )}
              </div>
              {showPlacementAddressPanel ? (
                <>
                  <div className="monthly-map-panel__search">
                    <div className="app-topbar-location-search">
                      <div className="app-topbar-location-search__field">
                        <i className="bi bi-search app-topbar-location-search__icon" aria-hidden />
                        <Form.Control
                          type="search"
                          size="sm"
                          className="app-topbar-location-search__input"
                          value={placementQuery}
                          placeholder="Search address in Greater Victoria…"
                          aria-label="Search address for map pin"
                          onChange={(e) => setPlacementQuery(e.target.value)}
                          disabled={placementSaving}
                        />
                      </div>
                    </div>
                  </div>
                  {placementLoading ? <div className="text-muted">Searching addresses...</div> : null}
                  {placementError ? <div className="text-danger">{placementError}</div> : null}
                  {!placementLoading &&
                  placementQuery.trim().length >= 3 &&
                  placementCandidates.length === 0 ? (
                    <div className="text-muted">No candidate addresses found.</div>
                  ) : null}
                  <div className="monthly-map-placement-modal__candidates d-flex flex-column gap-1">
                    {placementCandidates.map((candidate) => (
                      <button
                        key={`${candidate.display_address}-${candidate.latitude}-${candidate.longitude}`}
                        type="button"
                        className="monthly-map-panel__search-option"
                        disabled={placementSaving}
                        onClick={() => applyPlacementCandidate(candidate)}
                      >
                        {candidate.display_address}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </Modal.Body>
      </Modal>
    </div>
  )
}
