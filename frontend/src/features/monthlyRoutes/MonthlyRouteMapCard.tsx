import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Spinner } from 'react-bootstrap'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { apiJson, isAbortError } from '../../lib/apiClient'
import {
  normalizeMapCoordinates,
  type MonthlyRouteCalculatedPathPayload,
  type MonthlyRouteCalculatedPathStop,
  type RouteLocationListItem,
} from './monthlyRoutesShared'

type MonthlyRouteMapCardProps = {
  routeId: number
  stops: RouteLocationListItem[]
  orderSignature: string
}

function formatDistanceMeters(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value < 1000) return `${Math.round(value)} m`
  return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} km`
}

function formatDurationSeconds(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const minutes = Math.round(value / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`
}

function calculatedAtLabel(value: string | null): string {
  if (!value) return 'Not calculated'
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return 'Calculated'
  return `Calculated ${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

function stopCoordinates(stop: MonthlyRouteCalculatedPathStop) {
  return normalizeMapCoordinates(stop.latitude, stop.longitude)
}

export default function MonthlyRouteMapCard({
  routeId,
  stops,
  orderSignature,
}: MonthlyRouteMapCardProps) {
  const mapToken = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const [payload, setPayload] = useState<MonthlyRouteCalculatedPathPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manualRefreshNonce, setManualRefreshNonce] = useState(0)

  const localCoordinateCount = useMemo(
    () => stops.filter((stop) => normalizeMapCoordinates(stop.latitude, stop.longitude) != null).length,
    [stops]
  )

  const load = useCallback(
    async (signal?: AbortSignal, forceRefresh = false) => {
      setLoading(true)
      setError(null)
      try {
        const params = forceRefresh ? '?refresh=true' : ''
        const data = await apiJson<MonthlyRouteCalculatedPathPayload>(
          `/api/monthly_routes/routes/${routeId}/calculated_path${params}`,
          { signal }
        )
        if (!signal?.aborted) setPayload(data)
      } catch (err) {
        if (isAbortError(err)) return
        setError('Unable to load calculated route.')
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [routeId]
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal, manualRefreshNonce > 0)
    return () => controller.abort()
  }, [load, orderSignature, manualRefreshNonce])

  useEffect(() => {
    if (!containerRef.current || !mapToken || mapRef.current) return
    mapboxgl.accessToken = mapToken
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/outdoors-v12',
      center: [-123.3656, 48.4284],
      zoom: 10,
    })
    map.addControl(new mapboxgl.NavigationControl(), 'top-right')
    mapRef.current = map

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(() => map.resize())
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      markersRef.current.forEach((marker) => marker.remove())
      markersRef.current = []
      map.remove()
      mapRef.current = null
    }
  }, [mapToken])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !payload) return

    const draw = () => {
      markersRef.current.forEach((marker) => marker.remove())
      markersRef.current = []

      if (map.getLayer('monthly-route-line')) map.removeLayer('monthly-route-line')
      if (map.getSource('monthly-route-line')) map.removeSource('monthly-route-line')

      const bounds = new mapboxgl.LngLatBounds()
      const geometry = payload.geometry
      if (geometry?.type === 'LineString' && Array.isArray(geometry.coordinates)) {
        map.addSource('monthly-route-line', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry,
          },
        })
        map.addLayer({
          id: 'monthly-route-line',
          type: 'line',
          source: 'monthly-route-line',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#164b7c',
            'line-width': 4,
            'line-opacity': 0.82,
          },
        })
        geometry.coordinates.forEach(([lng, lat]) => {
          bounds.extend([lng, lat])
        })
      }

      payload.stops.forEach((stop, index) => {
        const coords = stopCoordinates(stop)
        if (!coords) return

        const el = document.createElement('div')
        el.className = 'monthly-route-map-marker'
        el.textContent = String(index + 1)

        const popupBody = document.createElement('div')
        const title = document.createElement('strong')
        title.textContent = stop.label
        popupBody.appendChild(title)
        if (stop.building) {
          popupBody.appendChild(document.createElement('br'))
          const building = document.createElement('span')
          building.textContent = stop.building
          popupBody.appendChild(building)
        }
        popupBody.appendChild(document.createElement('br'))
        const link = document.createElement('a')
        link.href = `/monthlies/locations/${stop.id}`
        link.className = 'btn btn-sm btn-outline-primary mt-2'
        link.textContent = 'Location page'
        popupBody.appendChild(link)

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([coords.lng, coords.lat])
          .setPopup(new mapboxgl.Popup({ offset: 10 }).setDOMContent(popupBody))
          .addTo(map)
        markersRef.current.push(marker)
        bounds.extend([coords.lng, coords.lat])
      })

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 52, maxZoom: 14 })
      }
      window.requestAnimationFrame(() => map.resize())
    }

    if (map.loaded()) draw()
    else map.once('load', draw)
  }, [payload])

  const validStops = payload?.stops.filter((stop) => stopCoordinates(stop) != null) ?? []
  const routeUnavailable = payload?.status && payload.status !== 'ok'

  if (!mapToken) {
    return (
      <div className="monthly-route-map-card__empty">
        Missing <code>VITE_MAPBOX_TOKEN</code>. Add it to frontend env to render the route map.
      </div>
    )
  }

  return (
    <div className="monthly-route-map-card">
      <div className="monthly-route-map-card__toolbar">
        <div className="monthly-route-map-card__stats">
          <span>
            <strong>{formatDistanceMeters(payload?.distance_meters ?? null)}</strong>
            Distance
          </span>
          <span>
            <strong>{formatDurationSeconds(payload?.duration_seconds ?? null)}</strong>
            Drive time
          </span>
          <span>
            <strong>{payload?.waypoint_count ?? localCoordinateCount}</strong>
            Routable stops
          </span>
          <span>
            <strong>{payload?.missing_coordinate_stops.length ?? 0}</strong>
            Missing coords
          </span>
        </div>
        <div className="monthly-route-map-card__actions">
          {loading ? <Spinner size="sm" animation="border" role="status" /> : null}
          <Button
            type="button"
            size="sm"
            variant="outline-secondary"
            onClick={() => setManualRefreshNonce((n) => n + 1)}
            disabled={loading}
          >
            Refresh route
          </Button>
        </div>
      </div>

      {error ? <Alert variant="danger" className="py-2 small mb-2">{error}</Alert> : null}
      {routeUnavailable ? (
        <Alert variant="light" className="monthly-route-map-card__notice">
          {payload?.status === 'mapbox_token_missing'
            ? 'MAPBOX_ACCESS_TOKEN is not configured on the backend, so the route cannot be calculated.'
            : payload?.status === 'not_enough_coordinates'
              ? 'At least two stops need coordinates before a route can be calculated.'
              : payload?.error || 'Mapbox could not calculate this route.'}
        </Alert>
      ) : null}

      <div className="monthly-route-map-card__canvas" ref={containerRef} />

      <div className="monthly-route-map-card__footer">
        <span>{calculatedAtLabel(payload?.calculated_at ?? null)}</span>
        <span>{payload?.cache_status ? `Cache: ${payload.cache_status}` : 'Cache: —'}</span>
        <span>{validStops.length} markers shown</span>
      </div>
    </div>
  )
}
