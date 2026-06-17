import { OverlayTrigger, Tooltip } from 'react-bootstrap'
import { allTimeRangeTooltipText } from './mondayMeetingServiceDateRange'

export default function ServiceQuarterAllTimeInfo({
  startDate,
  endDate,
}: {
  startDate: string
  endDate: string
}) {
  return (
    <OverlayTrigger
      placement="top"
      trigger={['hover', 'focus']}
      overlay={
        <Tooltip id="monday-meeting-all-time-range" className="monday-meeting-sla-info-tooltip">
          {allTimeRangeTooltipText({ startDate, endDate })}
        </Tooltip>
      }
    >
      <button
        type="button"
        className="monday-meeting-sla-info-btn"
        aria-label="About all time date range"
      >
        <i className="bi bi-info-circle" aria-hidden />
      </button>
    </OverlayTrigger>
  )
}
