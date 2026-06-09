import type { TechnicianWorksheetStop } from './monthlyRoutesShared'
import { stopHasMonitoring, stopMonitoringDisplay } from './stopMonitoringDisplay'
import PortalBootstrapIcon from './PortalBootstrapIcon'

type PortalStopSummaryDetailProps = {
  stop: TechnicianWorksheetStop
  /** Worksheet header: third group with panel make/model and location. */
  includePanel?: boolean
  className?: string
}

/** Key, ring, monitoring (and optional panel) — same line layout as expanded portal side nav. */
export default function PortalStopSummaryDetail({
  stop,
  includePanel = false,
  className,
}: PortalStopSummaryDetailProps) {
  const ring = (stop.ring || '—').trim()
  const key = (stop.key_number || '—').trim()
  const monitoring = stopMonitoringDisplay(stop)
  const showMonitoring = stopHasMonitoring(stop) || monitoring.phones.length > 0
  const panelMakeModel = (stop.panel || '—').trim() || '—'
  const panelLocation = (stop.panel_location || '—').trim() || '—'

  return (
    <div className={['pw-mock-nav-stop-detail', className].filter(Boolean).join(' ')}>
      <span className="pw-mock-nav-stop-group">
        <span className="pw-mock-nav-stop-line">
          <PortalBootstrapIcon name="key" className="pw-mock-nav-stop-icon" title="Key" />
          {key}
        </span>
        <span className="pw-mock-nav-stop-line">
          <PortalBootstrapIcon name="circle" className="pw-mock-nav-stop-icon" title="Ring" />
          {ring}
        </span>
      </span>
      {showMonitoring ? (
        <span className="pw-mock-nav-stop-group">
          {monitoring.company !== '—' ? (
            <span className="pw-mock-nav-stop-line">
              <PortalBootstrapIcon name="telephone" className="pw-mock-nav-stop-icon" title="Monitoring" />
              {monitoring.company}
            </span>
          ) : null}
          {monitoring.phones.map((phone) => (
            <span key={phone} className="pw-mock-nav-stop-line">
              {phone}
            </span>
          ))}
          {monitoring.account !== '—' ? (
            <span className="pw-mock-nav-stop-line">
              <span className="pw-mock-nav-stop-label">Acct</span>
              {monitoring.account}
            </span>
          ) : null}
          {showMonitoring ? (
            <span className="pw-mock-nav-stop-line">
              <span className="pw-mock-nav-stop-label">PW</span>
              {monitoring.password !== '—' ? monitoring.password : 'No Password'}
            </span>
          ) : null}
        </span>
      ) : null}
      {includePanel ? (
        <span className="pw-mock-nav-stop-group">
          <span className="pw-mock-nav-stop-line">
            <PortalBootstrapIcon name="cpu" className="pw-mock-nav-stop-icon" title="Panel" />
            {panelMakeModel}
          </span>
          <span className="pw-mock-nav-stop-line">
            <PortalBootstrapIcon name="pin-map" className="pw-mock-nav-stop-icon" title="Panel location" />
            {panelLocation}
          </span>
        </span>
      ) : null}
    </div>
  )
}
