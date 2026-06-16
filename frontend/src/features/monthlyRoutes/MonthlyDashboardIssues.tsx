import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Table } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import {
  fetchDashboardIssues,
  type MonthlyDashboardIssueLocation,
  type MonthlyDashboardIssuesPayload,
  type MonthlyDashboardIssueType,
} from './monthlyDashboardShared'
import { locationPrimaryLabel } from './locationDisplay'

const ISSUE_TYPE_ORDER: MonthlyDashboardIssueType[] = [
  'missing_service_trade_link',
  'missing_price',
  'missing_key_link',
]

const ISSUE_TYPE_META: Record<
  MonthlyDashboardIssueType,
  { label: string; variant: string; text?: string }
> = {
  missing_service_trade_link: { label: 'ServiceTrade link', variant: 'primary' },
  missing_price: { label: 'Missing price', variant: 'danger' },
  missing_key_link: { label: 'Key link', variant: 'warning', text: 'dark' },
}

type CombinedIssueRow = {
  location: MonthlyDashboardIssueLocation
  issues: MonthlyDashboardIssueType[]
}

function issueRouteLabel(row: MonthlyDashboardIssueLocation): string {
  const n = row.monthly_route?.route_number
  if (typeof n === 'number' && Number.isFinite(n)) return `R${n}`
  return (row.test_day || '').trim() || '—'
}

function issueRowSortKey(row: MonthlyDashboardIssueLocation): [number, string, number] {
  const routeNum = row.monthly_route?.route_number
  const routeKey = typeof routeNum === 'number' && Number.isFinite(routeNum) ? routeNum : 999_999
  return [routeKey, (row.address || '').toLowerCase(), row.id]
}

function buildCombinedIssueRows(payload: MonthlyDashboardIssuesPayload): CombinedIssueRow[] {
  const byId = new Map<number, { location: MonthlyDashboardIssueLocation; issues: MonthlyDashboardIssueType[] }>()

  const addRows = (rows: MonthlyDashboardIssueLocation[], issueType: MonthlyDashboardIssueType) => {
    for (const row of rows) {
      const existing = byId.get(row.id)
      if (existing) {
        if (!existing.issues.includes(issueType)) existing.issues.push(issueType)
      } else {
        byId.set(row.id, { location: row, issues: [issueType] })
      }
    }
  }

  addRows(payload.missing_service_trade_link, 'missing_service_trade_link')
  addRows(payload.missing_price, 'missing_price')
  addRows(payload.missing_key_link, 'missing_key_link')

  return Array.from(byId.values())
    .sort((a, b) => {
      const keyA = issueRowSortKey(a.location)
      const keyB = issueRowSortKey(b.location)
      if (keyA[0] !== keyB[0]) return keyA[0] - keyB[0]
      if (keyA[1] !== keyB[1]) return keyA[1].localeCompare(keyB[1])
      return keyA[2] - keyB[2]
    })
    .map(({ location, issues }) => ({
      location,
      issues: ISSUE_TYPE_ORDER.filter((issueType) => issues.includes(issueType)),
    }))
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

function IssueTypePill({ issueType }: { issueType: MonthlyDashboardIssueType }) {
  const meta = ISSUE_TYPE_META[issueType]
  return (
    <Badge
      bg={meta.variant}
      text={meta.text}
      pill
      className="monthly-dashboard-issues__pill"
    >
      {meta.label}
    </Badge>
  )
}

export default function MonthlyDashboardIssues() {
  const [issuesPayload, setIssuesPayload] = useState<MonthlyDashboardIssuesPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadIssues = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const payload = await fetchDashboardIssues()
      setIssuesPayload(payload)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load issues.')
      setIssuesPayload(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadIssues()
  }, [loadIssues])

  const rows = useMemo(
    () => (issuesPayload ? buildCombinedIssueRows(issuesPayload) : []),
    [issuesPayload],
  )

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

      <div className="monthly-dashboard-issues__header d-flex flex-wrap align-items-center gap-2 mb-3">
        <h3 className="h5 mb-0">Data issues</h3>
        <Badge bg="secondary" className="tabular-nums">
          {rows.length}
        </Badge>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted mb-0">
          No active sites are missing a ServiceTrade link, price, or key link.
        </p>
      ) : (
        <div className="table-responsive">
          <Table size="sm" hover className="mb-0 align-middle">
            <thead>
              <tr>
                <th>Site</th>
                <th>Route</th>
                <th>PMC</th>
                <th>Status</th>
                <th>Issue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ location, issues }) => (
                <tr key={location.id}>
                  <td>
                    <Link to={`/monthlies/locations/${location.id}`}>
                      {locationPrimaryLabel(location)}
                    </Link>
                  </td>
                  <td>{issueRouteLabel(location)}</td>
                  <td>{(location.property_management_company || '').trim() || '—'}</td>
                  <td>
                    <Badge bg={statusBadgeVariant(location.status_normalized)} className="text-capitalize">
                      {statusLabel(location.status_normalized)}
                    </Badge>
                  </td>
                  <td>
                    <div className="monthly-dashboard-issues__pill-group d-flex flex-wrap gap-1">
                      {issues.map((issueType) => (
                        <IssueTypePill key={issueType} issueType={issueType} />
                      ))}
                    </div>
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
