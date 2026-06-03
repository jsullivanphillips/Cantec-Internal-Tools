import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Alert, Button, Collapse, Spinner } from 'react-bootstrap'

import { Link } from 'react-router-dom'

import mapboxgl from 'mapbox-gl'

import 'mapbox-gl/dist/mapbox-gl.css'

import { apiJson, isAbortError } from '../../lib/apiClient'

import MonthlyLocationMapPinModal from './MonthlyLocationMapPinModal'

import {

  normalizeMapCoordinates,

  type MonthlyRouteCalculatedPathPayload,

  type MonthlyRouteCalculatedPathStop,

  type RouteGeocodeMissingResult,

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



function stopTitle(stop: MonthlyRouteCalculatedPathStop): string {

  return (stop.primary_label || stop.label || stop.address || `Location ${stop.id}`).trim()

}



function stopAddressLine(stop: MonthlyRouteCalculatedPathStop): string {

  const parts = [stop.address, stop.building].map((p) => (p || '').trim()).filter(Boolean)

  return parts.join(' · ') || '—'

}



export default function MonthlyRouteMapCard({

  routeId,

  stops,

  orderSignature,

}: MonthlyRouteMapCardProps) {

  const mapToken = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined

  const shellRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const mapRef = useRef<mapboxgl.Map | null>(null)

  const markersRef = useRef<mapboxgl.Marker[]>([])

  const [payload, setPayload] = useState<MonthlyRouteCalculatedPathPayload | null>(null)

  const [loading, setLoading] = useState(false)

  const [error, setError] = useState<string | null>(null)

  const [manualRefreshNonce, setManualRefreshNonce] = useState(0)

  const [missingPanelOpen, setMissingPanelOpen] = useState(true)

  const [bulkGeocoding, setBulkGeocoding] = useState(false)

  const [bulkGeocodeSummary, setBulkGeocodeSummary] = useState<string | null>(null)

  const [pinModalStop, setPinModalStop] = useState<MonthlyRouteCalculatedPathStop | null>(null)



  const localCoordinateCount = useMemo(

    () => stops.filter((stop) => normalizeMapCoordinates(stop.latitude, stop.longitude) != null).length,

    [stops]

  )



  const missingStops = payload?.missing_coordinate_stops ?? []

  const missingCount = missingStops.length



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



  const refreshMap = useCallback(() => {

    setManualRefreshNonce((n) => n + 1)

  }, [])



  useEffect(() => {

    const controller = new AbortController()

    void load(controller.signal, manualRefreshNonce > 0)

    return () => controller.abort()

  }, [load, orderSignature, manualRefreshNonce])



  useEffect(() => {

    if (missingCount > 0) setMissingPanelOpen(true)

  }, [missingCount])



  const runBulkGeocode = useCallback(async () => {

    setBulkGeocoding(true)

    setBulkGeocodeSummary(null)

    try {

      const res = await apiJson<RouteGeocodeMissingResult>(

        `/api/monthly_routes/routes/${routeId}/geocode_missing_coordinates`,

        { method: 'POST' }

      )

      if (res.attempted === 0) {

        setBulkGeocodeSummary('All stops on this route already have map coordinates.')

      } else if (res.failed.length === 0) {

        setBulkGeocodeSummary(`Geocoded ${res.updated_count} of ${res.attempted} stop(s).`)

      } else {

        setBulkGeocodeSummary(

          `Geocoded ${res.updated_count} of ${res.attempted}. ${res.failed.length} still need manual pins — fix the address or set the pin below.`

        )

      }

      refreshMap()

    } catch (err) {

      const msg =

        typeof err === 'object' && err && 'error' in err ? String((err as { error: unknown }).error) : null

      setBulkGeocodeSummary(msg || 'Unable to geocode missing stops.')

    } finally {

      setBulkGeocoding(false)

    }

  }, [routeId, refreshMap])



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
    if (shellRef.current) resizeObserver.observe(shellRef.current)

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

        title.textContent = stop.primary_label || stop.label

        popupBody.appendChild(title)

        const subline = (stop.billing_address_subline || '').trim()

        if (subline) {

          popupBody.appendChild(document.createElement('br'))

          const sub = document.createElement('span')

          sub.className = 'text-muted small'

          sub.textContent = subline

          popupBody.appendChild(sub)

        } else if ((stop.testing_site_count ?? 0) > 1 && stop.testing_site_labels?.length) {

          popupBody.appendChild(document.createElement('br'))

          const sites = document.createElement('span')

          sites.className = 'text-muted small'

          sites.textContent = stop.testing_site_labels.join(' · ')

          popupBody.appendChild(sites)

        }

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

          <span

            className={

              missingCount > 0 ? 'monthly-route-map-card__stat--warning' : undefined

            }

          >

            <strong>{missingCount}</strong>

            Missing coords

          </span>

        </div>

        <div className="monthly-route-map-card__actions">

          {loading ? <Spinner size="sm" animation="border" role="status" /> : null}

          {missingCount > 0 ? (

            <Button

              type="button"

              size="sm"

              variant="warning"

              disabled={loading || bulkGeocoding}

              onClick={() => void runBulkGeocode()}

            >

              {bulkGeocoding ? 'Geocoding…' : 'Geocode missing'}

            </Button>

          ) : null}

          <Button

            type="button"

            size="sm"

            variant="outline-secondary"

            onClick={refreshMap}

            disabled={loading || bulkGeocoding}

          >

            Refresh route

          </Button>

        </div>

      </div>



      {error ? <Alert variant="danger" className="py-2 small mb-2">{error}</Alert> : null}

      {bulkGeocodeSummary ? (

        <Alert variant="info" className="py-2 small mb-2">

          {bulkGeocodeSummary}

        </Alert>

      ) : null}

      {routeUnavailable ? (

        <Alert variant="light" className="monthly-route-map-card__notice">

          {payload?.status === 'mapbox_token_missing'

            ? 'MAPBOX_ACCESS_TOKEN is not configured on the backend, so the route cannot be calculated.'

            : payload?.status === 'not_enough_coordinates'

              ? 'At least two stops need coordinates before a route can be calculated.'

              : payload?.error || 'Mapbox could not calculate this route.'}

        </Alert>

      ) : null}



      {missingCount > 0 ? (

        <div className="monthly-route-map-card__missing-panel">

          <button

            type="button"

            className="monthly-route-map-card__missing-toggle"

            aria-expanded={missingPanelOpen}

            onClick={() => setMissingPanelOpen((open) => !open)}

          >

            <span>

              <i className="bi bi-geo-alt-fill text-warning me-2" aria-hidden />

              <strong>{missingCount}</strong> stop{missingCount === 1 ? '' : 's'} missing map coordinates

            </span>

            <i

              className={`bi bi-chevron-${missingPanelOpen ? 'up' : 'down'}`}

              aria-hidden

            />

          </button>

          <Collapse in={missingPanelOpen}>

            <div>

              <p className="monthly-route-map-card__missing-intro small text-muted mb-2">

                These stops are excluded from the driving route until they have a map pin. Try bulk geocode

                first; for any that fail, correct the street address or set the pin manually.

              </p>

              <ol className="monthly-route-map-card__missing-list mb-0">

                {missingStops.map((stop, index) => (

                  <li key={stop.id} className="monthly-route-map-card__missing-item">

                    <div className="monthly-route-map-card__missing-main">

                      <span className="monthly-route-map-card__missing-order">{index + 1}</span>

                      <div className="min-w-0">

                        <div className="fw-semibold text-break">{stopTitle(stop)}</div>

                        <div className="small text-muted text-break">{stopAddressLine(stop)}</div>

                      </div>

                    </div>

                    <div className="monthly-route-map-card__missing-actions">

                      <Button

                        type="button"

                        size="sm"

                        variant="outline-primary"

                        onClick={() => setPinModalStop(stop)}

                      >

                        Set pin

                      </Button>

                      <Link

                        to={`/monthlies/locations/${stop.id}`}

                        className="btn btn-sm btn-outline-secondary"

                      >

                        Edit address

                      </Link>

                    </div>

                  </li>

                ))}

              </ol>

            </div>

          </Collapse>

        </div>

      ) : null}



      <div
        ref={shellRef}
        className="monthly-route-map-card__canvas-shell"
        title="Drag the bottom edge to resize the map"
      >
        <div
          className="monthly-route-map-card__canvas"
          ref={containerRef}
          aria-label="Route map"
        />
      </div>



      <div className="monthly-route-map-card__footer">

        <span>{calculatedAtLabel(payload?.calculated_at ?? null)}</span>

        <span>{payload?.cache_status ? `Cache: ${payload.cache_status}` : 'Cache: —'}</span>

        <span>{validStops.length} markers shown</span>

        <span className="monthly-route-map-card__resize-hint">Drag bottom edge to resize</span>

      </div>



      {pinModalStop ? (

        <MonthlyLocationMapPinModal

          show

          locationId={pinModalStop.id}

          title={stopTitle(pinModalStop)}

          address={(pinModalStop.address || '').trim()}

          displayAddress={pinModalStop.display_address}

          onHide={() => setPinModalStop(null)}

          onSaved={() => {

            setPinModalStop(null)

            refreshMap()

          }}

        />

      ) : null}

    </div>

  )

}


