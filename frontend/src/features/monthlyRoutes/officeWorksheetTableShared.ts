import { parseYearMonth, type TechnicianWorksheetStop } from './monthlyRoutesShared'

export type OfficeStopStatus = 'tested' | 'skipped' | 'annual' | 'pending'

export type OfficeStopGroup = {
  locationId: number
  displayAddress: string
  buildingName: string | null
  propertyManagementCompany: string | null
  stops: TechnicianWorksheetStop[]
}

export type OfficeFieldChange = {
  field_name: string
  old_value: unknown
  new_value: unknown
}

export function worksheetReadOnlyDisplay(value: string | null | undefined): string {
  return (value ?? '').trim() || '—'
}

export function formatOfficeAuditValue(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'string') {
    const s = value.trim()
    return s || '—'
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function officeFirstDisplayValue(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const text = (value ?? '').trim()
    if (text) return text
  }
  return null
}

function isAnnualForMonth(annualMonth: string | null | undefined, monthIso: string): boolean {
  const raw = (annualMonth || '').trim().toLowerCase()
  if (!raw) return false
  const ym = parseYearMonth(monthIso)
  if (!ym) return false
  const monthFull = new Intl.DateTimeFormat('en-CA', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(ym.year, ym.month - 1, 1)))
    .toLowerCase()
  const monthShort = monthFull.slice(0, 3)
  return raw === monthFull || raw === monthShort
}

function sheetSkipReasonIsAnnual(skipReason: string | null | undefined): boolean {
  const s = (skipReason || '').trim().toLowerCase()
  return s === 'annual' || s === 'annual_booked'
}

export function worksheetStopIsAnnualSkip(stop: TechnicianWorksheetStop, monthDate: string): boolean {
  const rs = (stop.result_status || '').trim().toLowerCase()
  if (rs !== 'skipped') return isAnnualForMonth(stop.annual_month, monthDate)
  return sheetSkipReasonIsAnnual(stop.skip_reason) || isAnnualForMonth(stop.annual_month, monthDate)
}

export function officeStopStatus(stop: TechnicianWorksheetStop, monthDate: string): OfficeStopStatus {
  const rs = (stop.result_status || '').trim().toLowerCase()
  if (rs === 'tested') return 'tested'
  if (rs === 'skipped') return worksheetStopIsAnnualSkip(stop, monthDate) ? 'annual' : 'skipped'
  if (isAnnualForMonth(stop.annual_month, monthDate)) return 'annual'
  return 'pending'
}

export function officeStopStatusLabel(status: OfficeStopStatus): string {
  if (status === 'tested') return 'Tested'
  if (status === 'skipped') return 'Skipped'
  if (status === 'annual') return 'Annual'
  return 'Pending'
}

const EXPLICIT_TIME_VALUE_RE = /^\d{1,2}:\d{1,2}(:\d{1,2})?(\s*[ap]\.?m\.?)?$/i

function looksLikeExplicitTimeValue(raw: string | null | undefined): boolean {
  const s = (raw ?? '').trim()
  if (!s) return false
  return EXPLICIT_TIME_VALUE_RE.test(s)
}

export function worksheetTimeInOutDisplayLine(kind: 'in' | 'out', value: string): string {
  const v = value.trim()
  if (!v) return ''
  if (looksLikeExplicitTimeValue(v)) {
    return kind === 'in' ? `Time In: ${v}` : `Time Out: ${v}`
  }
  return v
}

export function shouldShowWorksheetTimeOutRow(displayTimeIn: string, displayTimeOut: string): boolean {
  if (!displayTimeOut.trim()) return false
  const tin = displayTimeIn.trim()
  if (!tin) return true
  return looksLikeExplicitTimeValue(displayTimeIn)
}

