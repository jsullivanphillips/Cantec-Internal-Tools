import {
  changedLineDiffParts,
  computeLineDiff,
  groupLineDiffParts,
  lineDiffAriaSummary,
  type LineDiffGroup,
} from './textLineDiff'

function LineDiffBlock({ group }: { group: LineDiffGroup }) {
  const isAdd = group.type === 'add'
  const displayText = group.text.length > 0 ? group.text : '\u00a0'
  if (isAdd) {
    return (
      <div className="run-detail-change__row run-detail-change__row--added">
        <span className="run-detail-change__tag run-detail-change__tag--add">Added</span>
        <span className="run-detail-change__value run-detail-change__value--new">{displayText}</span>
      </div>
    )
  }
  return (
    <div className="run-detail-change__line-block run-detail-change__line-block--remove">
      <div className="run-detail-change__row run-detail-change__row--removed">
        <span className="run-detail-change__tag run-detail-change__tag--remove">Removed</span>
        <span className="run-detail-change__value run-detail-change__value--old">{displayText}</span>
      </div>
    </div>
  )
}

export default function FieldChangeLineDiff({
  label,
  before,
  after,
}: {
  label: string
  before: string
  after: string
}) {
  const groups = groupLineDiffParts(changedLineDiffParts(computeLineDiff(before, after)))
  if (groups.length === 0) return null

  return (
    <div className="run-detail-change" aria-label={lineDiffAriaSummary(label, groups)}>
      <div className="run-detail-change__label">{label}</div>
      <div className="run-detail-change__line-diff">
        {groups.map((group, index) => (
          <LineDiffBlock key={`${group.type}:${index}`} group={group} />
        ))}
      </div>
    </div>
  )
}
