import { describe, expect, it } from 'vitest'
import {
  buildHeaderSearchResults,
  matchHeaderSearchRoutes,
} from './monthlyHeaderSearchShared'
import type { LibraryLocation, MonthlyRouteSummary } from './monthlyRoutesShared'

const routes: MonthlyRouteSummary[] = [
  {
    id: 1,
    route_number: 1,
    label: 'R1 · 1st Monday',
    weekday_iso: 0,
    week_occurrence: 1,
    location_count: 5,
  },
  {
    id: 10,
    route_number: 10,
    label: 'R10 · 2nd Tuesday',
    weekday_iso: 1,
    week_occurrence: 2,
    location_count: 3,
  },
]

const location = { id: 101, label: 'Tower A', address: '1 Main St' } as LibraryLocation

describe('matchHeaderSearchRoutes', () => {
  it('matches an exact route token without matching longer route numbers', () => {
    expect(matchHeaderSearchRoutes(routes, 'R1').map((route) => route.route_number)).toEqual([1])
    expect(matchHeaderSearchRoutes(routes, 'r10').map((route) => route.route_number)).toEqual([10])
  })

  it('matches route schedule text', () => {
    expect(matchHeaderSearchRoutes(routes, 'monday').map((route) => route.route_number)).toEqual([1])
  })
})

describe('buildHeaderSearchResults', () => {
  it('places route matches before locations', () => {
    const results = buildHeaderSearchResults(routes, [location], 'R1', 3)
    expect(results[0]).toEqual({ kind: 'route', route: routes[0] })
    expect(results[1]).toEqual({ kind: 'location', location })
  })
})
