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
  return (
    <div
      className={`run-detail-change__line-block run-detail-change__line-block--${group.type}`}
    >
      <span className="run-detail-change__line-block-tag">{isAdd ? 'Added' : 'Removed'}</span>
      <span
        className={`run-detail-change__line-block-text${isAdd ? '' : ' run-detail-change__value--old'}`}
      >
        {displayText}
      </span>
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
