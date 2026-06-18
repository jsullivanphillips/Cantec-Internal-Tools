import { describe, expect, it } from 'vitest'
import { isChunkLoadError } from './chunkLoadError'

describe('isChunkLoadError', () => {
  it('detects failed dynamic import messages', () => {
    const error = new TypeError(
      'Failed to fetch dynamically imported module: https://example.com/assets/MondayMeetingPage-CRoaDnVA.js',
    )
    expect(isChunkLoadError(error)).toBe(true)
  })

  it('ignores unrelated errors', () => {
    expect(isChunkLoadError(new Error('Network request failed'))).toBe(false)
    expect(isChunkLoadError('something else')).toBe(false)
  })
})
