import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PORTAL_MAPS_PROVIDER_KEY,
  buildMapsUrl,
  getPortalMapsProvider,
  openMapsLocation,
  resolveStopMapsTarget,
  setPortalMapsProvider,
} from './portalMapsLinks'

describe('portalMapsLinks', () => {
  const storage = new Map<string, string>()
  const openMock = vi.fn()

  beforeEach(() => {
    storage.clear()
    openMock.mockReset()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
      removeItem: (key: string) => {
        storage.delete(key)
      },
    })
    vi.stubGlobal('window', { open: openMock })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores and reads maps provider preference', () => {
    expect(getPortalMapsProvider()).toBeNull()
    setPortalMapsProvider('apple')
    expect(getPortalMapsProvider()).toBe('apple')
    expect(storage.get(PORTAL_MAPS_PROVIDER_KEY)).toBe('apple')
    setPortalMapsProvider('google')
    expect(getPortalMapsProvider()).toBe('google')
  })

  it('prefers coordinates for Apple Maps but address for Google Maps when both exist', () => {
    const target = {
      lat: 48.6534,
      lng: -123.4196,
      query: '1080 Cypress Road, North Saanich, BC',
    }
    expect(buildMapsUrl('apple', target)).toBe('https://maps.apple.com/?q=48.6534%2C-123.4196')
    expect(buildMapsUrl('google', target)).toBe(
      'https://www.google.com/maps/search/?api=1&query=1080%20Cypress%20Road%2C%20North%20Saanich%2C%20BC',
    )
  })

  it('falls back to encoded address when coordinates are missing', () => {
    const target = {
      lat: NaN,
      lng: NaN,
      query: '1080 Cypress Road, North Saanich, British Columbia',
    }
    expect(buildMapsUrl('apple', target)).toBe(
      'https://maps.apple.com/?address=1080%20Cypress%20Road%2C%20North%20Saanich%2C%20British%20Columbia',
    )
    expect(buildMapsUrl('google', target)).toBe(
      'https://www.google.com/maps/search/?api=1&query=1080%20Cypress%20Road%2C%20North%20Saanich%2C%20British%20Columbia',
    )
  })

  it('resolveStopMapsTarget returns null when no location data', () => {
    expect(resolveStopMapsTarget({ display_address: '', latitude: null, longitude: null })).toBeNull()
    expect(
      resolveStopMapsTarget({
        display_address: '1080 Cypress Road',
        latitude: null,
        longitude: null,
      }),
    ).toEqual({
      lat: NaN,
      lng: NaN,
      query: '1080 Cypress Road',
    })
  })

  it('openMapsLocation opens a new window when target exists', () => {
    const ok = openMapsLocation('google', {
      display_address: '1045 Pandora Ave',
      latitude: 48.4284,
      longitude: -123.3656,
    })
    expect(ok).toBe(true)
    expect(openMock).toHaveBeenCalledWith(
      'https://www.google.com/maps/search/?api=1&query=1045%20Pandora%20Ave',
      '_blank',
      'noopener,noreferrer',
    )
  })
})
