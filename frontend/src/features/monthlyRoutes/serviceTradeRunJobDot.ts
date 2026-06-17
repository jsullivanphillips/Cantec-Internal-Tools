import type { ServiceTradeJobDot } from './monthlyDashboardShared'
import type { ServiceTradeRunJobMonth } from './monthlyRoutesShared'

export type ServiceTradeRunJobDotWithLabel = ServiceTradeJobDot & {
  label: string
}

const SYNC_NO_JOB = 'no_job'
const SYNC_NO_ST_LINK = 'no_st_link'
const SYNC_SCHEDULED = 'scheduled'

function noJobDot(): ServiceTradeRunJobDotWithLabel {
  return {
    color: 'red',
    tooltip: 'No ServiceTrade testing job for this month',
    label: 'No job',
  }
}

/** Same rules as ``dashboard_service_trade_job_dot`` on the backend. */
export function serviceTradeRunJobDot(
  hasStRouteLink: boolean,
  job: ServiceTradeRunJobMonth | null | undefined,
): ServiceTradeRunJobDotWithLabel {
  if (!hasStRouteLink) {
    return {
      color: 'grey',
      tooltip: 'No ServiceTrade route link',
      label: 'No ST link',
    }
  }
  if (job == null) {
    return noJobDot()
  }
  if (job.sync_status === SYNC_NO_ST_LINK) {
    return {
      color: 'grey',
      tooltip: 'No ServiceTrade route link',
      label: 'No ST link',
    }
  }
  if (job.sync_status === SYNC_NO_JOB || job.service_trade_job_id == null) {
    return noJobDot()
  }

  const jobStatus = (job.service_trade_job_status || '').trim().toLowerCase()
  if (jobStatus === 'completed') {
    return {
      color: 'green',
      tooltip: 'ServiceTrade testing job completed',
      label: 'Completed',
    }
  }
  if (job.service_trade_appointment_released === true) {
    return {
      color: 'green_light',
      tooltip: 'ServiceTrade job released to technicians',
      label: 'Released',
    }
  }
  if (jobStatus === 'scheduled' || job.sync_status === SYNC_SCHEDULED) {
    return {
      color: 'blue_light',
      tooltip: 'ServiceTrade job scheduled — not released yet',
      label: 'Scheduled',
    }
  }
  return {
    color: 'grey',
    tooltip: 'No qualifying ServiceTrade appointment this month',
    label: 'No appointment',
  }
}
