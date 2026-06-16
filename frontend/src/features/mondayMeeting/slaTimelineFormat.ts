/** ISO calendar date (YYYY-MM-DD) → e.g. "June 5, 2026" */
export function formatSlaTimelineDate(value: string | null | undefined): string {
  if (!value?.trim()) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return value
  const [, year, month, day] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}
