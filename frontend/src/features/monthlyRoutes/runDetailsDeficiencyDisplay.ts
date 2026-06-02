import type {
  MonthlyRunDetailDeficiencySummary,
  TechnicianWorksheetRun,
} from './monthlyRoutesShared'

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

function parseRunTimestamp(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

/** Reported on this run, or verified during this field visit (matches office run-details API). */
export function deficiencyOnRunForReview(
  def: MonthlyRunDetailDeficiencySummary,
  run: TechnicianWorksheetRun | null | undefined,
): boolean {
  if (!run?.started_at) return false
  const status = (def.status || '').trim().toLowerCase()
  if (!OPEN_DEFICIENCY_STATUSES.has(status)) return false
  const runId = run.id
  const createdRunId = def.created_run_id ?? null
  if (createdRunId === runId) return true
  if (status !== 'verified') return false
  const startedMs = parseRunTimestamp(run.started_at)
  const updatedMs = parseRunTimestamp(def.updated_at)
  if (startedMs == null || updatedMs == null || updatedMs < startedMs) return false
  const endedMs = parseRunTimestamp(run.field_ended_at)
  if (endedMs != null && updatedMs > endedMs) return false
  return true
}

/** Deficiencies column on run review (after field has started). */
export function runReviewDeficiencySummaries(
  deficiencies: MonthlyRunDetailDeficiencySummary[] | null | undefined,
  run: TechnicianWorksheetRun | null | undefined,
): MonthlyRunDetailDeficiencySummary[] {
  const open = openDeficiencySummaries(deficiencies)
  if (!run?.started_at) return open
  return open.filter((def) => deficiencyOnRunForReview(def, run))
}

/** Passed with problems + explicit no-deficiency confirm, and no active deficiencies on the stop. */
export function stopShowsNoDeficienciesConfirmedPill(
  stop: {
    test_outcome?: string | null
    confirmed_no_deficiencies?: boolean
  },
  activeDeficiencyCount = 0,
): boolean {
  if ((stop.test_outcome || '').trim().toLowerCase() !== 'passed_with_problems') return false
  if (!stop.confirmed_no_deficiencies) return false
  return activeDeficiencyCount === 0
}
