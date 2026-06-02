import type { NotableChangeItem } from './notableStopChanges'
import {
  displayValueForSide,
  type FieldChangeDisplaySide,
  type FieldChangePrepColumnId,
} from './fieldChangePrepLayout'

function ReadonlyField({
  label,
  value,
  multiline,
  muted,
}: {
  label: string
  value: string
  multiline?: boolean
  muted?: boolean
}) {
  const empty = value === '—'
  return (
    <div className="run-details-prepare-stack__field">
      <div className="run-details-prepare-stack__label">{label}</div>
      <div className="run-details-prepare-stack__value">
        <span
          className={[
            'run-details-prepare-display',
            multiline ? 'run-details-prepare-display--multiline' : '',
            empty ? 'run-details-prepare-display--empty' : '',
            muted ? 'run-details-field-change-value--muted' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {value}
        </span>
      </div>
    </div>
  )
}

const LONG_TEXT_COLUMNS = new Set<FieldChangePrepColumnId>([
  'run_comments',
  'procedures',
  'location_comments',
])

export default function RunDetailsFieldChangePrepCell({
  items,
  side,
  columnId,
}: {
  items: NotableChangeItem[] | undefined
  side: FieldChangeDisplaySide
  columnId: FieldChangePrepColumnId
}) {
  if (!items?.length) {
    return <span className="run-details-prepare-display run-details-prepare-display--empty">—</span>
  }

  const multiline = LONG_TEXT_COLUMNS.has(columnId)

  return (
    <div className="run-details-prepare-stack">
      {items.map((item) => (
        <ReadonlyField
          key={item.id}
          label={item.label}
          value={displayValueForSide(item, side)}
          multiline={multiline}
          muted={side === 'before' && item.kind === 'field_removed'}
        />
      ))}
    </div>
  )
}
