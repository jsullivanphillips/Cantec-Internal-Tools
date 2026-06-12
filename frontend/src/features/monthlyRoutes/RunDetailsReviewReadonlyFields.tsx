import { worksheetReadOnlyDisplay } from './officeWorksheetTableShared'
import RichTextDisplay from '../richText/RichTextDisplay'

export function ReviewReadonlyDisplay({
  value,
  multiline,
}: {
  value: string | null | undefined
  multiline?: boolean
}) {
  const display = worksheetReadOnlyDisplay(value)
  const empty = display === '—'
  const className = [
    'run-details-prepare-display',
    multiline ? 'run-details-prepare-display--multiline' : '',
    empty ? 'run-details-prepare-display--empty' : '',
  ]
    .filter(Boolean)
    .join(' ')

  if (empty) {
    return <span className={className}>{display}</span>
  }

  return (
    <RichTextDisplay
      value={value}
      className={className}
      emptyPlaceholder={display}
    />
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
  value,
}: {
  stop?: unknown
  field?: 'run_comments' | 'testing_procedures' | 'inspection_tech_notes'
  value: string | null | undefined
}) {
  return <ReviewReadonlyDisplay value={value} multiline />
}
