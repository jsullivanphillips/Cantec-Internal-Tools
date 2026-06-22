import { describe, expect, it } from 'vitest'

import { comparisonHeadline, comparisonTone, formatFieldDuration } from './portalRunSummary'

describe('formatFieldDuration', () => {
  it('formats hours and minutes', () => {
    expect(formatFieldDuration(420)).toBe('7 hr')
    expect(formatFieldDuration(465)).toBe('7 hr 45 min')
    expect(formatFieldDuration(45)).toBe('45 min')
  })
})

describe('comparisonHeadline', () => {
  it('describes early field duration', () => {
    expect(
      comparisonHeadline(
        { delta_minutes: -18, direction: 'early', months_sampled: 8 },
        'field_duration',
      ),
    ).toBe('18 min faster than usual for this route')
  })

  it('describes on-time finish', () => {
    expect(
      comparisonHeadline(
        { delta_minutes: 2, direction: 'on_time', months_sampled: 8 },
        'finish_time',
      ),
    ).toBe('Finished around the usual time for this route')
  })
})

describe('comparisonTone', () => {
  it('maps direction to tone', () => {
    expect(comparisonTone('early')).toBe('positive')
    expect(comparisonTone('late')).toBe('negative')
    expect(comparisonTone('on_time')).toBe('neutral')
  })
})
