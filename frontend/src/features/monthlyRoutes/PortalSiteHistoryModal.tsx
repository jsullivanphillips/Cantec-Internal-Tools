import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Modal } from 'react-bootstrap'
import { apiJson, isAbortError } from '../../lib/apiClient'
import PortalBootstrapIcon from './PortalBootstrapIcon'
import SiteTestHistoryModalBody from './SiteTestHistoryModalBody'
import { formatMonthHeader } from './monthlyBillingBoard'
import {
  addCalendarMonths,
  monthFirstIsoPacificToday,
} from './monthlyRoutesShared'
import { useSiteFieldSubmission } from './useSiteFieldSubmission'

export type PortalTestHistoryMonthCell = {
  route_id: number | null
  has_field_submission: boolean
  result_status: string | null
  skip_reason: string | null
  run_id: number | null
}

export type PortalTestHistoryIndex = {
  location_id: number
  monthly_route_id: number | null
  months: Record<string, PortalTestHistoryMonthCell>
  latest_submission_month: string | null
}

type Props = {
  show: boolean
  onHide: () => void
  locationId: number
  locationLabel: string
  currentRunMonthIso: string
  /** Current worksheet route id — last-resort fallback for route resolution. */
  currentRouteId: number
}

const PORTAL_HISTORY_PHONE_LAYOUT_MEDIA = '(max-width: 767.98px)'

function resolveRouteIdForMonth(
  index: PortalTestHistoryIndex | null,
  monthIso: string,
  currentRouteId: number,
): number | null {
  if (index == null) return currentRouteId
  const cell = index.months[monthIso]
  if (cell?.route_id != null) return cell.route_id
  if (index.monthly_route_id != null) return index.monthly_route_id
  return currentRouteId
}

export default function PortalSiteHistoryModal({
  show,
  onHide,
  locationId,
  locationLabel,
  currentRunMonthIso,
  currentRouteId,
}: Props) {
  const [index, setIndex] = useState<PortalTestHistoryIndex | null>(null)
  const [indexLoading, setIndexLoading] = useState(false)
  const [viewMonthIso, setViewMonthIso] = useState<string | null>(null)
  const [stackedCardsLayout, setStackedCardsLayout] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(PORTAL_HISTORY_PHONE_LAYOUT_MEDIA).matches : false,
  )

  const currentPacificMonth = useMemo(() => monthFirstIsoPacificToday(), [])

  useEffect(() => {
    const mediaQuery = window.matchMedia(PORTAL_HISTORY_PHONE_LAYOUT_MEDIA)
    const syncLayout = () => setStackedCardsLayout(mediaQuery.matches)
    syncLayout()
    mediaQuery.addEventListener('change', syncLayout)
    return () => mediaQuery.removeEventListener('change', syncLayout)
  }, [])

  useEffect(() => {
    if (!show) {
      setIndex(null)
      setIndexLoading(false)
      setViewMonthIso(null)
      return
    }

    const ac = new AbortController()
    setIndexLoading(true)

    void (async () => {
      try {
        const data = await apiJson<PortalTestHistoryIndex>(
          `/api/technician_portal/locations/${locationId}/test_history_index`,
          { signal: ac.signal },
        )
        if (ac.signal.aborted) return
        setIndex(data)
        setViewMonthIso(data.latest_submission_month ?? currentRunMonthIso)
      } catch (e) {
        if (isAbortError(e)) return
        if (!ac.signal.aborted) {
          setIndex(null)
          setViewMonthIso(currentRunMonthIso)
        }
      } finally {
        if (!ac.signal.aborted) setIndexLoading(false)
      }
    })()

    return () => ac.abort()
  }, [show, locationId, currentRunMonthIso])

  const routeId = useMemo(() => {
    if (viewMonthIso == null) return null
    return resolveRouteIdForMonth(index, viewMonthIso, currentRouteId)
  }, [index, viewMonthIso, currentRouteId])

  const submission = useSiteFieldSubmission({
    routeId,
    monthIso: viewMonthIso ?? '',
    locationId,
    enabled: show && viewMonthIso != null && !indexLoading,
  })

  const monthLabel = viewMonthIso ? formatMonthHeader(viewMonthIso) : ''
  const siteLabel = locationLabel.trim() || `Location ${locationId}`

  const canGoPrev = viewMonthIso != null && addCalendarMonths(viewMonthIso, -1) != null
  const canGoNext =
    viewMonthIso != null &&
    viewMonthIso < currentPacificMonth &&
    addCalendarMonths(viewMonthIso, 1) != null &&
    (addCalendarMonths(viewMonthIso, 1) ?? '') <= currentPacificMonth

  const goPrev = useCallback(() => {
    if (viewMonthIso == null) return
    const prev = addCalendarMonths(viewMonthIso, -1)
    if (prev) setViewMonthIso(prev)
  }, [viewMonthIso])

  const goNext = useCallback(() => {
    if (viewMonthIso == null) return
    const next = addCalendarMonths(viewMonthIso, 1)
    if (next && next <= currentPacificMonth) setViewMonthIso(next)
  }, [viewMonthIso, currentPacificMonth])

  if (!show) return null

  const bodySubmission = indexLoading
    ? { loading: true, stops: [], capturedAt: null, fieldWorkReopened: false, emptyMessage: null, noRoute: false }
    : submission

  return (
    <Modal
      show={show}
      onHide={onHide}
      centered
      size="xl"
      className="portal-site-history-modal"
      dialogClassName="portal-site-history-modal__dialog"
      contentClassName="portal-site-history-modal__content"
    >
      <Modal.Header closeButton className="portal-site-history-modal__header">
        <div className="portal-site-history-modal__header-inner">
          <Modal.Title className="portal-site-history-modal__title h6 mb-0">
            {siteLabel} — Test history
          </Modal.Title>
          <div className="portal-site-history-modal__nav" aria-label="Month navigation">
            <Button
              type="button"
              variant="outline-secondary"
              className="portal-site-history-modal__nav-btn"
              onClick={goPrev}
              disabled={!canGoPrev || indexLoading}
              aria-label="Previous month"
            >
              <PortalBootstrapIcon name="chevron-left" aria-hidden />
            </Button>
            <span className="portal-site-history-modal__nav-label">{monthLabel || '…'}</span>
            <Button
              type="button"
              variant="outline-secondary"
              className="portal-site-history-modal__nav-btn"
              onClick={goNext}
              disabled={!canGoNext || indexLoading}
              aria-label="Next month"
            >
              <PortalBootstrapIcon name="chevron-right" aria-hidden />
            </Button>
          </div>
        </div>
      </Modal.Header>
      <Modal.Body className="portal-site-history-modal__body monthly-run-detail-page">
        {viewMonthIso == null ? null : (
          <SiteTestHistoryModalBody
            monthIso={viewMonthIso}
            submission={bodySubmission}
            showBillingColumn={false}
            stackedCardsLayout={stackedCardsLayout}
          />
        )}
      </Modal.Body>
    </Modal>
  )
}
