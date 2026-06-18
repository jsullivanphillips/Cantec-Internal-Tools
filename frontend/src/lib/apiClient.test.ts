import { describe, expect, it } from 'vitest'
import { apiErrorText, coerceUiText, formatThrownError } from './apiClient'

describe('coerceUiText', () => {
  it('stringifies empty objects', () => {
    expect(coerceUiText({})).toBe('{}')
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
