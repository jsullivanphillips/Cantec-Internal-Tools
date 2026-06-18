import { describe, expect, it } from 'vitest'
import { hasProcessingDataError, processingWowErrorLine } from './processingAttackShared'

describe('processingWowErrorLine', () => {
  it('falls back when processed.error is an empty object', () => {
    expect(processingWowErrorLine({}, 'Weekly totals could not be loaded.')).toBe(
      'Weekly totals could not be loaded.',
    )
  })

  it('returns string errors from the API', () => {
    expect(processingWowErrorLine('Data not ready yet', 'fallback')).toBe('Data not ready yet')
  })
})

describe('hasProcessingDataError', () => {
  it('treats empty object as present error state', () => {
    expect(hasProcessingDataError({})).toBe(true)
  })

  it('ignores null and empty string', () => {
    expect(hasProcessingDataError(null)).toBe(false)
    expect(hasProcessingDataError('')).toBe(false)
  })
})
