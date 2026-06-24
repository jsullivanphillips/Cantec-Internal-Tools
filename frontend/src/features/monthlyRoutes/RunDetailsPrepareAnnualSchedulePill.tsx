import type { AnnualScheduleCheckLocation } from './monthlyRoutesShared'
import { prepAnnualScheduleWarningLabel } from './prepAnnualSchedule'

export default function RunDetailsPrepareAnnualSchedulePill({
  schedule,
  annualTestOverride = false,
}: {
  schedule: AnnualScheduleCheckLocation | null | undefined
  annualTestOverride?: boolean
}) {
  const warning = schedule?.prep_warning ?? null
  const warningLabel = prepAnnualScheduleWarningLabel(warning)
  const showOverridePill = annualTestOverride

  if (!warningLabel && !showOverridePill) return null

  const serviceTradeUrl = schedule?.service_trade_site_location_url ?? null
  const showServiceTradeButton =
    warning !== 'no_servicetrade_link' && Boolean(serviceTradeUrl)

  return (
    <div className="run-details-prepare-annual-schedule mt-1">
      {showOverridePill ? (
        <span className="badge run-details-prepare-annual-schedule__pill run-details-prepare-annual-schedule__pill--override">
          Annual overridden
        </span>
      ) : null}
      {warningLabel ? (
        <span className="badge run-details-prepare-annual-schedule__pill">{warningLabel}</span>
      ) : null}
      {showServiceTradeButton ? (
        <a
          className="badge run-details-prepare-annual-schedule__pill run-details-prepare-annual-schedule__pill--servicetrade"
          href={serviceTradeUrl!}
          target="_blank"
          rel="noopener noreferrer"
        >
          ServiceTrade
        </a>
      ) : null}
    </div>
  )
}
