import { Card } from 'react-bootstrap'
import { coerceUiText } from '../../lib/apiClient'
import type { TechnicianTopKpi } from './useTechnicianTopKpis'

function TopTechnicianKpiCard({
  label,
  leader,
  countLabel,
}: Omit<TechnicianTopKpi, 'key'>) {
  return (
    <Card className="app-kpi-nested technician-meeting-kpi-card h-100">
      <Card.Body className="technician-meeting-kpi-card__body">
        <div className="processing-kpi-label">{label}</div>
        <div className="technician-meeting-kpi-card__value" title={leader ? coerceUiText(leader.technician, '') : undefined}>
          {leader ? coerceUiText(leader.technician, '—') : '—'}
        </div>
        <div className="technician-meeting-kpi-card__meta">
          {leader ? `${leader.count.toLocaleString()} ${countLabel}` : 'No data for this range'}
        </div>
      </Card.Body>
    </Card>
  )
}

export default function TechnicianTopKpiRow({ kpis }: { kpis: TechnicianTopKpi[] }) {
  return (
    <section className="technician-meeting-kpi-row" aria-label="Top technicians">
      {kpis.map((kpi) => (
        <TopTechnicianKpiCard
          key={kpi.key}
          label={kpi.label}
          leader={kpi.leader}
          countLabel={kpi.countLabel}
        />
      ))}
    </section>
  )
}
