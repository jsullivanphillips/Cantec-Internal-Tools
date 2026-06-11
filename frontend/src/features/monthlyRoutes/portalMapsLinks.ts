import {
  normalizeMapCoordinates,
  type TechnicianWorksheetLocation,
} from './monthlyRoutesShared'

export type PortalMapsProvider = 'apple' | 'google'

export const PORTAL_MAPS_PROVIDER_KEY = 'portal_maps_provider'

export type PortalMapsTarget = {
  lat: number
  lng: number
  query: string | null
}

export function getPortalMapsProvider(): PortalMapsProvider | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(PORTAL_MAPS_PROVIDER_KEY)
  if (raw === 'apple' || raw === 'google') return raw
  return null
}

export function setPortalMapsProvider(provider: PortalMapsProvider): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(PORTAL_MAPS_PROVIDER_KEY, provider)
}

export function resolveStopMapsTarget(
  stop: Pick<TechnicianWorksheetLocation, 'display_address' | 'latitude' | 'longitude'>,
): PortalMapsTarget | null {
  const query = (stop.display_address || '').trim() || null
  const coords = normalizeMapCoordinates(stop.latitude, stop.longitude)
  if (coords) {
    return { lat: coords.lat, lng: coords.lng, query }
  }
  if (query) {
    return { lat: NaN, lng: NaN, query }
  }
  return null
}

export function buildMapsUrl(
  provider: PortalMapsProvider,
  target: PortalMapsTarget,
): string | null {
  const coords = normalizeMapCoordinates(
    Number.isFinite(target.lat) ? target.lat : null,
    Number.isFinite(target.lng) ? target.lng : null,
  )
  const query = (target.query || '').trim()

  if (provider === 'google') {
    if (query) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
    }
    if (coords) {
      const coordQuery = `${coords.lat},${coords.lng}`
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordQuery)}`
    }
    return null
  }

  if (coords) {
    const coordQuery = `${coords.lat},${coords.lng}`
    return `https://maps.apple.com/?q=${encodeURIComponent(coordQuery)}`
  }

  if (!query) return null

  return `https://maps.apple.com/?address=${encodeURIComponent(query)}`
}

export function openMapsLocation(
  provider: PortalMapsProvider,
  stop: Pick<TechnicianWorksheetLocation, 'display_address' | 'latitude' | 'longitude'>,
): boolean {
  const target = resolveStopMapsTarget(stop)
  if (!target) return false
  const url = buildMapsUrl(provider, target)
  if (!url) return false
  window.open(url, '_blank', 'noopener,noreferrer')
  return true
}
