import { describe, expect, it } from 'vitest'
import {
  activeRouteLocations,
  mergeVisibleRouteLocationReorder,
  type RouteLocationListItem,
} from './monthlyRoutesShared'

function loc(id: number, status: string): RouteLocationListItem {
  return {
    id,
    address: `Addr ${id}`,
    status_normalized: status,
    route_stop_order: id - 1,
  }
}

describe('route location cancelled filters', () => {
  it('activeRouteLocations drops cancelled rows', () => {
    const rows = [loc(1, 'active'), loc(2, 'cancelled'), loc(3, 'on_hold')]
    expect(activeRouteLocations(rows).map((row) => row.id)).toEqual([1, 3])
  })

  it('mergeVisibleRouteLocationReorder keeps cancelled slots while reordering visible stops', () => {
    const full = [loc(1, 'active'), loc(2, 'cancelled'), loc(3, 'active')]
    const reorderedVisible = [loc(3, 'active'), loc(1, 'active')]
    expect(mergeVisibleRouteLocationReorder(full, reorderedVisible).map((row) => row.id)).toEqual([
      3, 2, 1,
    ])
  })
})
