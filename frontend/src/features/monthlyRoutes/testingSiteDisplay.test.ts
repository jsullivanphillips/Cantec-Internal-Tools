import { describe, expect, it } from 'vitest'
import { locationPrimaryLabel, shortStreetAddress } from './locationDisplay'

describe('locationDisplay compat', () => {
  it('uses label as primary', () => {
    expect(locationPrimaryLabel({ label: 'Annex', display_address: '123 Main' })).toBe('Annex')
  })
  it('shortStreetAddress abbreviates', () => {
    expect(shortStreetAddress('800 Johnson Street')).toBe('800 Johnson St')
  })
})
