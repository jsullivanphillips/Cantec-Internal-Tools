import type { CSSProperties, ReactNode } from 'react'

export type TestingSiteDisplayStop = {
  label?: string | null
  display_address?: string | null
  primary_label?: string | null
  billing_address_subline?: string | null
}

export type TestingSiteDisplayOptions = {
  siteCount?: number
  siteIndex?: number
  /** Tech portal nav/hero: street line only with abbreviated suffix (e.g. ``1080 Cypress Rd``). */
  compact?: boolean
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim()
}

const STREET_SUFFIX_ABBREV: Record<string, string> = {
  road: 'Rd',
  street: 'St',
  avenue: 'Ave',
  boulevard: 'Blvd',
  drive: 'Dr',
  lane: 'Ln',
  court: 'Ct',
  place: 'Pl',
  crescent: 'Cres',
  highway: 'Hwy',
  circle: 'Cir',
  trail: 'Tr',
  parkway: 'Pkwy',
  square: 'Sq',
}

function abbreviateStreetSuffixes(streetLine: string): string {
  return streetLine.replace(
    /\b(Road|Street|Avenue|Boulevard|Drive|Lane|Court|Place|Crescent|Highway|Circle|Trail|Parkway|Square)\b/gi,
    (match) => STREET_SUFFIX_ABBREV[match.toLowerCase()] ?? match,
  )
}

/** First comma-separated line with common street-type abbreviations (``1080 Cypress Rd``). */
export function shortStreetAddress(raw: string): string {
  const trimmed = normalizeText(raw)
  if (!trimmed) return trimmed
  const streetLine = trimmed.includes(',') ? (trimmed.split(',')[0]?.trim() ?? trimmed) : trimmed
  return abbreviateStreetSuffixes(streetLine)
}

function shouldCompactPrimaryLabel(
  primary: string,
  options: TestingSiteDisplayOptions & { label?: string; billing?: string },
): boolean {
  if (!options.compact || !primary) return false
  if (primary.includes(',')) return true
  const siteCount = options.siteCount ?? 1
  const label = normalizeText(options.label)
  const billing = normalizeText(options.billing)
  return siteCount <= 1 && !label && billing !== '' && primary === billing
}

function maybeCompactPrimaryLabel(
  primary: string,
  options: TestingSiteDisplayOptions & { label?: string; billing?: string },
): string {
  if (!shouldCompactPrimaryLabel(primary, options)) return primary
  return shortStreetAddress(primary)
}

export function testingSitePrimaryLabel(
  stop: TestingSiteDisplayStop,
  options: TestingSiteDisplayOptions = {},
): string {
  const siteCount = options.siteCount ?? 1
  const siteIndex = options.siteIndex ?? 0
  const label = normalizeText(stop.label)
  const billing = normalizeText(stop.display_address)
  const compactOpts = { ...options, label, billing }

  if (normalizeText(stop.primary_label)) {
    return maybeCompactPrimaryLabel(normalizeText(stop.primary_label), compactOpts)
  }
  if (siteCount <= 1) {
    const primary = label || billing || 'Testing location'
    return maybeCompactPrimaryLabel(primary, compactOpts)
  }
  if (label) return label
  return `Testing site ${siteIndex + 1}`
}

export function testingSiteBillingSubline(
  stop: TestingSiteDisplayStop,
  primaryLabel?: string,
): string | null {
  const serverSubline = normalizeText(stop.billing_address_subline)
  if (serverSubline) return serverSubline
  const primary = normalizeText(primaryLabel) || testingSitePrimaryLabel(stop)
  const billing = normalizeText(stop.display_address)
  if (!billing || billing.toLowerCase() === primary.toLowerCase()) return null
  return billing
}

/** Multi-stop billing row: ``testing site 1/2 of 2471 Sidney Ave``. */
export function testingSiteOfBillingSubline(
  siteIndex: number,
  siteCount: number,
  billingLocation: string,
): string {
  const billing = normalizeText(billingLocation)
  return `testing site ${siteIndex + 1}/${siteCount} of ${billing || 'billing location'}`
}

export function worksheetStopDisplaySubline(
  stop: TestingSiteDisplayStop,
  options: TestingSiteDisplayOptions & { primaryLabel?: string } = {},
): string | null {
  const siteCount = options.siteCount ?? 1
  const siteIndex = options.siteIndex ?? 0
  const billing = normalizeText(stop.display_address)
  if (siteCount > 1) {
    return billing ? testingSiteOfBillingSubline(siteIndex, siteCount, billing) : null
  }
  const primary = normalizeText(options.primaryLabel) || testingSitePrimaryLabel(stop, options)
  return testingSiteBillingSubline(stop, primary)
}

