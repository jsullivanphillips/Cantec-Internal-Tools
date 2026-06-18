import { describe, expect, it } from 'vitest'
import {
  countFittingMonthlyLocationTags,
  normalizeMonthlyLocationTableTags,
} from './monthlyLocationTableTagsShared'

describe('countFittingMonthlyLocationTags', () => {
  it('returns zero when there is no width', () => {
    expect(countFittingMonthlyLocationTags([40, 40], 0, 4, 16)).toBe(0)
  })

  it('fits every tag when there is enough room', () => {
    expect(countFittingMonthlyLocationTags([30, 30, 30], 200, 4, 16)).toBe(3)
  })

  it('reserves space for ellipsis when more tags remain', () => {
    expect(countFittingMonthlyLocationTags([50, 50, 50], 110, 4, 16)).toBe(1)
  })

  it('returns zero when even the first tag cannot fit with ellipsis', () => {
    expect(countFittingMonthlyLocationTags([80, 80], 60, 4, 16)).toBe(0)
  })
})

describe('normalizeMonthlyLocationTableTags', () => {
  it('trims and drops empty values', () => {
    expect(normalizeMonthlyLocationTableTags([' Keys ', '', '  '])).toEqual(['Keys'])
  })
})
