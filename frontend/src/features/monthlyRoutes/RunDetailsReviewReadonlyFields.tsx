import { worksheetReadOnlyDisplay } from './officeWorksheetTableShared'
import RichTextDisplay from '../richText/RichTextDisplay'
import { stripRichTextToPlain } from '../richText/richTextSanitize'
import type { MonthlyRunDetailLocation } from './monthlyRoutesShared'
import {
  isEmptyDisplayValue,
  notableChangesFromFieldChanges,
  type NotableChangeItem,
} from './notableStopChanges'
import { computeLineDiff, type LineDiffPart } from './textLineDiff'

/** Stack labels in run review map to audit display labels. */
const REVIEW_STACK_LABEL_TO_AUDIT: Record<string, string> = {
  Ring: 'Ring',
  Key: 'Key #',
  Door: 'Door code',
  'Annual month': 'Annual',
  Company: 'Company',
  'Account #': 'Account #',
  Password: 'Password',
  Notes: 'Notes',
}

const LONG_TEXT_AUDIT_LABELS = new Set<string>([
  'Job comment',
  'Testing procedures',
  'Location comments',
])

const LONG_TEXT_FIELD_TO_AUDIT: Record<string, string> = {
  run_comments: 'Job comment',
  testing_procedures: 'Testing procedures',
  inspection_tech_notes: 'Location comments',
}

function changeForAuditLabel(
  changes: NotableChangeItem[],
  auditLabel: string,
): NotableChangeItem | undefined {
  return changes.find((item) => item.label === auditLabel)
}

function scalarChangeShouldHighlight(item: NotableChangeItem | undefined): boolean {
  if (!item) return false
  if (item.kind === 'field_removed') return false
  return item.kind === 'field' || item.kind === 'field_added' || item.kind === 'comment_added'
}

function plainTextForDiff(value: string | null | undefined): string {
  return stripRichTextToPlain(value ?? '')
}

function longTextChangeShouldHighlight(item: NotableChangeItem | undefined): boolean {
  if (!item) return false
  if (item.kind === 'field_removed') return false
  if (item.kind === 'field_added' || item.kind === 'comment_added') return true
  if (item.kind !== 'field' || item.before == null) return false
  const parts = computeLineDiff(plainTextForDiff(item.before), plainTextForDiff(item.after))
  return parts.some((part) => part.type === 'add')
}

function longTextInlineParts(item: NotableChangeItem): LineDiffPart[] {
  if (item.kind === 'field_added' || item.kind === 'comment_added') {
    return [{ type: 'add', line: plainTextForDiff(item.after) }]
  }
  if (item.kind !== 'field' || item.before == null) {
    return [{ type: 'same', line: plainTextForDiff(item.after) }]
  }
  return computeLineDiff(plainTextForDiff(item.before), plainTextForDiff(item.after)).filter(
    (part) => part.type !== 'remove',
  )
}

