import { describe, expect, it } from 'vitest'
import type { NotableChangeItem } from './notableStopChanges'
import {
  displayValueForSide,
  fieldChangeLabelToPrepColumn,
  groupChangesByPrepColumn,
} from './fieldChangePrepLayout'

function item(
  overrides: Partial<NotableChangeItem> & Pick<NotableChangeItem, 'label'>,
): NotableChangeItem {
  return {
    id: overrides.id ?? `field:${overrides.label}`,
    kind: overrides.kind ?? 'field',
    label: overrides.label,
    before: overrides.before ?? 'old',
    after: overrides.after ?? 'new',
  }
}

describe('fieldChangeLabelToPrepColumn', () => {
  it('maps access fields including panel under access', () => {
    expect(fieldChangeLabelToPrepColumn('Ring')).toBe('access')
    expect(fieldChangeLabelToPrepColumn('Panel')).toBe('access')
    expect(fieldChangeLabelToPrepColumn('Panel location')).toBe('access')
  })

  it('maps address and monitoring labels', () => {
    expect(fieldChangeLabelToPrepColumn('Building')).toBe('address')
    expect(fieldChangeLabelToPrepColumn('Company')).toBe('monitoring')
  })
})

describe('groupChangesByPrepColumn', () => {
  it('groups multiple labels into the same column', () => {
    const grouped = groupChangesByPrepColumn([
      item({ label: 'Ring', before: 'A', after: 'B' }),
      item({ label: 'Panel', id: 'field:Panel', before: 'P1', after: 'P2' }),
      item({ label: 'Building', id: 'field:Building', before: 'B1', after: 'B2' }),
    ])
    expect(grouped.access?.map((c) => c.label)).toEqual(['Ring', 'Panel'])
    expect(grouped.address?.map((c) => c.label)).toEqual(['Building'])
  })
})

describe('displayValueForSide', () => {
  it('shows em dash for added fields on before side', () => {
    expect(
      displayValueForSide(
        item({ label: 'Ring', kind: 'field_added', before: null, after: 'New ring' }),
        'before',
      ),
    ).toBe('—')
  })

  it('shows em dash for removed fields on after side', () => {
    expect(
      displayValueForSide(
        item({ label: 'Key #', kind: 'field_removed', before: '123', after: '—' }),
        'after',
      ),
    ).toBe('—')
  })

  it('returns before and after values for normal edits', () => {
    const change = item({ label: 'Door code', before: '1111', after: '2222' })
    expect(displayValueForSide(change, 'before')).toBe('1111')
    expect(displayValueForSide(change, 'after')).toBe('2222')
  })
})
