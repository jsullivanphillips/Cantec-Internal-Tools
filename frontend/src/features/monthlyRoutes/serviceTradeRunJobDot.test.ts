import { describe, expect, it } from 'vitest'
import { serviceTradeRunJobDot } from './serviceTradeRunJobDot'
import type { ServiceTradeRunJobMonth } from './monthlyRoutesShared'

function job(overrides: Partial<ServiceTradeRunJobMonth> = {}): ServiceTradeRunJobMonth {
  return {
    service_trade_job_id: 100,
    service_trade_job_url: 'https://app.servicetrade.com/job/100',
    sync_status: 'scheduled',
    service_trade_job_status: 'scheduled',
    service_trade_appointment_released: false,
    ...overrides,
  }
}

describe('serviceTradeRunJobDot', () => {
  it('returns grey when route has no ST link', () => {
    expect(serviceTradeRunJobDot(false, job())).toMatchObject({
      color: 'grey',
      label: 'No ST link',
    })
  })

  it('returns red when no cached job', () => {
    expect(serviceTradeRunJobDot(true, undefined)).toMatchObject({
      color: 'red',
      label: 'No job',
    })
  })

  it('returns green when completed', () => {
    expect(
      serviceTradeRunJobDot(
        true,
        job({ service_trade_job_status: 'completed', sync_status: 'ok' }),
      ),
    ).toMatchObject({ color: 'green', label: 'Completed' })
  })

  it('returns light green when released', () => {
    expect(
      serviceTradeRunJobDot(
        true,
        job({ service_trade_appointment_released: true }),
      ),
    ).toMatchObject({ color: 'green_light', label: 'Released' })
  })

  it('returns light blue when scheduled but not released', () => {
    expect(serviceTradeRunJobDot(true, job())).toMatchObject({
      color: 'blue_light',
      label: 'Scheduled',
    })
  })
})
