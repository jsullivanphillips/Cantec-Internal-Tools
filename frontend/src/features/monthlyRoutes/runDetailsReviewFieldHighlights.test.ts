import { describe, expect, it } from 'vitest'
import {
  reviewFieldChangeDisplayText,
  reviewFieldChangeHighlightsRed,
} from './RunDetailsReviewReadonlyFields'
import { notableChangesFromFieldChanges } from './notableStopChanges'

describe('run review field change highlights', () => {
  it('highlights a changed key in red', () => {
    const changes = notableChangesFromFieldChanges([
      { field_name: 'key_number', old_value: 'A1', new_value: 'B2' },
    ])
    const keyChange = changes.find((c) => c.label === 'Key #')
    expect(reviewFieldChangeHighlightsRed(keyChange)).toBe(true)
    expect(reviewFieldChangeDisplayText('B2', keyChange)).toBe('B2')
  })

  it('does not highlight removed key values', () => {
    const changes = notableChangesFromFieldChanges([
      { field_name: 'key_number', old_value: 'A1', new_value: '' },
    ])
    const keyChange = changes.find((c) => c.label === 'Key #')
    expect(reviewFieldChangeHighlightsRed(keyChange)).toBe(false)
  })

  it('shows only appended comment lines for highlight text', () => {
    const changes = notableChangesFromFieldChanges([
      {
        field_name: 'inspection_tech_notes',
        old_value: 'Existing note',
        new_value: 'Existing note\nNew line',
      },
    ])
    const commentChange = changes.find((c) => c.label === 'Location comments')
    expect(reviewFieldChangeHighlightsRed(commentChange)).toBe(true)
    expect(reviewFieldChangeDisplayText('Existing note\nNew line', commentChange)).toBe(
      'Existing note\nNew line',
    )
  })

  it('does not highlight deleted comment text', () => {
    const changes = notableChangesFromFieldChanges([
      {
        field_name: 'inspection_tech_notes',
        old_value: 'Old office note',
        new_value: '',
      },
    ])
    const commentChange = changes.find((c) => c.label === 'Location comments')
    expect(reviewFieldChangeHighlightsRed(commentChange)).toBe(false)
  })
})
