import { Button } from 'react-bootstrap'

import type { AnnualScheduleCheckLocation } from './monthlyRoutesShared'
import { prepAnnualScheduleWarningLabel } from './prepAnnualSchedule'

export default function RunDetailsPrepareAnnualSchedulePill({
  schedule,
}: {
  schedule: AnnualScheduleCheckLocation | null | undefined
}) {
  const warning = schedule?.prep_warning ?? null
  const label = prepAnnualScheduleWarningLabel(warning)
  if (!label) return null

  const serviceTradeUrl = schedule?.service_trade_site_location_url ?? null
  const showServiceTradeButton =
    warning !== 'no_servicetrade_link' && Boolean(serviceTradeUrl)

  return (
    <div className="run-details-prepare-annual-schedule mt-1">
      <span className="badge run-details-prepare-annual-schedule__pill">{label}</span>
      {showServiceTradeButton ? (
        <Button
          size="sm"
          variant="outline-secondary"
          className="run-details-prepare-annual-schedule__link ms-1"
          href={serviceTradeUrl!}
          target="_blank"
          rel="noopener noreferrer"
        >
          ServiceTrade
        </Button>
      ) : null}
    </div>
  )
}
