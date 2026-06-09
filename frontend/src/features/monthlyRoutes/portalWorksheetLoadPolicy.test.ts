import { describe, expect, it, vi } from 'vitest'
import {
  markPortalPaperworkRefreshRequested,
  shouldRequestPortalPaperworkRefresh,
} from './portalWorksheetLoadPolicy'

describe('portalWorksheetLoadPolicy', () => {
  it('requests paperwork refresh once per route-month per session', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
    })

    expect(shouldRequestPortalPaperworkRefresh(38, '2026-06-01')).toBe(true)
    markPortalPaperworkRefreshRequested(38, '2026-06-01')
    expect(shouldRequestPortalPaperworkRefresh(38, '2026-06-01')).toBe(false)
    expect(shouldRequestPortalPaperworkRefresh(38, '2026-05-01')).toBe(true)
  })
})
