import type { LibraryLocation, MonthlyRouteSummary } from './monthlyRoutesShared'
import { apiJson } from '../../lib/apiClient'

export type MonthlyRoutesListPayload = {
  routes: { route: MonthlyRouteSummary }[]
}

export type HeaderSearchResult =
  | { kind: 'route'; route: MonthlyRouteSummary }
  | { kind: 'location'; location: LibraryLocation }

const ROUTE_ONLY_RE = /^r?(\d+)$/i

export async function fetchMonthlyRoutesForHeaderSearch(): Promise<MonthlyRouteSummary[]> {
  const payload = await apiJson<MonthlyRoutesListPayload>('/api/monthly_routes/routes')
  return (payload.routes ?? []).map((row) => row.route)
}

export function matchHeaderSearchRoutes(
  routes: MonthlyRouteSummary[],
  query: string,
): MonthlyRouteSummary[] {
  const trimmed = query.trim()
  if (!trimmed) return []

  const routeOnly = ROUTE_ONLY_RE.exec(trimmed)
  if (routeOnly) {
    const routeNumber = Number.parseInt(routeOnly[1], 10)
    if (!Number.isFinite(routeNumber)) return []
    return routes.filter((route) => route.route_number === routeNumber)
  }

  const q = trimmed.toLowerCase()
  return routes.filter((route) => {
    const tokens = [
      `r${route.route_number}`,
      route.label,
      route.display_name ?? '',
    ]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
    return tokens.some((token) => token.includes(q))
  })
}

export function routeHeaderSearchTitle(route: MonthlyRouteSummary): string {
  return `R${route.route_number}`
}

export function routeHeaderSearchMetaLine(route: MonthlyRouteSummary): string | null {
  const parts: string[] = []
  const schedule = route.label.replace(/^R\d+\s*·\s*/i, '').trim()
  if (schedule) parts.push(schedule)
  if (typeof route.location_count === 'number') {
    const count = route.location_count
    parts.push(`${count} location${count === 1 ? '' : 's'}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

export function buildHeaderSearchResults(
  routes: MonthlyRouteSummary[],
  locations: LibraryLocation[],
  query: string,
  locationLimit: number,
): HeaderSearchResult[] {
  const routeMatches = matchHeaderSearchRoutes(routes, query)
  const items: HeaderSearchResult[] = routeMatches.map((route) => ({ kind: 'route', route }))
  for (const location of locations.slice(0, locationLimit)) {
    items.push({ kind: 'location', location })
  }
  return items
}
