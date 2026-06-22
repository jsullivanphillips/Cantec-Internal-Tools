import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitForPortalRouteSyncIdle } from './flushPortalRouteSync'
import * as worksheetOfflineStore from './worksheetOfflineStore'

describe('waitForPortalRouteSyncIdle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns true when queues are already idle', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    vi.spyOn(worksheetOfflineStore, 'hasPendingSyncForRouteMonth').mockReturnValue(false)
    vi.spyOn(worksheetOfflineStore, 'countPendingSyncBreakdownForRouteMonth').mockReturnValue({
      field: 0,
      workflow: 0,
      runLifecycle: 0,
      total: 0,
    })

    const result = await waitForPortalRouteSyncIdle(7, '2026-05-01', {
      runRunLifecycleSyncQueue: vi.fn(async () => {}),
      runFieldSyncQueue: vi.fn(async () => {}),
      runWorkflowSyncQueue: vi.fn(async () => {}),
      isFieldSyncing: () => false,
      isWorkflowSyncing: () => false,
      isRunLifecycleSyncing: () => false,
    })

    expect(result).toBe(true)
  })

  it('drains runners until pending sync clears', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    const pendingSpy = vi
      .spyOn(worksheetOfflineStore, 'hasPendingSyncForRouteMonth')
      .mockReturnValueOnce(true)
      .mockReturnValue(false)
    const breakdownSpy = vi
      .spyOn(worksheetOfflineStore, 'countPendingSyncBreakdownForRouteMonth')
      .mockReturnValue({ field: 0, workflow: 1, runLifecycle: 0, total: 1 })
    const runWorkflowSyncQueue = vi.fn(async () => {})
    const onProgress = vi.fn()

    const result = await waitForPortalRouteSyncIdle(7, '2026-05-01', {
      runRunLifecycleSyncQueue: vi.fn(async () => {}),
      runFieldSyncQueue: vi.fn(async () => {}),
      runWorkflowSyncQueue,
      isFieldSyncing: () => false,
      isWorkflowSyncing: () => false,
      isRunLifecycleSyncing: () => false,
    }, { onProgress })

    expect(result).toBe(true)
    expect(runWorkflowSyncQueue).toHaveBeenCalled()
    expect(pendingSpy.mock.calls.length).toBeGreaterThan(1)
    expect(breakdownSpy).toHaveBeenCalled()
    expect(onProgress).toHaveBeenCalled()
  })
})
