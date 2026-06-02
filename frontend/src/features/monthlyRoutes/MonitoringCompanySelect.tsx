import { useMemo, useState } from 'react'
import { Form } from 'react-bootstrap'
import AddMonitoringCompanyModal from './AddMonitoringCompanyModal'
import { monitoringCompanyPhoneLines } from './monitoringCompaniesShared'
import type { MonitoringCompanySummary } from './monthlyRoutesShared'

export const ADD_MONITORING_COMPANY_VALUE = '__add_monitoring_company__'

type MonitoringCompanySelectProps = {
  companies: MonitoringCompanySummary[]
  value: number | null
  disabled?: boolean
  allowAdd?: boolean
  className?: string
  id?: string
  onChange: (companyId: number | null) => void
  onCompanyCreated?: (company: MonitoringCompanySummary) => void
}

export default function MonitoringCompanySelect({
  companies,
  value,
  disabled,
  allowAdd = true,
  className,
  id,
  onChange,
  onCompanyCreated,
}: MonitoringCompanySelectProps) {
  const [filter, setFilter] = useState('')
  const [addOpen, setAddOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return companies
    return companies.filter((row) => (row.name ?? '').toLowerCase().includes(q))
  }, [companies, filter])

  const handleSelect = (nextRaw: string) => {
    if (nextRaw === ADD_MONITORING_COMPANY_VALUE) {
      setAddOpen(true)
      return
    }
    if (!nextRaw) {
      onChange(null)
      return
    }
    const parsed = Number.parseInt(nextRaw, 10)
    onChange(Number.isNaN(parsed) ? null : parsed)
  }

  return (
    <>
      <div className="d-flex flex-column gap-2">
        <Form.Control
          size="sm"
          placeholder="Search companies"
          value={filter}
          disabled={disabled}
          onChange={(e) => setFilter(e.target.value)}
        />
        <Form.Select
          id={id}
          className={className}
          value={value != null ? String(value) : ''}
          disabled={disabled}
          onChange={(e) => handleSelect(e.target.value)}
        >
          <option value="">— No company —</option>
          {filtered.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name?.trim() || `Company #${row.id}`}
            </option>
          ))}
          {allowAdd ? <option value={ADD_MONITORING_COMPANY_VALUE}>Add new company…</option> : null}
        </Form.Select>
      </div>
      <AddMonitoringCompanyModal
        show={addOpen}
        onHide={() => setAddOpen(false)}
        onCreated={(company, _reused) => {
          onCompanyCreated?.(company)
          onChange(company.id)
        }}
      />
    </>
  )
}

export function monitoringCompanyDisplayName(
  companyId: number | null | undefined,
  companies: MonitoringCompanySummary[],
  fallback?: string | null,
): string {
  if (companyId != null) {
    const match = companies.find((row) => row.id === companyId)
    if (match?.name?.trim()) return match.name.trim()
  }
  return fallback?.trim() || '—'
}

export function monitoringCompanyPhonesText(company: MonitoringCompanySummary | null | undefined): string {
  const lines = monitoringCompanyPhoneLines(company)
  return lines.length > 0 ? lines.join(' · ') : ''
}
