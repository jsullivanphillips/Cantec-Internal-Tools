import FieldChangeLineDiff from './FieldChangeLineDiff'
import type { NotableChangeItem } from './notableStopChanges'
import { lineDiffDisplayMode } from './textLineDiff'

function isAddedKind(item: NotableChangeItem): boolean {
  return item.kind === 'field_added' || item.kind === 'comment_added'
}

function changeAriaLabel(item: NotableChangeItem): string {
  if (isAddedKind(item)) {
    return `${item.label} added: ${item.after}`
  }
  if (item.kind === 'field_removed') {
    return `${item.label} removed: was ${item.before}`
  }
  if (item.before == null) {
    return `${item.label}: ${item.after}`
  }
  return `${item.label} changed from ${item.before} to ${item.after}`
}

export default function FieldChangeBeforeAfter({ item }: { item: NotableChangeItem }) {
  const showBefore = item.kind === 'field' && item.before != null

  if (item.kind === 'field_removed' && item.before != null) {
    return (
      <div className="run-detail-change" aria-label={changeAriaLabel(item)}>
        <div className="run-detail-change__label">{item.label}</div>
        <div className="run-detail-change__row run-detail-change__row--removed">
          <span className="run-detail-change__tag run-detail-change__tag--remove">Removed</span>
          <span className="run-detail-change__value run-detail-change__value--old">{item.before}</span>
        </div>
      </div>
    )
  }

  if (isAddedKind(item)) {
    return (
      <div className="run-detail-change" aria-label={changeAriaLabel(item)}>
        <div className="run-detail-change__label">{item.label}</div>
        <div className="run-detail-change__row run-detail-change__row--added">
          <span className="run-detail-change__tag run-detail-change__tag--add">Added</span>
          <span className="run-detail-change__value run-detail-change__value--new">{item.after}</span>
        </div>
      </div>
    )
  }

  if (!showBefore) {
    return (
      <div className="run-detail-change" aria-label={changeAriaLabel(item)}>
        <div className="run-detail-change__label">{item.label}</div>
        <div className="run-detail-change__value run-detail-change__value--new">{item.after}</div>
      </div>
    )
  }

  if (
    item.before != null &&
    lineDiffDisplayMode(item.label, item.before, item.after) === 'lines'
  ) {
    return <FieldChangeLineDiff label={item.label} before={item.before} after={item.after} />
  }

  return (
    <div className="run-detail-change" aria-label={changeAriaLabel(item)}>
      <div className="run-detail-change__label">{item.label}</div>
      <div className="run-detail-change__diff">
        <div className="run-detail-change__pair">
          <span className="run-detail-change__pair-label">Before</span>
          <span className="run-detail-change__value run-detail-change__value--old">{item.before}</span>
        </div>
        <div className="run-detail-change__pair">
          <span className="run-detail-change__pair-label">After</span>
          <span className="run-detail-change__value run-detail-change__value--new">{item.after}</span>
        </div>
      </div>
    </div>
  )
}
