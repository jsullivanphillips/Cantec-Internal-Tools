type MonthlyDashboardKpiStripProps = {
  routesToProcess: number
  routesToPrepare: number
  openTicketCount: number
}

type KpiItemProps = {
  label: string
  value: number
  hint: string
  tone: 'process' | 'prepare' | 'tickets'
}

function KpiItem({ label, value, hint, tone }: KpiItemProps) {
  return (
    <div
      className={`monthly-dashboard-kpi monthly-dashboard-kpi--${tone}${value > 0 ? ' monthly-dashboard-kpi--active' : ''}`}
      title={hint}
    >
      <div className="monthly-dashboard-kpi__text">
        <span className="monthly-dashboard-kpi__label">{label}</span>
        <span className="monthly-dashboard-kpi__hint">{hint}</span>
      </div>
      <span className="monthly-dashboard-kpi__value tabular-nums" aria-label={`${label}: ${value}`}>
        {value}
      </span>
    </div>
  )
}

export default function MonthlyDashboardKpiStrip({
  routesToProcess,
  routesToPrepare,
  openTicketCount,
}: MonthlyDashboardKpiStripProps) {
  return (
    <div className="monthly-dashboard-kpi-strip" role="group" aria-label="Monthlies summary">
      <KpiItem
        tone="process"
        label="To process"
        value={routesToProcess}
        hint="Field ended, awaiting office review"
      />
      <KpiItem
        tone="prepare"
        label="To prepare"
        value={routesToPrepare}
        hint="Scheduled this month, not yet prepared"
      />
      <KpiItem
        tone="tickets"
        label="Open tickets"
        value={openTicketCount}
        hint="Open and in progress"
      />
    </div>
  )
}
