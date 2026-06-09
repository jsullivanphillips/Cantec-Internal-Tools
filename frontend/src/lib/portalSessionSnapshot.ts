const STORAGE_KEY = 'portalSessionSnapshot'

export type PortalTechnicianSnapshot = {
  id: string
  name: string
}

export type PortalSessionSnapshot = {
  unlocked: boolean
  technician: PortalTechnicianSnapshot | null
}

function safeParse<T>(text: string | null): T | null {
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

export function readPortalSessionSnapshot(): PortalSessionSnapshot | null {
  if (typeof sessionStorage === 'undefined') return null
  return safeParse<PortalSessionSnapshot>(sessionStorage.getItem(STORAGE_KEY))
}

export function writePortalSessionSnapshot(patch: Partial<PortalSessionSnapshot>): void {
  if (typeof sessionStorage === 'undefined') return
  const prev = readPortalSessionSnapshot()
  const next: PortalSessionSnapshot = {
    unlocked: patch.unlocked ?? prev?.unlocked ?? false,
    technician: patch.technician !== undefined ? patch.technician : (prev?.technician ?? null),
  }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

export function clearPortalSessionSnapshot(): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(STORAGE_KEY)
}

/** True when the browser reports offline or a fetch failed without an auth error code. */
export function isPortalNetworkUnavailableError(error: unknown): boolean {
  if (!navigator.onLine) return true
  if (error instanceof TypeError) return true
  if (typeof error === 'object' && error != null && 'code' in error) {
    const code = String((error as { code?: string }).code ?? '')
    if (code === 'portal_locked' || code === 'auth_required') return false
  }
  return true
}

/** Restore unlock/technician state when the portal cannot reach the server. */
export function portalSessionSnapshotForOfflineBoot(): PortalSessionSnapshot | null {
  const snapshot = readPortalSessionSnapshot()
  if (!snapshot?.unlocked) return null
  return snapshot
}
