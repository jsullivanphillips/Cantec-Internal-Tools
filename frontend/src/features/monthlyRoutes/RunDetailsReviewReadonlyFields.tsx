import { worksheetReadOnlyDisplay } from './officeWorksheetTableShared'
import type { MonthlyRunDetailLocationStop } from './monthlyRoutesShared'
import { stopHasNewCommentField, type RunDetailNewCommentField } from './runDetailsLocationReview'

export function ReviewReadonlyDisplay({
  value,
  multiline,
  highlightNew,
}: {
  value: string | null | undefined
  multiline?: boolean
  highlightNew?: boolean
}) {
  const display = worksheetReadOnlyDisplay(value)
  const empty = display === '—'
  return (
    <span
      className={[
        'run-details-prepare-display',
        multiline ? 'run-details-prepare-display--multiline' : '',
        empty ? 'run-details-prepare-display--empty' : '',
        highlightNew && !empty ? 'run-details-review-comment--new' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {display}
    </span>
  )
}

export function ReviewReadonlyStackField({
  label,
  value,
  multiline,
}: {
  label: string
  value: string | null | undefined
  /** Use for long text (e.g. monitoring notes) so values wrap inside the column. */
  multiline?: boolean
}) {
  return (
    <div className="run-details-prepare-stack__field">
      <div className="run-details-prepare-stack__label">{label}</div>
      <div className="run-details-prepare-stack__value">
        <ReviewReadonlyDisplay value={value} multiline={multiline} />
      </div>
    </div>
  )
}

export function ReviewReadonlyCommentCell({
  stop,
  field,
  value,
}: {
  stop: MonthlyRunDetailLocationStop
  field: RunDetailNewCommentField
  value: string | null | undefined
}) {
  return (
    <ReviewReadonlyDisplay
      value={value}
      multiline
      highlightNew={stopHasNewCommentField(stop, field)}
    />
  )
}
