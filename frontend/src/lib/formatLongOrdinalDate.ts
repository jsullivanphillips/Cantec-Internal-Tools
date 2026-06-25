function englishOrdinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

/** e.g. October 1st, 2026 */
export function formatLongOrdinalDate(value: string | null | undefined): string {
  const raw = value?.trim()
  if (!raw) return '—'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(date)
  return `${monthLabel} ${englishOrdinal(date.getDate())}, ${date.getFullYear()}`
}

/** e.g. October 1st, 2026 at 10:42 AM */
export function formatLongOrdinalDateTime(value: string | null | undefined): string {
  const raw = value?.trim()
  if (!raw) return '—'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const timeLabel = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
  return `${formatLongOrdinalDate(raw)} at ${timeLabel}`
}
