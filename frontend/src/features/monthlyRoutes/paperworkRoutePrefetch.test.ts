import { describe, expect, it } from 'vitest'
import { adjacentSelectableMonths } from './paperworkRoutePrefetch'

describe('paperworkRoutePrefetch', () => {
  const months = [
    { monthIso: '2026-04-01' },
    { monthIso: '2026-05-01' },
    { monthIso: '2026-06-01' },
    { monthIso: '2026-07-01' },
  ]

  it('returns previous and next selectable months', () => {
    expect(adjacentSelectableMonths('2026-05-01', months)).toEqual([
      '2026-04-01',
      '2026-06-01',
    ])
  })

  it('returns only next month at the start of the list', () => {
    expect(adjacentSelectableMonths('2026-04-01', months)).toEqual(['2026-05-01'])
  })

  it('returns only previous month at the end of the list', () => {
    expect(adjacentSelectableMonths('2026-07-01', months)).toEqual(['2026-06-01'])
  })

  it('returns empty when month is not selectable', () => {
    expect(adjacentSelectableMonths('2026-03-01', months)).toEqual([])
  })
})
