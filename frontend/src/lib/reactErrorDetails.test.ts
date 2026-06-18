import { describe, expect, it } from 'vitest'
import { formatReactMinifiedErrorDetails, parseReactMinifiedError } from './reactErrorDetails'

const SAMPLE_31 =
  'Minified React error #31; visit https://react.dev/errors/31?args[]=object%20with%20keys%20%7B%7D for the full message.'

describe('parseReactMinifiedError', () => {
  it('parses React error #31 with args', () => {
    const parsed = parseReactMinifiedError(SAMPLE_31)
    expect(parsed?.code).toBe(31)
    expect(parsed?.args).toEqual(['object with keys {}'])
    expect(parsed?.summary).toMatch(/Objects are not valid as a React child/)
  })

  it('returns null for unrelated messages', () => {
    expect(parseReactMinifiedError('Network request failed')).toBeNull()
  })
})

describe('formatReactMinifiedErrorDetails', () => {
  it('includes expanded guidance for error #31', () => {
    const text = formatReactMinifiedErrorDetails(SAMPLE_31)
    expect(text).toMatch(/React error #31/)
    expect(text).toMatch(/object with keys \{\}/)
    expect(text).toMatch(/Monday Meeting/)
  })
})
