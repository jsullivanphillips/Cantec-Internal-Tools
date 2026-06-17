import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch, isAbortError } from '../lib/apiClient'
import { formatLongOrdinalDate } from '../lib/formatLongOrdinalDate'
import { Alert, Card, Form } from 'react-bootstrap'
import ServiceQuarterAllTimeInfo from '../features/mondayMeeting/ServiceQuarterAllTimeInfo'
import '../features/mondayMeeting/mondayMeeting.css'
import TechnicianMetricsPanel from '../features/technicianMeeting/TechnicianMetricsPanel'
import { type TopN } from '../features/technicianMeeting/technicianMetricsCharts'
import {
  ALL_TIME_MONTH_KEY,
  defaultTechnicianMonthKey,
  listTechnicianMonthSelectItems,
  technicianMeetingDateRangeParams,
} from '../features/technicianMeeting/technicianMeetingMonthDateRange'
import '../features/technicianMeeting/technicianMeeting.css'

export default function TechnicianMeetingPage() {
  const monthOptions = useMemo(() => listTechnicianMonthSelectItems(), [])
  const [selectedMonthKey, setSelectedMonthKey] = useState(defaultTechnicianMonthKey())
  const [techTopN, setTechTopN] = useState<TopN>(5)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [techData, setTechData] = useState<Record<string, unknown> | null>(null)

  const selectedMonth =
    monthOptions.find((option) => option.key === selectedMonthKey) ?? monthOptions[0]
  const start = selectedMonth?.startDate ?? ''
  const end = selectedMonth?.endDate ?? ''

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    const p = technicianMeetingDateRangeParams(start, end)
    try {
      const [lu, t] = await Promise.all([
        apiFetch(`/api/last_updated${p}`, { signal }).then((r) => r.json()),
        apiFetch(`/api/performance/technicians${p}`, { signal }).then((r) => r.json()),
      ])
      if (signal?.aborted) return
      setLastUpdated(typeof lu.last_updated === 'string' ? lu.last_updated : typeof lu.latest === 'string' ? lu.latest : null)
      setTechData(t)
    } catch (e) {
      if (isAbortError(e)) return
      console.error(e)
      setError('Failed to load technician metrics.')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [start, end])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  return (
    <div className="technician-meeting-page container-fluid py-3 px-2 d-flex flex-column gap-3">
      <Card className="app-surface-card">
        <Card.Body className="p-3 p-md-4">
          <h1 className="processing-page-title mb-1">Technician Meeting</h1>
          <p className="processing-page-subtitle mb-0">
            Technician performance metrics for the reporting month you choose.
          </p>
        </Card.Body>
      </Card>

      <div className="technician-meeting-shell app-surface-card">
        <div className="technician-meeting-content">
          <div className="technician-meeting-toolbar">
            <div className="technician-meeting-toolbar__group">
              <span className="technician-meeting-toolbar__label">Month</span>
              <div className="technician-meeting-month-select-wrap">
                <Form.Select
                  size="sm"
                  className="technician-meeting-month-control"
                  value={selectedMonthKey}
                  aria-label="Reporting month"
                  onChange={(e) => setSelectedMonthKey(e.target.value)}
                >
                  {monthOptions.map((item) => (
                    <option
                      key={item.key}
                      value={item.key}
                      className={item.type === 'year' ? 'technician-meeting-month-divider' : undefined}
                    >
                      {item.label}
                    </option>
                  ))}
                </Form.Select>
                {selectedMonthKey === ALL_TIME_MONTH_KEY ? (
                  <ServiceQuarterAllTimeInfo startDate={start} endDate={end} />
                ) : null}
              </div>
              <span className="technician-meeting-toolbar__label">Show</span>
              <Form.Select
                size="sm"
                className="technician-meeting-toolbar__select"
                value={techTopN === 'all' ? 'all' : String(techTopN)}
                aria-label="Number of technicians to show in charts"
                onChange={(e) => {
                  const v = e.target.value
                  setTechTopN(v === 'all' ? 'all' : Number(v))
                }}
              >
                <option value="5">Top 5</option>
                <option value="10">Top 10</option>
                <option value="25">Top 25</option>
                <option value="all">All</option>
              </Form.Select>
            </div>
            <span className="technician-meeting-toolbar__meta">
              Data last updated: {formatLongOrdinalDate(lastUpdated)}
            </span>
          </div>

          {error ? (
            <Alert variant="warning" className="technician-meeting-alert mb-0">
              Something went wrong loading this data. Try again, or pick a different month.
            </Alert>
          ) : null}

          {loading ? (
            <div className="technician-meeting-loading" aria-busy="true" aria-label="Loading technician metrics">
              <div className="spinner-border spinner-border-sm text-secondary" role="status">
                <span className="visually-hidden">Loading</span>
              </div>
            </div>
          ) : (
            <TechnicianMetricsPanel techData={techData} techTopN={techTopN} />
          )}
        </div>
      </div>
    </div>
  )
}
