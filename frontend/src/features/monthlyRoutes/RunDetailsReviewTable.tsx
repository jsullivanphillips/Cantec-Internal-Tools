import { useCallback, useMemo, useState } from 'react'
import { Table } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import LocationTicketsModal from './LocationTicketsModal'
import RunDetailsDeficiencyList from './RunDetailsDeficiencyList'
import RunDetailsLocationBillingControl from './RunDetailsLocationBillingControl'
import RunDetailsStopSiteModal from './RunDetailsStopSiteModal'
import RunReviewOutcomeLabel from './RunReviewOutcomeLabel'
import RunDetailsStopOutcomeSelect from './RunDetailsStopOutcomeSelect'
import { monitoringCompanyDisplayName } from './MonitoringCompanySelect'
import {
  ReviewReadonlyCommentCell,
  ReviewReadonlyStackField,
} from './RunDetailsReviewReadonlyFields'
import {
  flattenRunDetailReviewRows,
  locationStopAsWorksheetStop,
  type RunDetailReviewRow,
} from './runDetailsLocationReview'
import {
  runReviewOutcomeBadgeClass,
  runReviewOutcomeHeadline,
  type OfficeBillingStatus,
} from './officeRunReviewShared'
import type {
  MonthlyRunDetailDeficiencySummary,
  MonthlyRunDetailLocation,
  TechnicianWorksheetRun,
  TechnicianWorksheetStop,
} from './monthlyRoutesShared'
import {
  runReviewDeficiencySummaries,
  stopShowsNoDeficienciesConfirmedPill,
} from './runDetailsDeficiencyDisplay'
import type { RunDetailsStopPatchApi } from './useRunDetailsStopPatch'
import { apiJson } from '../../lib/apiClient'
import { canOfficeEditOutcomes, runDetailsOfficeReviewReadOnly } from './runWorkflowShared'

type BillingPatchResponse = {
  ok: boolean
  location_id: number
  month_date: string
  billing_status: OfficeBillingStatus
}

function formatBillingPatchError(err: unknown): string {
  if (err && typeof err === 'object') {
    const o = err as { error?: unknown; code?: unknown }
    if (typeof o.error === 'string' && o.error.trim()) return o.error
    if (o.code === 'billing_before_field_end') {
      return 'Billing can be set after technicians end the field run.'
    }
  }
  if (typeof err === 'string' && err.trim()) return err
  return 'Failed to update billing.'
}

function ReviewLocationResultCell({
  row,
  monthDate,
  routeId,
  run,
  readOnly,
  onStopUpdated,
  onOpenSite,
  onOpenTickets,
}: {
  row: RunDetailReviewRow
  monthDate: string
  routeId: number
  run: TechnicianWorksheetRun | null
  readOnly: boolean
  onStopUpdated: (stop: TechnicianWorksheetStop) => void | Promise<void>
  onOpenSite: (testingSiteId: number) => void
  onOpenTickets?: (locationId: number, locationLabel: string) => void
}) {
  const { stop, locationLabel, siteCount } = row
  const ws = locationStopAsWorksheetStop(stop, locationLabel)
  const headline = runReviewOutcomeHeadline(ws, monthDate)
  const badgeClass = runReviewOutcomeBadgeClass(ws, monthDate)
  const siteLabel = (stop.label || '').trim() || 'Primary testing location'
  const multiSite = siteCount > 1
  const defCount = runReviewDeficiencySummaries(stop.deficiency_summaries, run).length
  const showNoDefPill = stopShowsNoDeficienciesConfirmedPill(stop, defCount)
  const canEditOutcome = !readOnly && canOfficeEditOutcomes(run)

  return (
    <div className="run-details-review-location-result">
      <Link
        to={`/monthlies/locations/${row.locationId}`}
        className="run-details-prepare-address-link"
        onClick={(e) => e.stopPropagation()}
      >
        {locationLabel}
      </Link>
      {multiSite ? (
        <div
          className={`run-details-prepare-site-label text-muted small${multiSite ? ' run-details-prepare-site-label--multi' : ''}`}
        >
          {siteLabel !== 'Primary testing location' ? siteLabel : `Site ${stop.stop_number}`}
        </div>
      ) : null}
      {canEditOutcome ? (
        <div className="run-details-review-location-result__outcome-edit">
          <RunDetailsStopOutcomeSelect
            stop={ws}
            run={run}
            routeId={routeId}
            monthDate={monthDate}
            readOnly={readOnly}
            onStopUpdated={onStopUpdated}
          />
          {showNoDefPill ? (
            <span className="run-details-stop-row__no-def-pill">No deficiencies confirmed</span>
          ) : null}
          <button
            type="button"
            className="btn btn-link btn-sm p-0 run-details-review-location-result__details-link"
            onClick={() => onOpenSite(stop.testing_site_id)}
          >
            Site details
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="run-details-review-location-result__outcome-btn"
          onClick={() => onOpenSite(stop.testing_site_id)}
        >
          {headline ? (
            <RunReviewOutcomeLabel
              stop={ws}
              monthDate={monthDate}
              headline={headline}
              badgeClass={badgeClass}
              className="run-details-review-location-result__outcome"
            />
          ) : (
            <span className="text-muted small">View site details</span>
          )}
          {showNoDefPill ? (
            <span className="run-details-stop-row__no-def-pill">No deficiencies confirmed</span>
          ) : null}
        </button>
      )}
      {onOpenTickets ? (
        <button
          type="button"
          className="btn btn-link btn-sm p-0 mt-1 run-details-review-tickets-link"
          onClick={() => onOpenTickets(row.locationId, locationLabel)}
        >
          Tickets{row.openTickets > 0 ? ` (${row.openTickets} open)` : ''}
        </button>
      ) : null}
    </div>
  )
}

