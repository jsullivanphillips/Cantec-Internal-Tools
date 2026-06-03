import { parseMonitoringSheetDisplay } from './monitoringSheetDisplay'
import type { MonitoringCompanySummary } from './monthlyRoutesShared'

export type StopMonitoringDisplay = {
  company: string
  account: string
  notes: string
  phones: string[]
}

type StopMonitoringSource = {
  monitoring_company?: string | null
  monitoring_company_id?: number | null
  monitoring_account_number?: string | null
  monitoring_notes?: string | null
  monitoring_company_record?: MonitoringCompanySummary | null
}

/** Prefer structured worksheet fields; fall back to legacy notes parsing. */
export function stopMonitoringDisplay(stop: StopMonitoringSource): StopMonitoringDisplay {
  const structuredCompany =
    stop.monitoring_company_record?.name?.trim() || stop.monitoring_company?.trim() || ''
  const structuredAccount = stop.monitoring_account_number?.trim() || ''
  const structuredNotes = stop.monitoring_notes?.trim() || ''
  const phones = [
    stop.monitoring_company_record?.primary_phone?.trim(),
    stop.monitoring_company_record?.secondary_phone?.trim(),
  ].filter((line): line is string => Boolean(line))

  if (structuredCompany || structuredAccount || structuredNotes || phones.length > 0) {
    return {
      company: structuredCompany || '—',
      account: structuredAccount || '—',
      notes: structuredNotes || '—',
      phones,
    }
  }

  const parsed = parseMonitoringSheetDisplay(stop.monitoring_notes)
  if (!parsed.isStructured) {
    return {
      company: '—',
      account: '—',
      notes: stop.monitoring_notes?.trim() || '—',
      phones: [],
    }
  }

  const fieldMap = Object.fromEntries(parsed.fields.map((row) => [row.key, row.value.trim()]))
  const remainder = [parsed.remainderBefore, parsed.remainderAfter].filter(Boolean).join('\n\n').trim()
  return {
    company: fieldMap.company || '—',
    account: fieldMap.acct || '—',
    notes: remainder || structuredNotes || '—',
    phones: fieldMap.phone ? [fieldMap.phone] : [],
  }
}

export function stopMonitoringSummaryLabel(stop: StopMonitoringSource): string {
  const display = stopMonitoringDisplay(stop)
  if (display.company === '—' && display.account === '—') return 'No Monitoring'
  const parts = [display.company !== '—' ? display.company : null, display.account !== '—' ? `#${display.account}` : null]
    .filter(Boolean)
    .join(' · ')
  return parts ? `MONITORING: ${parts}` : 'No Monitoring'
}

export function stopHasMonitoring(stop: StopMonitoringSource): boolean {
  const display = stopMonitoringDisplay(stop)
  return display.company !== '—' || display.account !== '—'
}

/** First callable monitoring line (primary phone, secondary, or legacy sheet phone). */
export function stopMonitoringCallPhone(stop: StopMonitoringSource): string | null {
  const phone = stopMonitoringDisplay(stop).phones[0]?.trim()
  return phone || null
}

export function monitoringPhoneTelHref(phone: string): string {
  const normalized = phone.replace(/[^\d+]/g, '')
  return normalized ? `tel:${normalized}` : ''
}
