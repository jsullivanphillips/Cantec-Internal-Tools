import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'

type Props = {
  stop: TechnicianWorksheetLocation
}

export default function PortalClockEventsCard({ stop }: Props) {
  const events = stop.clock_events ?? []
  if (events.length === 0) return null

  return (
    <div className="pw-mock-field-group pw-portal-clock-card">
      <div className="pw-mock-field-group-title">Clock events</div>
      <div className="pw-portal-section-body">
        <ul className="list-unstyled mb-0 pw-portal-clock-list">
          {events.map((ev) => (
            <li key={ev.id} className="pw-portal-clock-row">
              <span className="pw-portal-clock-in">{ev.time_in}</span>
              <span className="pw-portal-clock-arrow" aria-hidden>
                →
              </span>
              <span
                className={
                  ev.time_out?.trim() ? 'pw-portal-clock-out' : 'pw-portal-clock-out pw-portal-clock-out--open'
                }
              >
                {ev.time_out?.trim() ? ev.time_out : 'Open'}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
