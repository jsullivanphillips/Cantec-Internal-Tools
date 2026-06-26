import { describe, expect, it } from 'vitest'

import {
  derivePrepAnnualScheduleWarning,
  prepAnnualScheduleWarningLabel,
  prepRowAnnualDue,
  prepRowAnnualDueForStop,
  prepRowShowsAnnualOverriddenPill,
  prepRowShowsAnnualTestControl,
  stopScheduledAnnualAutoSkipActive,
} from './prepAnnualSchedule'
import type { AnnualScheduleCheckLocation } from './monthlyRoutesShared'

const baseRow = (overrides: Partial<AnnualScheduleCheckLocation>): AnnualScheduleCheckLocation => ({
  location_id: 1,
  has_service_trade_link: true,
  service_trade_site_location_url: 'https://app.servicetrade.com/locations/1',
  has_scheduled_annual_in_month: false,
  has_unreleased_annual_in_month: false,
  annual_spans_months: false,
  annual_skip_recommended: false,
  annual_test_recommended: false,
  spanning_job_id: null,
  prep_warning: null,
  ...overrides,
})

describe('prepRowAnnualDue', () => {
  it('returns false until schedule check is ready', () => {
    expect(prepRowAnnualDue(1, 'loading', null)).toBe(false)
  })

  it('returns true while syncing once the location row is available', () => {
    const byId = {
      1: baseRow({
        annual_skip_recommended: true,
        has_scheduled_annual_in_month: true,
      }),
    }
    expect(prepRowAnnualDue(1, 'syncing', byId)).toBe(true)
  })

  it('returns true when ServiceTrade recommends annual skip', () => {
    const byId = {
      1: baseRow({
        annual_skip_recommended: true,
        has_scheduled_annual_in_month: true,
      }),
    }
    expect(prepRowAnnualDue(1, 'ready', byId)).toBe(true)
  })

  it('returns false when annual test override is set on the stop', () => {
    const byId = {
      1: baseRow({ annual_skip_recommended: true }),
    }
    expect(prepRowAnnualDue(1, 'ready', byId, { annual_test_override: true })).toBe(false)
  })
})

describe('prepAnnualScheduleWarningLabel', () => {
  it('maps warning codes to labels', () => {
    expect(prepAnnualScheduleWarningLabel('no_servicetrade_link')).toBe('No ServiceTrade link')
    expect(prepAnnualScheduleWarningLabel('annual_spans_months')).toBe('Annual spans months')
    expect(prepAnnualScheduleWarningLabel('annual_skip_tie')).toBe('Annual skip tie — review')
  })
})

describe('prepRowAnnualDueForStop', () => {
  it('drives orange row styling when annual skip is recommended', () => {
    const row = baseRow({
      annual_skip_recommended: true,
      has_scheduled_annual_in_month: true,
    })
    expect(prepRowAnnualDueForStop('ready', row, null)).toBe(true)
  })
})

describe('derivePrepAnnualScheduleWarning', () => {
  it('matches backend warning derivation', () => {
    expect(derivePrepAnnualScheduleWarning(false, true, false, false)).toBe('no_servicetrade_link')
    expect(derivePrepAnnualScheduleWarning(true, false, true, false)).toBe('annual_spans_months')
    expect(derivePrepAnnualScheduleWarning(true, false, false, true)).toBe('annual_skip_tie')
  })
})

describe('prepRowShowsAnnualTestControl', () => {
  it('shows Test when annual skip recommended and no override', () => {
    const row = baseRow({
      annual_skip_recommended: true,
      has_scheduled_annual_in_month: true,
    })
    expect(prepRowShowsAnnualTestControl('ready', row, null)).toBe(true)
  })

  it('shows Test when annual spans months and test is recommended for this month', () => {
    const row = baseRow({
      annual_skip_recommended: false,
      annual_test_recommended: true,
      annual_spans_months: true,
      has_scheduled_annual_in_month: true,
    })
    expect(prepRowShowsAnnualTestControl('ready', row, null)).toBe(true)
  })

  it('shows Skip instead of Test when override is active', () => {
    const row = baseRow({
      annual_skip_recommended: true,
      has_scheduled_annual_in_month: true,
    })
    expect(prepRowShowsAnnualTestControl('ready', row, { annual_test_override: true })).toBe(false)
  })
})

describe('prepRowShowsAnnualOverriddenPill', () => {
  it('shows when override is set and the site has annual schedule activity', () => {
    const row = baseRow({
      annual_skip_recommended: true,
      has_scheduled_annual_in_month: true,
    })
    expect(prepRowShowsAnnualOverriddenPill('ready', row, { annual_test_override: true })).toBe(
      true,
    )
  })

  it('hides when override is set but there is no annual activity', () => {
    expect(
      prepRowShowsAnnualOverriddenPill('ready', baseRow({}), { annual_test_override: true }),
    ).toBe(false)
  })

  it('hides until schedule check is ready', () => {
    const row = baseRow({
      annual_skip_recommended: true,
      has_scheduled_annual_in_month: true,
    })
    expect(prepRowShowsAnnualOverriddenPill('loading', row, { annual_test_override: true })).toBe(
      false,
    )
  })
})

describe('stopScheduledAnnualAutoSkipActive', () => {
  it('is true only when scheduled_annual_auto_skip is set', () => {
    expect(stopScheduledAnnualAutoSkipActive({ scheduled_annual_auto_skip: true })).toBe(true)
    expect(stopScheduledAnnualAutoSkipActive({ scheduled_annual_auto_skip: false })).toBe(false)
    expect(stopScheduledAnnualAutoSkipActive({})).toBe(false)
  })
})
