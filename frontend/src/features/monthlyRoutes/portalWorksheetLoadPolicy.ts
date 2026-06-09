/** When to request ``refresh_paperwork=1`` on portal worksheet GET (once per tab session). */

const SESSION_PREFIX = 'portalPaperworkRefresh.v1::'

function sessionKey(routeId: number, monthIso: string): string {
  return `${SESSION_PREFIX}${routeId}::${monthIso}`
}

/** True the first time this route-month is opened in the current browser tab session. */
export function shouldRequestPortalPaperworkRefresh(routeId: number, monthIso: string): boolean {
  if (typeof sessionStorage === 'undefined') return true
  return sessionStorage.getItem(sessionKey(routeId, monthIso)) !== '1'
}

export function markPortalPaperworkRefreshRequested(routeId: number, monthIso: string): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(sessionKey(routeId, monthIso), '1')
}
