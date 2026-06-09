import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPortalSessionSnapshot,
  isPortalNetworkUnavailableError,
  portalSessionSnapshotForOfflineBoot,
  readPortalSessionSnapshot,
  writePortalSessionSnapshot,
} from './portalSessionSnapshot'

function installSessionStorageMock(): void {
  const store = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  })
}

describe('portalSessionSnapshot', () => {
  beforeEach(() => {
    installSessionStorageMock()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes and reads unlock + technician state', () => {
    writePortalSessionSnapshot({
      unlocked: true,
      technician: { id: '7', name: 'Alex' },
    })
    expect(readPortalSessionSnapshot()).toEqual({
      unlocked: true,
      technician: { id: '7', name: 'Alex' },
    })
  })

  it('merges partial updates onto the previous snapshot', () => {
    writePortalSessionSnapshot({
      unlocked: true,
      technician: { id: '7', name: 'Alex' },
    })
    writePortalSessionSnapshot({ technician: { id: '8', name: 'Jamie' } })
    expect(readPortalSessionSnapshot()).toEqual({
      unlocked: true,
      technician: { id: '8', name: 'Jamie' },
    })
  })

  it('clears the snapshot on lock/logout', () => {
    writePortalSessionSnapshot({ unlocked: true, technician: null })
    clearPortalSessionSnapshot()
    expect(readPortalSessionSnapshot()).toBeNull()
  })

  it('returns unlocked snapshot for offline boot only when unlocked', () => {
    writePortalSessionSnapshot({ unlocked: false, technician: null })
    expect(portalSessionSnapshotForOfflineBoot()).toBeNull()

    writePortalSessionSnapshot({
      unlocked: true,
      technician: { id: '7', name: 'Alex' },
    })
    expect(portalSessionSnapshotForOfflineBoot()).toEqual({
      unlocked: true,
      technician: { id: '7', name: 'Alex' },
    })
  })

  it('treats auth errors as available network with server rejection', () => {
    vi.stubGlobal('navigator', { onLine: true })
    expect(isPortalNetworkUnavailableError({ code: 'portal_locked' })).toBe(false)
    expect(isPortalNetworkUnavailableError({ code: 'auth_required' })).toBe(false)
  })

  it('treats offline and fetch failures as network unavailable', () => {
    vi.stubGlobal('navigator', { onLine: false })
    expect(isPortalNetworkUnavailableError({ code: 'other' })).toBe(true)

    vi.stubGlobal('navigator', { onLine: true })
    expect(isPortalNetworkUnavailableError(new TypeError('Failed to fetch'))).toBe(true)
  })
})
