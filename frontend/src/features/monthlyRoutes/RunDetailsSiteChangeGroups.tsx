import { useId, useMemo } from 'react'
import FieldChangeBeforeAfter from './FieldChangeBeforeAfter'
import { groupNotableChanges, type NotableChangeItem } from './notableStopChanges'

export default function RunDetailsSiteChangeGroups({ changes }: { changes: NotableChangeItem[] }) {
  const baseId = useId()
  const groups = useMemo(() => groupNotableChanges(changes), [changes])

  if (groups.length === 0) return null

  return (
    <>
      {groups.map((group) => {
        const titleId = `${baseId}-${group.key}`
        return (
          <section
            key={group.key}
            className="run-detail-change-group"
            aria-labelledby={titleId}
          >
            <h4 id={titleId} className="run-detail-change-group__title">
              {group.title}
            </h4>
            <div className="run-detail-change-group__items">
              {group.items.map((item) => (
                <FieldChangeBeforeAfter key={item.id} item={item} />
              ))}
            </div>
          </section>
        )
      })}
    </>
  )
}
