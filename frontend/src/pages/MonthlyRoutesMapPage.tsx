import type { CSSProperties } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Form, Modal, Table } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import {
  MAP_ROUTE_UNASSIGNED,
  STATUS_OPTIONS,
  compareMonthlyRouteFilterNames,
  isLngLatInViewport,
  normalizeMapCoordinates,
  parseYearMonth,
  toMonthKey,
  type CreateLocationForm,
  type GeocodeCandidate,
  type LibraryLocation,
  type LibraryPayload,
  type MapViewportBounds,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import { apiJson, isAbortError } from '../lib/apiClient'

/** Build markers in slices so typing / focus stays responsive with hundreds of pins. */
const MAP_MARKER_BATCH_SIZE = 80

const MAP_SEARCH_DEBOUNCE_MS = 250

/** Add-location modal: debounced `/api/monthly_routes/geocode_candidates` */
const CREATE_LOCATION_GEOCODE_DEBOUNCE_MS = 250

const CREATE_LOCATION_CANDIDATES_STYLE: CSSProperties = {
  maxHeight: '11rem',
  overflowY: 'auto',
}

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
  const [newLocationForm, setNewLocationForm] = useState<CreateLocationForm>({
    address: '',
    property_management_company: '',
    status_raw: 'active',
    keys: '',
    test_day: '',
  })
  const [showCreateLocationModal, setShowCreateLocationModal] = useState(false)
  const [createLocationSaving, setCreateLocationSaving] = useState(false)
  const [createLocationError, setCreateLocationError] = useState<string | null>(null)
  /** Address line + geocode lookup (modal); submit uses selection or typed text */
  const [createLocationAddressQuery, setCreateLocationAddressQuery] = useState('')
  const [createLocationCandidates, setCreateLocationCandidates] = useState<GeocodeCandidate[]>([])
  const [createLocationLookupLoading, setCreateLocationLookupLoading] = useState(false)
  const [createLocationLookupError, setCreateLocationLookupError] = useState<string | null>(null)
  const [createLocationSelectedCandidate, setCreateLocationSelectedCandidate] =
    useState<GeocodeCandidate | null>(null)
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

  const mapLocationsRaw = mapPayload?.locations ?? []
  /** Match library default: hide cancelled markers on the map (no toggle on this page). */
  const mapLocations = useMemo(
    () =>
      mapLocationsRaw.filter((loc) => (loc.status_normalized || '').trim().toLowerCase() !== 'cancelled'),
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
      return next
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

  const openCreateLocationModal = useCallback(() => {
    setCreateLocationError(null)
    setCreateLocationAddressQuery('')
    setCreateLocationCandidates([])
    setCreateLocationLookupLoading(false)
    setCreateLocationLookupError(null)
    setCreateLocationSelectedCandidate(null)
    setNewLocationForm({
      address: '',
      property_management_company: '',
      status_raw: 'active',
      keys: '',
      test_day: '',
    })
    setShowCreateLocationModal(true)
  }, [])

  useEffect(() => {
    if (!showCreateLocationModal) return
    const query = createLocationAddressQuery.trim()
    if (query.length < 3) {
      setCreateLocationCandidates([])
      setCreateLocationLookupLoading(false)
      setCreateLocationLookupError(null)
      return
    }

    let active = true
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setCreateLocationLookupLoading(true)
      setCreateLocationLookupError(null)
      const params = new URLSearchParams({ q: query })
      apiJson<{ candidates: GeocodeCandidate[] }>(
        `/api/monthly_routes/geocode_candidates?${params.toString()}`,
        { signal: controller.signal }
      )
        .then((data) => {
          if (active) setCreateLocationCandidates(data.candidates || [])
        })
        .catch((err) => {
          if (!isAbortError(err) && active) {
            setCreateLocationCandidates([])
            setCreateLocationLookupError('Unable to fetch address suggestions.')
          }
        })
        .finally(() => {
          if (active) setCreateLocationLookupLoading(false)
        })
    }, CREATE_LOCATION_GEOCODE_DEBOUNCE_MS)

    return () => {
      active = false
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [showCreateLocationModal, createLocationAddressQuery])

  const submitCreateLocation = useCallback(async () => {
    const addressLine = (
      createLocationSelectedCandidate?.display_address ||
      createLocationAddressQuery ||
      ''
    ).trim()
    if (!addressLine) {
      setCreateLocationError('Address is required.')
      return
    }
    if (!newLocationForm.property_management_company.trim()) {
      setCreateLocationError('Property management company is required.')
      return
    }

    setCreateLocationSaving(true)
    setCreateLocationError(null)
    try {
      const payload: Record<string, unknown> = {
        address: addressLine,
        property_management_company: newLocationForm.property_management_company.trim(),
        status_raw: newLocationForm.status_raw,
      }
      const keysTrimmed = newLocationForm.keys.trim()
      if (keysTrimmed) payload.keys = keysTrimmed
      const routeTrimmed = (newLocationForm.test_day || '').trim()
      if (routeTrimmed) payload.test_day = routeTrimmed
      if (createLocationSelectedCandidate) {
        payload.display_address = createLocationSelectedCandidate.display_address
        payload.latitude = createLocationSelectedCandidate.latitude
        payload.longitude = createLocationSelectedCandidate.longitude
      }

      const response = await apiJson<{ location: LibraryLocation }>('/api/monthly_routes/library', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      mergeUpdatedLocation(response.location)
      setShowCreateLocationModal(false)
      setCreateLocationAddressQuery('')
      setCreateLocationCandidates([])
      setCreateLocationSelectedCandidate(null)
      setNewLocationForm({
        address: '',
        property_management_company: '',
        status_raw: 'active',
        keys: '',
        test_day: '',
      })
    } catch (err) {
      if (typeof err === 'object' && err && 'error' in err) {
        setCreateLocationError(String((err as { error: unknown }).error))
      } else {
        setCreateLocationError('Unable to create location.')
      }
    } finally {
      setCreateLocationSaving(false)
    }
  }, [
    mergeUpdatedLocation,
    newLocationForm.keys,
    newLocationForm.property_management_company,
    newLocationForm.status_raw,
    newLocationForm.test_day,
    createLocationAddressQuery,
    createLocationSelectedCandidate,
  ])

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
        className="monthly-routes-map-page__side-panel app-surface-card shadow border-0"
        onClick={(e) => e.stopPropagation()}
      >
        <Card.Body className="p-3 d-flex flex-column gap-2">
          <div className="d-flex flex-column gap-2 flex-shrink-0">
            <Form.Control
              type="search"
              ref={mapSearchInputRef}
              placeholder="Search address on map"
              className="py-2"
              style={{ minHeight: '2.75rem' }}
              onFocus={() => setShowMapSearchResults(true)}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                setShowMapSearchResults(true)
                handleMapSearchInputChange(e.target.value)
              }}
            />
            {showMapSearchResults ? (
              <div className="small" style={MAP_SEARCH_RESULTS_STYLE}>
                {mapSearchLoading ? (
                  <div className="text-muted px-1 py-1">Searching...</div>
                ) : mapSearchError ? (
                  <div className="text-danger px-1 py-1">{mapSearchError}</div>
                ) : mapSearchQuery.trim().length < 3 ? (
                  <div className="text-muted px-1 py-1">Type at least 3 characters.</div>
                ) : mapSearchCandidates.length === 0 ? (
                  <div className="text-muted px-1 py-1">No matching addresses.</div>
                ) : (
                  <div className="d-flex flex-column gap-1">
                    {mapSearchCandidates.map((candidate) => (
                      <Button
                        key={`${candidate.display_address}-${candidate.latitude}-${candidate.longitude}`}
                        variant="outline-secondary"
                        size="sm"
                        className="text-start"
                        onClick={() => handleMapSearchSelect(candidate)}
                      >
                        {candidate.display_address}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <div className="d-flex justify-content-between align-items-center flex-shrink-0">
            <div className="fw-semibold">Routes</div>
            <div className="small text-muted">{filteredMapLocations.length} markers</div>
          </div>
          <div className="btn-group btn-group-sm w-100 flex-shrink-0" role="group" aria-label="Map sidebar panel">
            <Button
              type="button"
              size="sm"
              variant={mapSidebarPanel === 'filters' ? 'primary' : 'outline-secondary'}
              className="flex-fill"
              onClick={() => setMapSidebarPanel('filters')}
            >
              Route filters
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mapSidebarPanel === 'viewport' ? 'primary' : 'outline-secondary'}
              className="flex-fill"
              onClick={() => setMapSidebarPanel('viewport')}
            >
              In map view
            </Button>
          </div>
          <div className="monthly-routes-map-page__side-panel-scroll d-flex flex-column gap-2 min-h-0">
          {mapSidebarPanel === 'filters' ? (
            <>
              <div className="d-flex gap-2 flex-shrink-0 w-100">
                <Button
                  size="sm"
                  variant="outline-secondary"
                  className="flex-fill"
                  onClick={() => {
                    const next = [...mapRouteOptions]
                    if (mapUnassignedCount > 0) next.push(MAP_ROUTE_UNASSIGNED)
                    setSelectedMapRoutes(next)
                  }}
                >
                  Select all
                </Button>
                <Button
                  size="sm"
                  variant="outline-secondary"
                  className="flex-fill"
                  onClick={() => setSelectedMapRoutes([])}
                >
                  Clear
                </Button>
              </div>
              <div className="small text-muted flex-shrink-0">
                {mapLoading
                  ? 'Loading map locations...'
                  : `${mapRouteOptions.length} route${mapRouteOptions.length === 1 ? '' : 's'}${
                      mapUnassignedCount > 0 ? ` · ${mapUnassignedCount} unassigned` : ''
                    }`}
              </div>
              <div className="overflow-auto flex-grow-1 min-h-0">
                <Table striped bordered hover size="sm" className="mb-0 align-middle">
                  <thead className="table-light">
                    <tr>
                      <th className="text-center" style={{ width: '2.75rem' }}>
                        Show
                      </th>
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
                          <span className="d-inline-flex align-items-center gap-2">
                            <span
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: '50%',
                                backgroundColor: routeColor(''),
                                display: 'inline-block',
                              }}
                            />
                            <span>Unassigned</span>
                          </span>
                        </td>
                        <td className="text-end">{mapUnassignedCount}</td>
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
                            <span className="d-inline-flex align-items-center gap-2">
                              <span
                                style={{
                                  width: 10,
                                  height: 10,
                                  borderRadius: '50%',
                                  backgroundColor: routeColor(route),
                                  display: 'inline-block',
                                }}
                              />
                              <span>{route}</span>
                            </span>
                          </td>
                          <td className="text-end">{count}</td>
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
                className="w-100 flex-shrink-0"
                onClick={applyRoutesInViewportSnapshot}
                disabled={!mapToken}
              >
                {mapViewportBounds != null && routesVisibleInMapViewport.totalMarkers > 0
                  ? 'Refresh routes in view'
                  : 'Find routes in view'}
              </Button>
              <div className="small text-muted flex-shrink-0">
                {mapViewportBounds == null
                  ? 'Pan or zoom the map, then click Find routes in view.'
                  : `${routesVisibleInMapViewport.totalMarkers} marker${
                      routesVisibleInMapViewport.totalMarkers === 1 ? '' : 's'
                    } in viewport`}
              </div>
              <div className="overflow-auto flex-grow-1 min-h-0">
                {mapViewportBounds == null ? null : (
                  <Table striped bordered hover size="sm" className="mb-0 align-middle">
                    <thead className="table-light">
                      <tr>
                        <th>Route</th>
                        <th className="text-end">In view</th>
                        <th className="text-end">In route</th>
                      </tr>
                    </thead>
                    <tbody>
                      {routesVisibleInMapViewport.totalMarkers === 0 ? (
                        <tr>
                          <td colSpan={3} className="text-muted small">
                            None in current view.
                          </td>
                        </tr>
                      ) : (
                        <>
                          {routesVisibleInMapViewport.unassignedInView > 0 ? (
                            <tr>
                              <td>
                                <span className="d-inline-flex align-items-center gap-2">
                                  <span
                                    style={{
                                      width: 10,
                                      height: 10,
                                      borderRadius: '50%',
                                      backgroundColor: routeColor(''),
                                      display: 'inline-block',
                                    }}
                                  />
                                  <span>Unassigned</span>
                                </span>
                              </td>
                              <td className="text-end">{routesVisibleInMapViewport.unassignedInView}</td>
                              <td className="text-end">{mapUnassignedCount}</td>
                            </tr>
                          ) : null}
                          {routesVisibleInMapViewport.namedRoutes.map(({ name, inView, inRoute }) => (
                            <tr key={`viewport-${name}`}>
                              <td>
                                <span className="d-inline-flex align-items-center gap-2">
                                  <span
                                    style={{
                                      width: 10,
                                      height: 10,
                                      borderRadius: '50%',
                                      backgroundColor: routeColor(name),
                                      display: 'inline-block',
                                    }}
                                  />
                                  <span>{name}</span>
                                </span>
                              </td>
                              <td className="text-end">{inView}</td>
                              <td className="text-end">{inRoute}</td>
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

      <Card
        className="app-surface-card shadow border-0"
        style={FLOAT_ADD_LOCATION_STYLE}
        onClick={(e) => e.stopPropagation()}
      >
        <Card.Body className="py-2 px-3">
          <Button size="sm" variant="primary" onClick={openCreateLocationModal}>
            Add Location
          </Button>
        </Card.Body>
      </Card>

      <Modal show={showCreateLocationModal} onHide={() => setShowCreateLocationModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="h6 mb-0">Add Location</Modal.Title>
        </Modal.Header>
        <Modal.Body className="small d-flex flex-column gap-2">
          {createLocationError ? <div className="text-danger">{createLocationError}</div> : null}
          <Form.Group>
            <Form.Label className="small mb-1">Address</Form.Label>
            <Form.Control
              size="sm"
              type="search"
              value={createLocationAddressQuery}
              placeholder="Search address (Greater Victoria)"
              onChange={(e) => {
                const v = e.target.value
                setCreateLocationAddressQuery(v)
                setCreateLocationSelectedCandidate(null)
              }}
            />
            {!createLocationSelectedCandidate && createLocationLookupLoading ? (
              <div className="text-muted mt-1">Searching addresses...</div>
            ) : null}
            {!createLocationSelectedCandidate && createLocationLookupError ? (
              <div className="text-danger mt-1">{createLocationLookupError}</div>
            ) : null}
            {!createLocationSelectedCandidate &&
            !createLocationLookupLoading &&
            createLocationAddressQuery.trim().length >= 3 &&
            createLocationCandidates.length === 0 ? (
              <div className="text-muted mt-1">No matching addresses.</div>
            ) : null}
            {!createLocationSelectedCandidate && createLocationCandidates.length > 0 ? (
              <div className="d-flex flex-column gap-1 mt-2" style={CREATE_LOCATION_CANDIDATES_STYLE}>
                {createLocationCandidates.map((candidate) => (
                  <Button
                    key={`${candidate.display_address}-${candidate.latitude}-${candidate.longitude}`}
                    variant="outline-secondary"
                    size="sm"
                    className="text-start"
                    onClick={() => {
                      setCreateLocationSelectedCandidate(candidate)
                      setCreateLocationAddressQuery(candidate.display_address)
                      setCreateLocationCandidates([])
                    }}
                  >
                    {candidate.display_address}
                  </Button>
                ))}
              </div>
            ) : null}
            {createLocationSelectedCandidate ? (
              <div className="text-success small mt-1">Map pin will use the selected address.</div>
            ) : null}
          </Form.Group>
          <Form.Group>
            <Form.Label className="small mb-1">Route (optional)</Form.Label>
            <Form.Select
              size="sm"
              value={newLocationForm.test_day ?? ''}
              onChange={(e) => setNewLocationForm((prev) => ({ ...prev, test_day: e.target.value }))}
            >
              <option value="">Unassigned</option>
              {routeOptions.map((route) => (
                <option key={route} value={route}>
                  {route}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
          <Form.Group>
            <Form.Label className="small mb-1">Property Management Company</Form.Label>
            <Form.Control
              size="sm"
              value={newLocationForm.property_management_company}
              onChange={(e) =>
                setNewLocationForm((prev) => ({
                  ...prev,
                  property_management_company: e.target.value,
                }))
              }
            />
          </Form.Group>
          <Form.Group>
            <Form.Label className="small mb-1">Status</Form.Label>
            <Form.Select
              size="sm"
              value={newLocationForm.status_raw}
              onChange={(e) => setNewLocationForm((prev) => ({ ...prev, status_raw: e.target.value }))}
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
          <Form.Group>
            <Form.Label className="small mb-1">Keys (optional)</Form.Label>
            <Form.Control
              size="sm"
              value={newLocationForm.keys}
              onChange={(e) => setNewLocationForm((prev) => ({ ...prev, keys: e.target.value }))}
            />
          </Form.Group>
          <div className="d-flex justify-content-end gap-2 mt-2">
            <Button
              size="sm"
              variant="outline-secondary"
              onClick={() => setShowCreateLocationModal(false)}
              disabled={createLocationSaving}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={submitCreateLocation} disabled={createLocationSaving}>
              {createLocationSaving ? 'Saving...' : 'Create Location'}
            </Button>
          </div>
        </Modal.Body>
      </Modal>

      <Modal show={Boolean(placementLocation)} onHide={closePlacementEditor} centered>
        <Modal.Header closeButton>
          <Modal.Title className="h6 mb-0">Edit Marker Placement</Modal.Title>
        </Modal.Header>
        <Modal.Body className="small">
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
                  <Form.Control
                    type="search"
                    value={placementQuery}
                    placeholder="Search address in Greater Victoria"
                    onChange={(e) => setPlacementQuery(e.target.value)}
                    disabled={placementSaving}
                  />
                  {placementLoading ? <div className="text-muted">Searching addresses...</div> : null}
                  {placementError ? <div className="text-danger">{placementError}</div> : null}
                  {!placementLoading &&
                  placementQuery.trim().length >= 3 &&
                  placementCandidates.length === 0 ? (
                    <div className="text-muted">No candidate addresses found.</div>
                  ) : null}
                  <div className="d-flex flex-column gap-2" style={{ maxHeight: '16rem', overflowY: 'auto' }}>
                    {placementCandidates.map((candidate) => (
                      <Button
                        key={`${candidate.display_address}-${candidate.latitude}-${candidate.longitude}`}
                        variant="outline-primary"
                        className="text-start"
                        disabled={placementSaving}
                        onClick={() => applyPlacementCandidate(candidate)}
                      >
                        {candidate.display_address}
                      </Button>
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
