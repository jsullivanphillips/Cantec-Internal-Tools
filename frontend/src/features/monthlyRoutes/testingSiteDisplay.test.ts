import { describe, expect, it } from 'vitest'
import {
  billingBoardLocationSubline,
  billingBoardLocationTitle,
  shortStreetAddress,
  testingSiteOfBillingSubline,
  testingSitePrimaryLabel,
  worksheetStopDisplaySubline,
} from './testingSiteDisplay'

describe('testingSiteDisplay', () => {
  it('shortens full geocoded addresses to abbreviated street line', () => {
    expect(
      shortStreetAddress('1080 Cypress Road, North Saanich, British Columbia V8L 5P4, Canada'),
    ).toBe('1080 Cypress Rd')
    expect(shortStreetAddress('2471 Sidney Ave')).toBe('2471 Sidney Ave')
    expect(shortStreetAddress('800 Johnson Street')).toBe('800 Johnson St')
  })

  it('billingBoardLocationTitle keeps unabbreviated street line', () => {
    expect(
      billingBoardLocationTitle({
        location_label: '9851 Seaport Place, Sidney, British Columbia V8L 0A5, Canada',
      }),
    ).toBe('9851 Seaport Place')
  })

  it('billingBoardLocationSubline shortens multi-site labels', () => {
    expect(
      billingBoardLocationSubline({
        location_label: '2471 Sidney Ave, Victoria, BC',
        testing_site_labels: [
          '2471 Sidney Ave, Victoria, BC',
          '9838 Second Street, Victoria, BC',
        ],
      }),
    ).toBe('2471 Sidney Ave · 9838 Second Street')
  })

  it('compact primary label shortens billing address for single-site stops', () => {
    expect(
      testingSitePrimaryLabel(
        {
          primary_label: '1080 Cypress Road, North Saanich, British Columbia V8L 5P4, Canada',
          label: null,
          display_address: '1080 Cypress Road, North Saanich, British Columbia V8L 5P4, Canada',
        },
        { compact: true },
      ),
    ).toBe('1080 Cypress Rd')
  })

  it('compact primary label keeps explicit site labels unchanged', () => {
    expect(
      testingSitePrimaryLabel(
        {
          label: '9838 Second Street',
          display_address: '1080 Cypress Road, North Saanich, British Columbia V8L 5P4, Canada',
        },
        { siteCount: 2, siteIndex: 1, compact: true },
      ),
    ).toBe('9838 Second Street')
  })

  it('uses server primary_label when present', () => {
    expect(
      testingSitePrimaryLabel({
        primary_label: '9838 Second Street',
        label: 'ignored',
        display_address: '2471 Sidney Ave',
      }),
    ).toBe('9838 Second Street')
  })

  it('falls back to billing address for single-site null label', () => {
    expect(
      testingSitePrimaryLabel({
        label: null,
        display_address: '2471 Sidney Ave',
      }),
    ).toBe('2471 Sidney Ave')
  })

  it('shows multi-site subline as testing site X/N of billing location', () => {
    const stop = {
      label: '9838 Second Street',
      display_address: '2471 Sidney Ave',
    }
    const primary = testingSitePrimaryLabel(stop, { siteCount: 2, siteIndex: 0 })
    expect(
      worksheetStopDisplaySubline(stop, { siteCount: 2, siteIndex: 0, primaryLabel: primary }),
    ).toBe('testing site 1/2 of 2471 Sidney Ave')
  })

  it('shows billing subline when single-site label differs', () => {
    const stop = {
      label: '9838 Second Street',
      display_address: '2471 Sidney Ave',
    }
    const primary = testingSitePrimaryLabel(stop, { siteCount: 1 })
    expect(worksheetStopDisplaySubline(stop, { siteCount: 1, primaryLabel: primary })).toBe(
      '2471 Sidney Ave',
    )
  })

  it('hides subline when single-site primary equals billing address', () => {
    const stop = { label: null, display_address: '2471 Sidney Ave' }
    expect(worksheetStopDisplaySubline(stop, { siteCount: 1 })).toBeNull()
  })

  it('formats testingSiteOfBillingSubline', () => {
    expect(testingSiteOfBillingSubline(1, 2, '2471 Sidney Avenue')).toBe(
      'testing site 2/2 of 2471 Sidney Avenue',
    )
  })

  it('joins billing board multi-site labels', () => {
    expect(
      billingBoardLocationSubline({
        location_label: '2471 Sidney Ave',
        testing_site_labels: ['2471 Sidney Ave', '9838 Second Street'],
      }),
    ).toBe('2471 Sidney Ave · 9838 Second Street')
  })
})
