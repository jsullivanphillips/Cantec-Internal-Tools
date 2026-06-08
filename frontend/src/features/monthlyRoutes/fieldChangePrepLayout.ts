import type { NotableChangeItem } from './notableStopChanges'
import { isEmptyDisplayValue } from './notableStopChanges'

export type FieldChangePrepColumnId =
  | 'address'
  | 'access'
  | 'monitoring'
  | 'run_comments'
  | 'procedures'
  | 'location_comments'

const LABEL_TO_COLUMN: Record<string, FieldChangePrepColumnId> = {
  Building: 'address',
  PMC: 'address',
  Ring: 'access',
  'Key #': 'access',
  'Door code': 'access',
  Annual: 'access',
  Panel: 'access',
  'Panel location': 'access',
  Company: 'monitoring',
  'Account #': 'monitoring',
  Password: 'monitoring',
  Notes: 'monitoring',
  'Job comment': 'run_comments',
  'Testing procedures': 'procedures',
  'Location comments': 'location_comments',
}

export const FIELD_CHANGE_PREP_COLUMN_ORDER: readonly FieldChangePrepColumnId[] = [
  'address',
  'access',
  'monitoring',
  'run_comments',
  'procedures',
  'location_comments',
] as const

export function fieldChangeLabelToPrepColumn(label: string): FieldChangePrepColumnId | null {
  return LABEL_TO_COLUMN[label] ?? null
}

export type GroupedFieldChangesByColumn = Partial<
  Record<FieldChangePrepColumnId, NotableChangeItem[]>
>

export function groupChangesByPrepColumn(changes: NotableChangeItem[]): GroupedFieldChangesByColumn {
  const grouped: GroupedFieldChangesByColumn = {}
  for (const item of changes) {
    const column = fieldChangeLabelToPrepColumn(item.label)
    if (!column) continue
    const list = grouped[column] ?? []
    list.push(item)
    grouped[column] = list
  }
  return grouped
}

export type FieldChangeDisplaySide = 'before' | 'after'

export function displayValueForSide(
  item: NotableChangeItem,
  side: FieldChangeDisplaySide,
): string {
  if (side === 'before') {
    if (item.kind === 'field_added' || item.kind === 'comment_added') return '—'
    if (item.kind === 'field_removed' && item.before != null) return item.before
    if (item.before != null && !isEmptyDisplayValue(item.before)) return item.before
    return '—'
  }
  if (item.kind === 'field_removed') return '—'
  if (item.after != null && !isEmptyDisplayValue(item.after)) return item.after
  return '—'
}
