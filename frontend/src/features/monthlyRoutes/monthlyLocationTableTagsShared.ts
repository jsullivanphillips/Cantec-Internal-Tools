/** How many tag pills fit in a row before showing overflow ellipsis. */
export function countFittingMonthlyLocationTags(
  pillWidths: readonly number[],
  containerWidth: number,
  gap: number,
  ellipsisWidth: number,
): number {
  if (pillWidths.length === 0 || containerWidth <= 0) {
    return 0
  }

  let used = 0
  let count = 0

  for (let index = 0; index < pillWidths.length; index += 1) {
    const pillWidth = pillWidths[index]
    const gapBefore = count > 0 ? gap : 0
    const remainingAfter = pillWidths.length - (count + 1)
    const reserveEllipsis = remainingAfter > 0 ? gap + ellipsisWidth : 0

    if (used + gapBefore + pillWidth + reserveEllipsis > containerWidth) {
      break
    }

    used += gapBefore + pillWidth
    count += 1
  }

  return count
}

export function normalizeMonthlyLocationTableTags(tags: string[] | null | undefined): string[] {
  if (!tags?.length) {
    return []
  }
  return tags
    .map((tag) => {
      if (typeof tag === 'string') return tag.trim()
      if (tag == null) return ''
      if (typeof tag === 'number' || typeof tag === 'boolean') return String(tag)
      return ''
    })
    .filter(Boolean)
}
