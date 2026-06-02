import type { MonthlyRunDetailDeficiencySummary } from './monthlyRoutesShared'

export function deficiencySeverityVariant(severity: string | null | undefined): string {
  const s = (severity || '').trim().toLowerCase()
  if (s === 'inoperable') return 'danger'
  if (s === 'deficient') return 'warning'
  if (s === 'suggested') return 'info'
  return 'secondary'
}

export function deficiencyStatusVariant(status: string | null | undefined): string {
  const s = (status || '').trim().toLowerCase()
  if (s === 'new') return 'danger'
  if (s === 'verified') return 'warning'
  if (s === 'fixed') return 'success'
  return 'secondary'
}

export function deficiencySeverityLabel(severity: string | null | undefined): string {
  const s = (severity || '').trim().toLowerCase()
  if (s === 'inoperable') return 'Inoperable'
  if (s === 'deficient') return 'Deficient'
  if (s === 'suggested') return 'Suggested'
  return (severity || '—').replace(/^\w/, (c) => c.toUpperCase())
}

export function deficiencyStatusLabel(status: string | null | undefined): string {
  const s = (status || '').trim().toLowerCase()
  if (s === 'new') return 'New'
  if (s === 'verified') return 'Verified'
  if (s === 'invalid') return 'Invalid'
  if (s === 'fixed') return 'Fixed'
  return (status || '—').replace(/^\w/, (c) => c.toUpperCase())
}

export function formatDeficiencyTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

export function deficiencyCardPreview(def: MonthlyRunDetailDeficiencySummary): string | null {
  const text = (def.description || '').trim()
  if (!text) return null
  const oneLine = text.replace(/\s+/g, ' ')
  return oneLine.length > 72 ? `${oneLine.slice(0, 69)}…` : oneLine
}

const OPEN_DEFICIENCY_STATUSES = new Set(['new', 'verified'])

/** Active deficiencies shown on run review cards (new + verified). */
export function openDeficiencySummaries(
  deficiencies: MonthlyRunDetailDeficiencySummary[] | null | undefined,
): MonthlyRunDetailDeficiencySummary[] {
  return (deficiencies ?? []).filter((def) =>
    OPEN_DEFICIENCY_STATUSES.has((def.status || '').trim().toLowerCase()),
  )
}