function joinInlineDiffLines(parts: LineDiffPart[]): string {
  const lines: string[] = []
  for (const part of parts) {
    if (part.type === 'same') lines.push(part.line)
    else lines.push(part.line)
  }
  return lines.join('\n')
}

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
  const className = [
    'run-details-prepare-display',
    multiline ? 'run-details-prepare-display--multiline' : '',
    empty ? 'run-details-prepare-display--empty' : '',
    highlightNew && !empty ? 'run-details-review-comment--new' : '',
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

function ReviewReadonlyInlineLongText({
  item,
  fallbackValue,
}: {
  item: NotableChangeItem
  fallbackValue: string | null | undefined
}) {
  const parts = longTextInlineParts(item)
  const hasAdds = parts.some((part) => part.type === 'add')
  if (!hasAdds) {
    return <ReviewReadonlyDisplay value={fallbackValue} multiline />
  }

  if (parts.length === 1 && parts[0]?.type === 'add') {
    const text = parts[0].line
    if (!text.trim()) {
      return <ReviewReadonlyDisplay value={fallbackValue} multiline />
    }
    return (
      <span className="run-details-prepare-display run-details-prepare-display--multiline run-details-review-comment--new">
        {text}
      </span>
    )
  }

  return (
    <span className="run-details-prepare-display run-details-prepare-display--multiline">
      {parts.map((part, index) => {
        const text = part.line.length > 0 ? part.line : '\u00a0'
        const highlight = part.type === 'add'
        return (
          <span key={`${part.type}:${index}`}>
            {index > 0 ? '\n' : null}
            <span className={highlight ? 'run-details-review-comment--new' : undefined}>{text}</span>
          </span>
        )
      })}
    </span>
  )
}

function ReviewReadonlyChangedValue({
  value,
  change,
  multiline,
}: {
  value: string | null | undefined
  change: NotableChangeItem | undefined
  multiline?: boolean
}) {
  const display = worksheetReadOnlyDisplay(value)
  const empty = display === '—'
  const auditLabel = change?.label ?? ''
  const isLongText = LONG_TEXT_AUDIT_LABELS.has(auditLabel)

  if (isLongText && change && longTextChangeShouldHighlight(change)) {
    return <ReviewReadonlyInlineLongText item={change} fallbackValue={value} />
  }

  const highlight = scalarChangeShouldHighlight(change)
  if (highlight && change && !empty) {
    const shown = isLongText ? joinInlineDiffLines(longTextInlineParts(change)) : display
    if (!shown.trim() || shown === '—') {
      return <ReviewReadonlyDisplay value={value} multiline={multiline} />
    }
    return (
      <span
        className={[
          'run-details-prepare-display',
          multiline ? 'run-details-prepare-display--multiline' : '',
          'run-details-review-comment--new',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {shown}
      </span>
    )
  }

  return <ReviewReadonlyDisplay value={value} multiline={multiline} />
}

export function ReviewReadonlyStackField({
  label,
  value,
  multiline,
  changes,
}: {
  label: string
  value: string | null | undefined
  /** Use for long text (e.g. monitoring notes) so values wrap inside the column. */
  multiline?: boolean
  changes?: NotableChangeItem[]
}) {
  const auditLabel = REVIEW_STACK_LABEL_TO_AUDIT[label] ?? label
  const change = changes ? changeForAuditLabel(changes, auditLabel) : undefined
  return (
    <div className="run-details-prepare-stack__field">
      <div className="run-details-prepare-stack__label">{label}</div>
      <div className="run-details-prepare-stack__value">
        <ReviewReadonlyChangedValue value={value} change={change} multiline={multiline} />
      </div>
    </div>
  )
}

export function ReviewReadonlyCommentCell({
  stop,
  field,
  value,
}: {
  stop: MonthlyRunDetailLocation
  field: 'run_comments' | 'testing_procedures' | 'inspection_tech_notes'
  value: string | null | undefined
}) {
  const changes = notableChangesFromFieldChanges(stop.field_changes)
  const auditLabel = LONG_TEXT_FIELD_TO_AUDIT[field]
  const change = changeForAuditLabel(changes, auditLabel)
  return <ReviewReadonlyChangedValue value={value} change={change} multiline />
}

/** True when a field change should render red (for tests). */
export function reviewFieldChangeHighlightsRed(change: NotableChangeItem | undefined): boolean {
  if (!change) return false
  if (LONG_TEXT_AUDIT_LABELS.has(change.label)) {
    return longTextChangeShouldHighlight(change)
  }
  return scalarChangeShouldHighlight(change)
}

export function reviewFieldChangeDisplayText(
  value: string | null | undefined,
  change: NotableChangeItem | undefined,
): string {
  if (!reviewFieldChangeHighlightsRed(change) || !change) {
    return worksheetReadOnlyDisplay(value)
  }
  if (LONG_TEXT_AUDIT_LABELS.has(change.label)) {
    return joinInlineDiffLines(longTextInlineParts(change))
  }
  return worksheetReadOnlyDisplay(value)
}

export { isEmptyDisplayValue as reviewIsEmptyDisplayValue }