export default function RunDetailsReviewTable({
  locations,
  monthDate,
  routeId,
  run,
  showBillingColumn,
  onBillingPatched,
  stopPatch,
  onStopMergedFromWorksheet,
  onDeficiencyUpdated,
  onTicketsChanged,
}: {
  locations: MonthlyRunDetailLocation[]
  monthDate: string
  routeId: number
  run: TechnicianWorksheetRun | null
  showBillingColumn: boolean
  onBillingPatched: (locationId: number, billingStatus: string) => void
  stopPatch: RunDetailsStopPatchApi
  onStopMergedFromWorksheet: (stop: TechnicianWorksheetStop, scope?: 'full' | 'deficiency') => void
  onDeficiencyUpdated?: (
    testingSiteId: number,
    updated: MonthlyRunDetailDeficiencySummary,
  ) => void | Promise<void>
  onTicketsChanged?: () => void
}) {
  const [siteModalStopId, setSiteModalStopId] = useState<number | null>(null)
  const [ticketModal, setTicketModal] = useState<{
    locationId: number
    locationLabel: string
  } | null>(null)
  const [billingErrors, setBillingErrors] = useState<Record<number, string>>({})

  const readOnly = runDetailsOfficeReviewReadOnly(run)

  const rows = useMemo(() => flattenRunDetailReviewRows(locations), [locations])

  const billingRowMeta = useMemo(() => {
    const meta = new Map<number, { isFirst: boolean; rowSpan: number }>()
    const byLocation = new Map<number, RunDetailReviewRow[]>()
    for (const row of rows) {
      const list = byLocation.get(row.locationId) ?? []
      list.push(row)
      byLocation.set(row.locationId, list)
    }
    for (const locRows of byLocation.values()) {
      const span = locRows.length
      locRows.forEach((row, index) => {
        meta.set(row.stop.testing_site_id, { isFirst: index === 0, rowSpan: span })
      })
    }
    return meta
  }, [rows])

  const setBilling = useCallback(
    async (locationId: number, billing_status: OfficeBillingStatus, previous: string | null) => {
      const current = (previous || '').trim().toLowerCase()
      const next = billing_status.trim().toLowerCase()
      if (current === next) return
      setBillingErrors((prev) => {
        const copy = { ...prev }
        delete copy[locationId]
        return copy
      })
      onBillingPatched(locationId, billing_status)
      try {
        const qs = new URLSearchParams({ month: monthDate })
        const res = await apiJson<BillingPatchResponse>(
          `/api/monthly_routes/routes/${routeId}/locations/${locationId}/billing_status?${qs.toString()}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ billing_status }),
          },
        )
        const serverStatus = (res.billing_status || billing_status).trim().toLowerCase()
        if (serverStatus !== next) {
          onBillingPatched(locationId, res.billing_status)
        }
      } catch (e) {
        onBillingPatched(locationId, previous ?? 'unset')
        setBillingErrors((prev) => ({
          ...prev,
          [locationId]: formatBillingPatchError(e),
        }))
      }
    },
    [routeId, monthDate, onBillingPatched],
  )

  if (rows.length === 0) {
    return <p className="monthly-run-detail-empty mb-0">No stops on this run.</p>
  }

  let locationRowCounter = -1
  let lastLocationId: number | null = null

  return (
    <>
      <div
        className={`run-details-prepare-table-shell run-details-review-table-shell${showBillingColumn ? ' run-details-review-table-shell--billing' : ''}`}
      >
        <Table size="sm" className="run-details-prepare-table run-details-review-table mb-0">
          <colgroup>
            <col className="run-details-prepare-col-stop" />
            <col className="run-details-prepare-col-address" />
            <col className="run-details-prepare-col-access" />
            <col className="run-details-prepare-col-monitoring" />
            <col className="run-details-prepare-col-deficiencies" />
            <col className="run-details-prepare-col-run-comments" />
            <col className="run-details-prepare-col-procedures" />
            <col className="run-details-prepare-col-location-comments" />
          </colgroup>
          <thead>
            <tr>
              <th className="run-details-prepare-sticky-order">
                {showBillingColumn ? '# / Billing' : '#'}
              </th>
              <th className="run-details-prepare-sticky-address">Location &amp; result</th>
              <th>Access</th>
              <th>Monitoring</th>
              <th>Deficiencies</th>
              <th>Job comments</th>
              <th>Testing procedures</th>
              <th>Location comments</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <p className="monthly-run-detail-empty mb-0">No stops on this run.</p>
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const { stop, locationLabel, siteCount, locationId, billingStatus } = row
                const sid = stop.testing_site_id
                if (locationId !== lastLocationId) {
                  locationRowCounter += 1
                  lastLocationId = locationId
                }
                const billingMeta = billingRowMeta.get(sid)
                const isFirstAtLocation = billingMeta?.isFirst ?? true
                const siteLabel = (stop.label || '').trim() || 'Primary testing location'
                const companyName =
                  stop.monitoring_company_record?.name?.trim() ||
                  stop.monitoring_company?.trim() ||
                  monitoringCompanyDisplayName(
                    stop.monitoring_company_id ?? null,
                    [],
                    stop.monitoring_company,
                  )
                const openDeficiencies = runReviewDeficiencySummaries(stop.deficiency_summaries, run)
                const multiSite = siteCount > 1

                return (
                  <tr
                    key={sid}
                    className={`run-details-review-table-row run-details-review-table-row--${locationRowCounter % 2 === 0 ? 'even' : 'odd'}`}
                  >
                    <td className="run-details-prepare-sticky-order tabular-nums align-top">
                      <div className="run-details-review-stop-cell">
                        <span className="run-details-prepare-stop-num">{stop.stop_number}</span>
                        {showBillingColumn && isFirstAtLocation ? (
                          <RunDetailsLocationBillingControl
                            layout="vertical"
                            billingStatus={billingStatus}
                            readOnly={readOnly}
                            error={billingErrors[locationId] ?? null}
                            onChange={(status) =>
                              void setBilling(locationId, status, billingStatus)
                            }
                          />
                        ) : null}
                      </div>
                    </td>
                    <td className="run-details-prepare-sticky-address align-top">
                      <ReviewLocationResultCell
                        row={row}
                        monthDate={monthDate}
                        routeId={routeId}
                        run={run}
                        readOnly={readOnly}
                        onStopUpdated={onStopMergedFromWorksheet}
                        onOpenSite={setSiteModalStopId}
                        onOpenTickets={
                          isFirstAtLocation
                            ? (locId, label) => setTicketModal({ locationId: locId, locationLabel: label })
                            : undefined
                        }
                      />
                    </td>
                    <td className="align-top run-details-prepare-stack-cell">
                      <div className="run-details-prepare-stack">
                        <ReviewReadonlyStackField label="Ring" value={stop.ring} />
                        <ReviewReadonlyStackField label="Key" value={stop.key_number} />
                        <ReviewReadonlyStackField label="Door" value={stop.door_code} />
                        <ReviewReadonlyStackField label="Annual month" value={stop.annual_month} />
                      </div>
                    </td>
                    <td className="align-top run-details-prepare-stack-cell">
                      <div className="run-details-prepare-stack">
                        <ReviewReadonlyStackField label="Company" value={companyName} />
                        <ReviewReadonlyStackField
                          label="Account #"
                          value={stop.monitoring_account_number}
                        />
                        <ReviewReadonlyStackField
                          label="Password"
                          value={stop.monitoring_password}
                        />
                        <ReviewReadonlyStackField
                          label="Notes"
                          value={stop.monitoring_notes}
                          multiline
                        />
                      </div>
                    </td>
                    <td className="align-top run-details-prepare-deficiency-cell">
                      <RunDetailsDeficiencyList
                        deficiencies={openDeficiencies}
                        routeId={routeId}
                        monthDate={monthDate}
                        testingSiteId={sid}
                        compact
                        readOnly={readOnly}
                        onDeficiencyUpdated={onDeficiencyUpdated}
                        modalContext={{
                          locationLabel,
                          stopNumber: stop.stop_number,
                          siteLabel: multiSite ? siteLabel : undefined,
                        }}
                      />
                    </td>
                    <td className="align-top run-details-prepare-longtext-cell">
                      <ReviewReadonlyCommentCell
                        stop={stop}
                        field="run_comments"
                        value={stop.run_comments}
                      />
                    </td>
                    <td className="align-top run-details-prepare-longtext-cell">
                      <ReviewReadonlyCommentCell
                        stop={stop}
                        field="testing_procedures"
                        value={stop.testing_procedures}
                      />
                    </td>
                    <td className="align-top run-details-prepare-longtext-cell">
                      <ReviewReadonlyCommentCell
                        stop={stop}
                        field="inspection_tech_notes"
                        value={stop.inspection_tech_notes}
                      />
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </Table>
      </div>

      <RunDetailsStopSiteModal
        show={siteModalStopId != null}
        testingSiteId={siteModalStopId}
        routeId={routeId}
        monthDate={monthDate}
        run={run}
        onHide={() => setSiteModalStopId(null)}
        stopPatch={stopPatch}
        onStopMergedFromWorksheet={onStopMergedFromWorksheet}
      />
      {ticketModal ? (
        <LocationTicketsModal
          show
          routeId={routeId}
          locationId={ticketModal.locationId}
          locationLabel={ticketModal.locationLabel}
          monthDate={monthDate}
          onHide={() => setTicketModal(null)}
          onTicketsChanged={onTicketsChanged}
        />
      ) : null}
    </>
  )
}