export type TestingSiteStopHeadingProps = {
  stop: TestingSiteDisplayStop
  siteCount?: number
  siteIndex?: number
  compact?: boolean
  primaryClassName?: string
  sublineClassName?: string
  as?: 'div' | 'span' | 'h1' | 'h2' | 'h3'
  style?: CSSProperties
  children?: ReactNode
}

export function TestingSiteStopHeading({
  stop,
  siteCount,
  siteIndex,
  compact,
  primaryClassName,
  sublineClassName = 'text-muted small',
  as: Tag = 'div',
  style,
  children,
}: TestingSiteStopHeadingProps) {
  const primary = testingSitePrimaryLabel(stop, { siteCount, siteIndex, compact })
  const subline = worksheetStopDisplaySubline(stop, { siteCount, siteIndex, primaryLabel: primary })
  return (
    <Tag style={style}>
      <span className={primaryClassName}>{primary}</span>
      {subline ? <div className={sublineClassName}>{subline}</div> : null}
      {children}
    </Tag>
  )
}

export function testingSiteAriaLabel(
  stop: TestingSiteDisplayStop,
  options: TestingSiteDisplayOptions = {},
): string {
  const primary = testingSitePrimaryLabel(stop, options)
  const subline = worksheetStopDisplaySubline(stop, { ...options, primaryLabel: primary })
  return subline ? `${primary}, ${subline}` : primary
}

export function testingSitePositionAtLocation<
  T extends TestingSiteDisplayStop & { location_id?: number; testing_site_id?: number; stop_number?: number },
>(
  stop: T,
  stops: T[],
): { siteCount: number; siteIndex: number } {
  const atLocation = stops
    .filter((row) => row.location_id === stop.location_id)
    .sort((a, b) => (a.stop_number ?? 0) - (b.stop_number ?? 0))
  const siteCount = atLocation.length || 1
  const found = atLocation.findIndex((row) => row.testing_site_id === stop.testing_site_id)
  return { siteCount, siteIndex: found >= 0 ? found : 0 }
}

/** First comma-separated segment of a geocoded address (``9851 Seaport Place``). */
export function streetLineFromAddress(raw: string | null | undefined): string {
  const trimmed = normalizeText(raw)
  if (!trimmed) return trimmed
  return trimmed.includes(',') ? (trimmed.split(',')[0]?.trim() ?? trimmed) : trimmed
}

/** Billing board row title: street line only. */
export function billingBoardLocationTitle(row: {
  location_label?: string | null
  display_address?: string | null
}): string {
  const raw = normalizeText(row.location_label) || normalizeText(row.display_address)
  return streetLineFromAddress(raw) || 'Testing location'
}

export function billingBoardLocationSubline(row: {
  testing_site_labels?: string[] | null
  display_address?: string | null
  location_label?: string | null
}): string | null {
  const labels = (row.testing_site_labels ?? []).map((label) => label.trim()).filter(Boolean)
  if (labels.length > 1) {
    return labels.map((label) => streetLineFromAddress(label)).join(' · ')
  }
  const billing = streetLineFromAddress(row.display_address)
  const title = streetLineFromAddress(row.location_label)
  if (billing && title && billing.toLowerCase() !== title.toLowerCase()) return billing
  return null
}

export function legacyWorksheetRowDisplay(
  row: { location_id: number; display_address: string },
  stops: Array<TestingSiteDisplayStop & { location_id?: number; stop_number?: number }> | undefined,
): { primary: string; subline: string | null } {
  const siteStops = [...(stops ?? [])]
    .filter((stop) => stop.location_id === row.location_id)
    .sort((a, b) => (a.stop_number ?? 0) - (b.stop_number ?? 0))
  if (siteStops.length === 0) {
    return {
      primary: normalizeText(row.display_address) || 'Testing location',
      subline: null,
    }
  }
  if (siteStops.length === 1) {
    const primary = testingSitePrimaryLabel(siteStops[0]!)
    return { primary, subline: worksheetStopDisplaySubline(siteStops[0]!, { primaryLabel: primary }) }
  }
  const billing = normalizeText(row.display_address) || 'Testing location'
  return {
    primary: billing,
    subline: `${siteStops.length} testing sites`,
  }
}
