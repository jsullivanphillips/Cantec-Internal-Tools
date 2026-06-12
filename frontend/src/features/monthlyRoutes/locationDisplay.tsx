import type { CSSProperties, ReactNode } from 'react'

export type LocationDisplayRow = {
  label?: string | null
  display_address?: string | null
  address?: string | null
}

export type LocationDisplayOptions = {
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

function locationAddress(row: LocationDisplayRow): string {
  return normalizeText(row.display_address) || normalizeText(row.address)
}

function shouldCompactPrimaryLabel(
  primary: string,
  options: LocationDisplayOptions & { label?: string; address?: string },
): boolean {
  if (!options.compact || !primary) return false
  if (primary.includes(',')) return true
  const label = normalizeText(options.label)
  const address = normalizeText(options.address)
  return !label && address !== '' && primary === address
}

function maybeCompactPrimaryLabel(
  primary: string,
  options: LocationDisplayOptions & { label?: string; address?: string },
): string {
  if (!shouldCompactPrimaryLabel(primary, options)) return primary
  return shortStreetAddress(primary)
}

/** Primary line: location label, else address, else fallback. */
export function locationPrimaryLabel(
  row: LocationDisplayRow,
  options: LocationDisplayOptions = {},
): string {
  const label = normalizeText(row.label)
  const address = locationAddress(row)
  const compactOpts = { ...options, label, address }
  const primary = label || address || 'Testing location'
  return maybeCompactPrimaryLabel(primary, compactOpts)
}

/** Subline when label differs from the billing/navigation address. */
export function locationAddressSubline(
  row: LocationDisplayRow,
  primaryLabel?: string,
): string | null {
  const primary = normalizeText(primaryLabel) || locationPrimaryLabel(row)
  const address = locationAddress(row)
  if (!address || address.toLowerCase() === primary.toLowerCase()) return null
  return address
}

export function locationDisplaySubline(
  row: LocationDisplayRow,
  options: LocationDisplayOptions & { primaryLabel?: string } = {},
): string | null {
  const primary = normalizeText(options.primaryLabel) || locationPrimaryLabel(row, options)
  return locationAddressSubline(row, primary)
}

export type LocationHeadingProps = {
  row?: LocationDisplayRow
  /** @deprecated Use ``row``. */
  stop?: LocationDisplayRow
  siteCount?: number
  siteIndex?: number
  compact?: boolean
  primaryClassName?: string
  sublineClassName?: string
  as?: 'div' | 'span' | 'h1' | 'h2' | 'h3'
  style?: CSSProperties
  children?: ReactNode
}

export function LocationHeading({
  row,
  stop,
  siteCount,
  siteIndex,
  compact,
  primaryClassName,
  sublineClassName = 'text-muted small',
  as: Tag = 'div',
  style,
  children,
}: LocationHeadingProps) {
  const displayRow = row ?? stop ?? {}
  const primary = locationPrimaryLabel(displayRow, { compact, siteCount, siteIndex })
  const subline = locationDisplaySubline(displayRow, { compact, siteCount, siteIndex, primaryLabel: primary })
  return (
    <Tag style={style}>
      <span className={primaryClassName}>{primary}</span>
      {subline ? <div className={sublineClassName}>{subline}</div> : null}
      {children}
    </Tag>
  )
}

export function locationAriaLabel(
  row: LocationDisplayRow,
  options: LocationDisplayOptions = {},
): string {
  const primary = locationPrimaryLabel(row, options)
  const subline = locationDisplaySubline(row, { ...options, primaryLabel: primary })
  return subline ? `${primary}, ${subline}` : primary
}

/** First comma-separated segment of a geocoded address (``9851 Seaport Place``). */
export function streetLineFromAddress(raw: string | null | undefined): string {
  const trimmed = normalizeText(raw)
  if (!trimmed) return trimmed
  return trimmed.includes(',') ? (trimmed.split(',')[0]?.trim() ?? trimmed) : trimmed
}

/** Billing board row title: site label only. */
export function billingBoardLocationTitle(row: {
  building?: string | null
  label?: string | null
}): string {
  return normalizeText(row.building) || normalizeText(row.label) || 'Testing location'
}


/** @deprecated Flat locations: always one site per row. */
export function testingSitePositionAtLocation<
  T extends LocationDisplayRow & { location_id?: number; stop_number?: number },
>(stop: T, stops: T[]): { siteCount: number; siteIndex: number } {
  void stops
  void stop
  return { siteCount: 1, siteIndex: 0 }
}

/** Multi-stop billing row label (legacy). */
export function testingSiteOfBillingSubline(
  siteIndex: number,
  siteCount: number,
  billingLocation: string,
): string {
  const billing = (billingLocation ?? "").trim()
  return `location ${siteIndex + 1}/${siteCount} of ${billing || "billing location"}`
}

export type LocationDisplayOptionsWithSites = LocationDisplayOptions & {
  siteCount?: number
  siteIndex?: number
}

export function legacyWorksheetRowDisplay(
  row: LocationDisplayRow,
  options: LocationDisplayOptionsWithSites = {},
): { primary: string; subline: string | null } {
  const primary = locationPrimaryLabel(row, options)
  const subline = locationDisplaySubline(row, { ...options, primaryLabel: primary })
  return { primary, subline }
}
