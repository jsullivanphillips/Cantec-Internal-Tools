import type { TechnicianWorksheetStop } from './monthlyRoutesShared'

type Props = {
  stop: TechnicianWorksheetStop
}

export default function PortalClockEventsCard({ stop }: Props) {
  const events = stop.clock_events ?? []
  if (events.length === 0) return null

  return (
    <div className="pw-mock-field-group pw-portal-clock-card">
      <div className="pw-mock-field-group-title">Clock events</div>
      <ul className="list-unstyled mb-0 pw-portal-clock-list">
        {events.map((ev) => (
          <li key={ev.id} className="pw-portal-clock-row">
            <span className="pw-portal-clock-in">{ev.time_in}</span>
            <span className="text-muted mx-1">→</span>
            <span className={ev.time_out ? '' : 'text-primary fw-semibold'}>
              {ev.time_out?.trim() ? ev.time_out : 'Open'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
