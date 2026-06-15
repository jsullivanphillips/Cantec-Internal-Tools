import { useCallback, useEffect, useState } from 'react'
import { Alert, Badge, Table } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import {
  fetchDashboardIssues,
  type MonthlyDashboardIssueLocation,
} from './monthlyDashboardShared'
import { locationPrimaryLabel } from './locationDisplay'

function issueRouteLabel(row: MonthlyDashboardIssueLocation): string {
  const n = row.monthly_route?.route_number
  if (typeof n === 'number' && Number.isFinite(n)) return `R${n}`
  return (row.test_day || '').trim() || '—'
}

function statusBadgeVariant(status: string): string {
  const normalized = status.trim().toLowerCase()
  if (normalized === 'active') return 'success'
  if (normalized === 'cancelled') return 'secondary'
  if (normalized === 'on_hold' || normalized === 'on hold') return 'warning'
  if (normalized === 'waiting_keys' || normalized === 'waiting keys') return 'info'
  return 'light'
}

function statusLabel(status: string): string {
  const normalized = status.trim().toLowerCase()
  if (normalized === 'on_hold') return 'On hold'
  if (normalized === 'waiting_keys') return 'Waiting keys'
  return status.trim() || '—'
}

function IssuesSectionTable({
  title,
  rows,
  emptyMessage,
}: {
  title: string
  rows: MonthlyDashboardIssueLocation[]
  emptyMessage: string
}) {
  return (
    <section className="monthly-dashboard-issues-section mb-4">
      <h3 className="h5 mb-3">
        {title}
        <Badge bg="secondary" className="ms-2 tabular-nums">
          {rows.length}
        </Badge>
      </h3>
      {rows.length === 0 ? (
        <p className="text-muted mb-0">{emptyMessage}</p>
      ) : (
        <div className="table-responsive">
          <Table size="sm" hover className="mb-0 align-middle">
            <thead>
              <tr>
                <th>Site</th>
                <th>Route</th>
                <th>PMC</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link to={`/monthlies/locations/${row.id}`}>
                      {locationPrimaryLabel(row)}
                    </Link>
                  </td>
                  <td>{issueRouteLabel(row)}</td>
                  <td>{(row.property_management_company || '').trim() || '—'}</td>
                  <td>
                    <Badge bg={statusBadgeVariant(row.status_normalized)} className="text-capitalize">
                      {statusLabel(row.status_normalized)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </section>
  )
}

export default function MonthlyDashboardIssues() {
  const [missingServiceTrade, setMissingServiceTrade] = useState<MonthlyDashboardIssueLocation[]>(
    [],
  )
  const [missingPrice, setMissingPrice] = useState<MonthlyDashboardIssueLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadIssues = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const payload = await fetchDashboardIssues()
      setMissingServiceTrade(payload.missing_service_trade_link)
      setMissingPrice(payload.missing_price)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load issues.')
      setMissingServiceTrade([])
      setMissingPrice([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadIssues()
  }, [loadIssues])

  if (loading) {
    return <div className="text-muted">Loading issues…</div>
  }

  return (
    <section className="monthly-dashboard-issues" aria-label="Library data issues">
      {error ? (
        <Alert variant="danger" className="py-2 small">
          {error}
        </Alert>
      ) : null}
      <IssuesSectionTable
        title="Missing ServiceTrade link"
        rows={missingServiceTrade}
        emptyMessage="All active sites have a ServiceTrade link."
      />
      <IssuesSectionTable
        title="Missing price"
        rows={missingPrice}
        emptyMessage="All active sites have a price set."
      />
    </section>
  )
}
