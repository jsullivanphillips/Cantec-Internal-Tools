import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Form } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import { apiFetch, isAbortError } from '../../lib/apiClient'
import ExcludedDeficienciesModal from './ExcludedDeficienciesModal'
import { MondayMeetingServiceTabSkeleton } from './MondayMeetingTabSkeletons'
import MondayMeetingServiceMetricsView from './MondayMeetingServiceMetricsView'
import MondayMeetingServiceVisualsView from './MondayMeetingServiceVisualsView'
import {
  ALL_TIME_QUARTER_KEY,
  defaultServiceQuarterKey,
  listServiceQuarterSelectItems,
  serviceDateRangeParams,
} from './mondayMeetingServiceDateRange'
import ServiceQuarterAllTimeInfo from './ServiceQuarterAllTimeInfo'
import ServiceViewModeToggle, { useServiceViewMode } from './ServiceViewModeToggle'
import type { ServiceMetrics } from './serviceMetricsTypes'

export default function MondayMeetingServiceTab() {
  const quarterOptions = useMemo(() => listServiceQuarterSelectItems(), [])
  const [selectedQuarterKey, setSelectedQuarterKey] = useState(defaultServiceQuarterKey())
  const selectedQuarter =
    quarterOptions.find((option) => option.key === selectedQuarterKey) ?? quarterOptions[0]
  const start = selectedQuarter?.startDate ?? ''
  const end = selectedQuarter?.endDate ?? ''
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ServiceMetrics | null>(null)
  const [showExcludedModal, setShowExcludedModal] = useState(false)
  const [viewMode, setViewMode] = useServiceViewMode()

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/monday_meeting/service${serviceDateRangeParams(start, end)}`, { signal })
      if (!response.ok) throw new Error('load_failed')
      const payload = (await response.json()) as ServiceMetrics
      if (signal?.aborted) return
      setData(payload)
    } catch (e) {
      if (isAbortError(e)) return
      console.error(e)
      setError('load_failed')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [start, end])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const pipeline = data?.deficiency_pipeline
  const openExcludedModal = useCallback(() => setShowExcludedModal(true), [])

  return (
    <div className="monday-meeting-service-tab">
      <div className="monday-meeting-service-toolbar">
        <div className="monday-meeting-service-toolbar__group">
          <span className="monday-meeting-service-toolbar__label">Quarter</span>
          <div className="monday-meeting-service-quarter-select-wrap">
            <Form.Select
              size="sm"
              className="monday-meeting-service-quarter-control"
              value={selectedQuarterKey}
              aria-label="Reporting quarter"
              onChange={(e) => setSelectedQuarterKey(e.target.value)}
            >
              {quarterOptions.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </Form.Select>
            {selectedQuarterKey === ALL_TIME_QUARTER_KEY ? (
              <ServiceQuarterAllTimeInfo startDate={start} endDate={end} />
            ) : null}
          </div>
          <ServiceViewModeToggle value={viewMode} onChange={setViewMode} />
        </div>
        <Link
          to="/monday_meeting/service/admin"
          className="btn btn-outline-secondary btn-sm monday-meeting-service-admin-link"
        >
          <i className="bi bi-gear me-1" aria-hidden />
          Filter settings
        </Link>
      </div>

      {error ? (
        <Alert variant="warning" className="monday-meeting-service-alert mb-0">
          Something went wrong loading service metrics. Try again, or pick a different quarter.
        </Alert>
      ) : null}

      {pipeline?.classification?.needs_classification ? (
        <Alert variant="info" className="monday-meeting-service-alert mb-0">
          Non-quoteable filtering has not been run yet, so nothing is excluded. Open{' '}
          <Link to="/monday_meeting/service/admin">Filter settings</Link> and click{' '}
          <strong>Reclassify all deficiencies</strong> (or run the sync that updates deficiencies).
        </Alert>
      ) : null}

      {loading ? (
        <MondayMeetingServiceTabSkeleton includeToolbar={false} />
      ) : data ? (
        <>
          {viewMode === 'metrics' ? (
            <MondayMeetingServiceMetricsView data={data} onOpenExcludedModal={openExcludedModal} />
          ) : (
            <MondayMeetingServiceVisualsView data={data} onOpenExcludedModal={openExcludedModal} />
          )}

          <ExcludedDeficienciesModal
            show={showExcludedModal}
            onHide={() => setShowExcludedModal(false)}
            startDate={start}
            endDate={end}
            onEligibilityChanged={() => void load()}
          />
        </>
      ) : null}
    </div>
  )
}