function normalizedActionCellDetail(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function worksheetSkipReasonDisplayBlock(skipReason: string | null | undefined): string | null {
  const s = (skipReason ?? '').trim()
  const low = s.toLowerCase()
  if (low === 'annual_booked' || low === 'sheet_value') return null
  if (!s) return '—'
  return s
}

export function worksheetSkipReasonDuplicatesTimeInNote(
  skipReasonBlock: string | null,
  resultStatus: string | null | undefined,
  displayTimeIn: string,
): boolean {
  if ((resultStatus || '').trim().toLowerCase() !== 'skipped') return false
  if (skipReasonBlock == null || skipReasonBlock === '—') return false
  const note = displayTimeIn.trim()
  if (!note || looksLikeExplicitTimeValue(displayTimeIn)) return false
  return normalizedActionCellDetail(skipReasonBlock) === normalizedActionCellDetail(note)
}

/** Audit ``field_name`` values that map to a compact-field label in the access/panel/monitoring groups. */
const AUDIT_FIELD_TO_COMPACT_LABEL: Record<string, string> = {
  ring: 'Ring',
  key_number: 'Key #',
  door_code: 'Door code',
  annual_month: 'Annual',
  panel: 'Panel',
  facp: 'Panel',
  panel_location: 'Panel location',
  monitoring_company: 'Company',
  monitoring_notes: 'Notes',
  monitoring: 'Notes',
  building_name: 'Building',
  property_management_company: 'PMC',
}

const AUDIT_FIELD_TO_LONG_TEXT_KEY: Record<string, keyof TechnicianWorksheetStop> = {
  testing_procedures: 'testing_procedures',
  inspection_tech_notes: 'inspection_tech_notes',
  run_comments: 'run_comments',
}

export function groupOfficeWorksheetStops(stops: TechnicianWorksheetStop[]): OfficeStopGroup[] {
  const groupsByLocation = new Map<number, OfficeStopGroup>()
  const orderedStops = [...stops].sort((a, b) => {
    const aNum = Number.isFinite(a.stop_number) ? a.stop_number : Number.MAX_SAFE_INTEGER
    const bNum = Number.isFinite(b.stop_number) ? b.stop_number : Number.MAX_SAFE_INTEGER
    return aNum - bNum || a.location_id - b.location_id || a.testing_site_id - b.testing_site_id
  })
  for (const stop of orderedStops) {
    const existing = groupsByLocation.get(stop.location_id)
    if (existing) {
      existing.buildingName = officeFirstDisplayValue(existing.buildingName, stop.building_name)
      existing.propertyManagementCompany = officeFirstDisplayValue(
        existing.propertyManagementCompany,
        stop.property_management_company,
      )
      existing.stops.push(stop)
      continue
    }
    groupsByLocation.set(stop.location_id, {
      locationId: stop.location_id,
      displayAddress: stop.display_address,
      buildingName: officeFirstDisplayValue(stop.building_name),
      propertyManagementCompany: officeFirstDisplayValue(stop.property_management_company),
      stops: [stop],
    })
  }
  return Array.from(groupsByLocation.values())
}

export function fieldChangesForLocation(
  locationId: number,
  fieldChangesByLocation?: Map<number, OfficeFieldChange[]>,
): OfficeFieldChange[] {
  return fieldChangesByLocation?.get(locationId) ?? []
}

export function auditChangeForCompactLabel(
  locationId: number,
  compactLabel: string,
  fieldChangesByLocation?: Map<number, OfficeFieldChange[]>,
): OfficeFieldChange | undefined {
  const changes = fieldChangesForLocation(locationId, fieldChangesByLocation)
  return changes.find((c) => AUDIT_FIELD_TO_COMPACT_LABEL[c.field_name] === compactLabel)
}

export function auditChangeForLongTextField(
  locationId: number,
  stopKey: keyof TechnicianWorksheetStop,
  fieldChangesByLocation?: Map<number, OfficeFieldChange[]>,
): OfficeFieldChange | undefined {
  const changes = fieldChangesForLocation(locationId, fieldChangesByLocation)
  return changes.find((c) => AUDIT_FIELD_TO_LONG_TEXT_KEY[c.field_name] === stopKey)
}

export function renderFieldChangeInline(change: OfficeFieldChange): string {
  return `${formatOfficeAuditValue(change.old_value)} → ${formatOfficeAuditValue(change.new_value)}`
}

const ACCESS_AUDIT_LABELS = ['Ring', 'Key #', 'Door code', 'Annual'] as const
const PANEL_AUDIT_LABELS = ['Panel', 'Panel location'] as const
const MONITORING_AUDIT_LABELS = ['Company', 'Notes'] as const
const ADDRESS_AUDIT_LABELS = ['Building', 'PMC'] as const

function locationHasAuditLabel(
  locationId: number,
  labels: readonly string[],
  fieldChangesByLocation?: Map<number, OfficeFieldChange[]>,
): boolean {
  return labels.some((label) => auditChangeForCompactLabel(locationId, label, fieldChangesByLocation) != null)
}

export function officeAccessCellUpdated(
  locationId: number,
  fieldChangesByLocation?: Map<number, OfficeFieldChange[]>,
): boolean {
  return locationHasAuditLabel(locationId, ACCESS_AUDIT_LABELS, fieldChangesByLocation)
}

export function officePanelCellUpdated(
  locationId: number,
  fieldChangesByLocation?: Map<number, OfficeFieldChange[]>,
): boolean {
  return locationHasAuditLabel(locationId, PANEL_AUDIT_LABELS, fieldChangesByLocation)
}

export function officeMonitoringCellUpdated(
  locationId: number,
  fieldChangesByLocation?: Map<number, OfficeFieldChange[]>,
): boolean {
  return locationHasAuditLabel(locationId, MONITORING_AUDIT_LABELS, fieldChangesByLocation)
}

export function officeAddressCellUpdated(
  locationId: number,
  fieldChangesByLocation?: Map<number, OfficeFieldChange[]>,
): boolean {
  return locationHasAuditLabel(locationId, ADDRESS_AUDIT_LABELS, fieldChangesByLocation)
}

/** Human-readable reasons a stop appears on run-details notable worksheet (debug / tooltips). */
export function notableStopInclusionReasons(
  stop: TechnicianWorksheetStop,
  monthDate: string,
  fieldChangesByLocation?: Map<number, OfficeFieldChange[]>,
): string[] {
  const reasons: string[] = []
  const status = officeStopStatus(stop, monthDate)
  if (status === 'skipped') reasons.push('Skipped (non-annual)')
  if (status === 'annual') reasons.push('Skipped (annual)')
  if (stopHasRunComments(stop)) reasons.push('Job comment on this site')
  const changes = fieldChangesForLocation(stop.location_id, fieldChangesByLocation)
  const seen = new Set<string>()
  for (const change of changes) {
    const label = AUDIT_FIELD_TO_COMPACT_LABEL[change.field_name]
    const longKey = AUDIT_FIELD_TO_LONG_TEXT_KEY[change.field_name]
    const name = label ?? longKey ?? change.field_name
    if (!seen.has(name)) {
      seen.add(name)
      reasons.push(`Property: ${name}`)
    }
  }
  if (reasons.length === 0) {
    reasons.push('Included by route filter (check audit / skip / comments on this address)')
  }
  return reasons
}

/** Optional data columns (access → job comments); # / address / result are always shown. */
export type OfficeWorksheetChangeColumnVisibility = {
  access: boolean
  panel: boolean
  monitoring: boolean
  procedures: boolean
  locationComments: boolean
  runComments: boolean
}

export const OFFICE_WORKSHEET_ALL_CHANGE_COLUMNS_VISIBLE: OfficeWorksheetChangeColumnVisibility = {
  access: true,
  panel: true,
  monitoring: true,
  procedures: true,
  locationComments: true,
  runComments: true,
}

const OFFICE_COL_WIDTH_REM = {
  stop: '2.5rem',
  address: '15rem',
  result: '10rem',
  access: '11rem',
  panel: '11rem',
  monitoring: '9.5rem',
  procedures: '14rem',
  locationComments: '14rem',
  runComments: '14rem',
} as const

function officeLongTextColumnHasChange(
  locationId: number,
  stopKey: keyof TechnicianWorksheetStop,
  fieldChangesByLocation?: Map<number, OfficeFieldChange[]>,
): boolean {
  return auditChangeForLongTextField(locationId, stopKey, fieldChangesByLocation) != null
}

/** Which optional columns have at least one audited change anywhere on the route. */
export function stopHasRunComments(stop: TechnicianWorksheetStop): boolean {
  return (stop.run_comments ?? '').trim().length > 0
}

export function computeOfficeWorksheetChangeColumnVisibility(
  fieldChangesByLocation?: Map<number, OfficeFieldChange[]>,
  stops?: TechnicianWorksheetStop[],
): OfficeWorksheetChangeColumnVisibility {
  const vis: OfficeWorksheetChangeColumnVisibility = {
    access: false,
    panel: false,
    monitoring: false,
    procedures: false,
    locationComments: false,
    runComments: false,
  }
  if (!fieldChangesByLocation?.size) return vis
  for (const locationId of fieldChangesByLocation.keys()) {
    if (officeAccessCellUpdated(locationId, fieldChangesByLocation)) vis.access = true
    if (officePanelCellUpdated(locationId, fieldChangesByLocation)) vis.panel = true
    if (officeMonitoringCellUpdated(locationId, fieldChangesByLocation)) vis.monitoring = true
    if (officeLongTextColumnHasChange(locationId, 'testing_procedures', fieldChangesByLocation)) {
      vis.procedures = true
    }
    if (officeLongTextColumnHasChange(locationId, 'inspection_tech_notes', fieldChangesByLocation)) {
      vis.locationComments = true
    }
    if (officeLongTextColumnHasChange(locationId, 'run_comments', fieldChangesByLocation)) {
      vis.runComments = true
    }
  }
  if (stops?.some(stopHasRunComments)) {
    vis.runComments = true
  }
  return vis
}

function officeColWidth(show: boolean, width: string): string {
  return show ? width : '0px'
}

/** CSS variables for table width and column sizing when optional columns are hidden. */
export function officeWorksheetTableCssVars(
  changeColumns: OfficeWorksheetChangeColumnVisibility,
): Record<string, string> {
  const accessW = officeColWidth(changeColumns.access, OFFICE_COL_WIDTH_REM.access)
  const panelW = officeColWidth(changeColumns.panel, OFFICE_COL_WIDTH_REM.panel)
  const monitoringW = officeColWidth(changeColumns.monitoring, OFFICE_COL_WIDTH_REM.monitoring)
  const proceduresW = officeColWidth(changeColumns.procedures, OFFICE_COL_WIDTH_REM.procedures)
  const locationCommentsW = officeColWidth(
    changeColumns.locationComments,
    OFFICE_COL_WIDTH_REM.locationComments,
  )
  const runCommentsW = officeColWidth(changeColumns.runComments, OFFICE_COL_WIDTH_REM.runComments)
  return {
    '--tw-office-col-stop': OFFICE_COL_WIDTH_REM.stop,
    '--tw-office-col-address': OFFICE_COL_WIDTH_REM.address,
    '--tw-office-col-result': OFFICE_COL_WIDTH_REM.result,
    '--tw-office-col-access': accessW,
    '--tw-office-col-panel': panelW,
    '--tw-office-col-monitoring': monitoringW,
    '--tw-office-col-procedures': proceduresW,
    '--tw-office-col-location-comments': locationCommentsW,
    '--tw-office-col-run-comments': runCommentsW,
    '--tw-office-table-w': `calc(${[
      OFFICE_COL_WIDTH_REM.stop,
      OFFICE_COL_WIDTH_REM.address,
      OFFICE_COL_WIDTH_REM.result,
      accessW,
      panelW,
      monitoringW,
      proceduresW,
      locationCommentsW,
      runCommentsW,
    ].join(' + ')})`,
  }
}
