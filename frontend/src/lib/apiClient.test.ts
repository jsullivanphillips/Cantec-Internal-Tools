import { describe, expect, it } from 'vitest'
import { apiErrorText, coerceDisplayNumber, coerceUiText, formatThrownError } from './apiClient'

describe('coerceUiText', () => {
  it('stringifies empty objects', () => {
    expect(coerceUiText({})).toBe('{}')
  })
})

describe('coerceDisplayNumber', () => {
  it('returns fallback for empty objects from bad API payloads', () => {
    expect(coerceDisplayNumber({}, 0)).toBe(0)
    expect(coerceDisplayNumber({}, null)).toBeNull()
  })

  it('parses finite numbers', () => {
    expect(coerceDisplayNumber(12, null)).toBe(12)
    expect(coerceDisplayNumber('7', null)).toBe(7)
  })
})

describe('apiErrorText', () => {
  it('uses fallback for empty object error fields', () => {
    expect(apiErrorText({}, 'Something went wrong')).toBe('Something went wrong')
  })

  it('returns string API errors', () => {
    expect(apiErrorText('Weekly data missing', 'fallback')).toBe('Weekly data missing')
  })
})

describe('formatThrownError', () => {
  it('coerces object error fields from API bodies', () => {
    expect(formatThrownError({ error: {} }, 'Save failed')).toBe('Save failed')
    expect(formatThrownError({ error: 'Not allowed' }, 'Save failed')).toBe('Not allowed')
  })

  it('uses Error message when thrown', () => {
    expect(formatThrownError(new Error('Network down'), 'fallback')).toBe('Network down')
  })
})
