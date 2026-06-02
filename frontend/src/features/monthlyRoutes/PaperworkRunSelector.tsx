import { Form } from 'react-bootstrap'
import { parseYearMonth } from './monthlyRoutesShared'
import { routeMonthRunStatusLabel } from './runWorkflowShared'
import type { SelectablePaperworkMonth } from './paperworkViewMode'

function formatMonthLabel(monthIso: string): string {
  const ym = parseYearMonth(monthIso)
  if (!ym) return monthIso
  return new Intl.DateTimeFormat('en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(ym.year, ym.month - 1, 1)))
}

export default function PaperworkRunSelector({
  months,
  selectedMonthIso,
  currentMonthIso,
  onChange,
}: {
  months: SelectablePaperworkMonth[]
  selectedMonthIso: string
  currentMonthIso: string
  onChange: (monthIso: string) => void
}) {
  if (months.length <= 1) {
    return (
      <div className="paperwork-run-selector paperwork-run-selector--single">
        <span className="paperwork-run-selector__label text-muted small">Run month</span>
        <span className="paperwork-run-selector__value fw-semibold">{formatMonthLabel(selectedMonthIso)}</span>
      </div>
    )
  }

  return (
    <div className="paperwork-run-selector">
      <Form.Label htmlFor="paperwork-run-month" className="paperwork-run-selector__label mb-0">
        Run month
      </Form.Label>
      <Form.Select
        id="paperwork-run-month"
        size="sm"
        className="paperwork-run-selector__select"
        value={selectedMonthIso}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Select run month"
      >
        {months.map(({ monthIso, runSummary }) => {
          const statusLabel = runSummary
            ? routeMonthRunStatusLabel(runSummary, false)
            : monthIso === currentMonthIso
              ? 'Current month'
              : 'Next month'
          const suffix =
            monthIso === currentMonthIso ? ' (current)' : monthIso > currentMonthIso ? ' (next)' : ''
          return (
            <option key={monthIso} value={monthIso}>
              {formatMonthLabel(monthIso)}
              {suffix}
              {runSummary ? ` — ${statusLabel}` : ''}
            </option>
          )
        })}
      </Form.Select>
    </div>
  )
}
