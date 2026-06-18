import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  countFittingMonthlyLocationTags,
  normalizeMonthlyLocationTableTags,
} from './monthlyLocationTableTagsShared'

type MonthlyLocationTableTagsCellProps = {
  tags?: string[] | null
}

function MonthlyLocationTagPill({ tag }: { tag: string }) {
  return (
    <span className="monthly-location-tag-pill" data-tag-pill>
      {tag}
    </span>
  )
}

export default function MonthlyLocationTableTagsCell({ tags }: MonthlyLocationTableTagsCellProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const normalizedTags = useMemo(() => normalizeMonthlyLocationTableTags(tags), [tags])
  const [visibleCount, setVisibleCount] = useState(normalizedTags.length)

  useLayoutEffect(() => {
    setVisibleCount(normalizedTags.length)
  }, [normalizedTags])

  useLayoutEffect(() => {
    const container = containerRef.current
    const measure = measureRef.current
    if (!container || !measure) {
      return undefined
    }

    const updateVisibleCount = () => {
      if (normalizedTags.length === 0) {
        setVisibleCount(0)
        return
      }

      const containerWidth = container.clientWidth
      if (containerWidth <= 0) {
        return
      }

      const pillNodes = Array.from(measure.querySelectorAll<HTMLElement>('[data-tag-pill]'))
      const ellipsisNode = measure.querySelector<HTMLElement>('[data-tag-ellipsis]')
      const gap = Number.parseFloat(getComputedStyle(measure).columnGap || getComputedStyle(measure).gap) || 0
      const ellipsisWidth = ellipsisNode?.offsetWidth ?? 0
      const pillWidths = pillNodes.map((node) => node.offsetWidth)

      setVisibleCount(
        countFittingMonthlyLocationTags(pillWidths, containerWidth, gap, ellipsisWidth),
      )
    }

    updateVisibleCount()

    const resizeObserver = new ResizeObserver(updateVisibleCount)
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
    }
  }, [normalizedTags])

  if (normalizedTags.length === 0) {
    return <span className="text-muted">—</span>
  }

  const hasOverflow = visibleCount < normalizedTags.length
  const title = normalizedTags.join(', ')

  return (
    <div
      ref={containerRef}
      className="monthly-locations-table__tags"
      title={hasOverflow || visibleCount === 0 ? title : undefined}
    >
      <div ref={measureRef} className="monthly-locations-table__tags-measure" aria-hidden="true">
        {normalizedTags.map((tag) => (
          <MonthlyLocationTagPill key={tag} tag={tag} />
        ))}
        <span className="monthly-locations-table__tag-ellipsis" data-tag-ellipsis>
          ...
        </span>
      </div>
      <div className="monthly-locations-table__tags-visible">
        {normalizedTags.slice(0, visibleCount).map((tag) => (
          <MonthlyLocationTagPill key={tag} tag={tag} />
        ))}
        {hasOverflow || visibleCount === 0 ? (
          <span className="monthly-locations-table__tag-ellipsis" aria-hidden={visibleCount > 0}>
            ...
          </span>
        ) : null}
      </div>
    </div>
  )
}
