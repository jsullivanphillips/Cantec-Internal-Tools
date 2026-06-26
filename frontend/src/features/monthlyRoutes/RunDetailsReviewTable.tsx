import { useCallback, useMemo, useState } from 'react'
import { Button, Table } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import LocationTicketsModal from './LocationTicketsModal'
import RunDetailsDeficiencyList from './RunDetailsDeficiencyList'
import type { RunDetailsDeficiencyModalContext } from './RunDetailsDeficiencyDetailModal'
import PortalDeficiencyModal, { type DeficiencyFormValues } from './PortalDeficiencyModal'
import { officeCreateDeficiency } from './officeStopSiteApi'
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
  runReviewLocationCellClass,
  runReviewLocationCellTone,
  runReviewLocationResultCardClass,
  runReviewOutcomeBadgeClass,
  runReviewOutcomeHeadline,
  officeReplacedPartRowClass,
  officeStopHasReplacedPart,
  type OfficeBillingStatus,
  type RunReviewLocationCellTone,
} from './officeRunReviewShared'
import type {
  MonthlyRunDetailDeficiencySummary,
  MonthlyRunDetailLocation,
  TechnicianWorksheetRun,
  TechnicianWorksheetLocation,
} from './monthlyRoutesShared'
import { runReviewDeficiencySummaries } from './runDetailsDeficiencyDisplay'
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
  tone,
  onStopUpdated,
  onOpenSite,
  onOpenTickets,
}: {
  row: RunDetailReviewRow
  monthDate: string
  routeId: number
  run: TechnicianWorksheetRun | null
  readOnly: boolean
  tone: RunReviewLocationCellTone
  onStopUpdated: (stop: TechnicianWorksheetLocation) => void | Promise<void>
  onOpenSite: (locationId: number) => void
  onOpenTickets?: (locationId: number, locationLabel: string) => void
}) {
  const stop = row.location
  const locationLabel = row.location.location_label
  const siteCount = 1
  const ws = locationStopAsWorksheetStop(stop, locationLabel)
  const headline = runReviewOutcomeHeadline(ws, monthDate)
  const badgeClass = runReviewOutcomeBadgeClass(ws, monthDate)
  const siteLabel = (stop.label || '').trim() || 'Primary testing location'
  const multiSite = siteCount > 1
  const canEditOutcome = !readOnly && canOfficeEditOutcomes(run)
  const outcomeVariant = headline ? 'review-pill' : 'soft'

  return (
    <div className="run-details-review-location-result-shell">
      <div
        className={`run-details-review-location-result-card ${runReviewLocationResultCardClass(tone)}`}
      >
        <div className="run-details-review-location-result">
          <Link
            to={`/monthlies/locations/${row.location.location_id}`}
            className="run-details-prepare-address-link run-details-review-location-result__address-link"
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
            <RunDetailsStopOutcomeSelect
              stop={ws}
              run={run}
              routeId={routeId}
              monthDate={monthDate}
              readOnly={readOnly}
              layout="review"
              reviewDisplay={{
                headline,
                outcomeVariant,
              }}
              onStopUpdated={onStopUpdated}
            />
          ) : headline ? (
            <div className="run-details-review-location-result__outcome">
              <RunReviewOutcomeLabel
                stop={ws}
                monthDate={monthDate}
                headline={headline}
                badgeClass={badgeClass}
                variant={outcomeVariant}
                className="run-details-review-location-result__outcome-label"
              />
            </div>
          ) : null}
          <div className="run-details-review-location-result__actions">
            <Button
              type="button"
              variant="outline-secondary"
              size="sm"
              className="run-details-review-location-result__action-btn"
              onClick={() => onOpenSite(stop.location_id)}
            >
              <i className="bi bi-geo-alt" aria-hidden />
              Details
            </Button>
            {onOpenTickets ? (
              <Button
                type="button"
                variant="outline-secondary"
                size="sm"
                className="run-details-review-location-result__action-btn"
                onClick={() => onOpenTickets(row.location.location_id, locationLabel)}
              >
                <i className="bi bi-ticket-perforated" aria-hidden />
                Tickets{row.openTickets > 0 ? ` (${row.openTickets})` : ''}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
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
  onStopMergedFromWorksheet: (stop: TechnicianWorksheetLocation, scope?: 'full' | 'deficiency') => void
  onDeficiencyUpdated?: (
    locationId: number,
    updated: MonthlyRunDetailDeficiencySummary,
  ) => void | Promise<void>
  onTicketsChanged?: () => void
}) {
  const [siteModalStopId, setSiteModalStopId] = useState<number | null>(null)
  const [addDeficiencyTarget, setAddDeficiencyTarget] = useState<{
    locationId: number
    hasServiceTradeLink: boolean
    modalContext: RunDetailsDeficiencyModalContext
  } | null>(null)
  const [ticketsModal, setTicketsModal] = useState<{
    locationId: number
    locationLabel: string
  } | null>(null)
  const [billingErrors, setBillingErrors] = useState<Record<number, string>>({})

  const readOnly = runDetailsOfficeReviewReadOnly(run)

  const handleAddDeficiencySave = useCallback(
    async (values: DeficiencyFormValues) => {
      if (!addDeficiencyTarget || readOnly) return
      const { locationId } = addDeficiencyTarget
      const updated = await officeCreateDeficiency(routeId, monthDate, locationId, {
        title: values.title,
        severity: values.severity,
        status: values.status,
        description: values.description || undefined,
        run_id: run?.id ?? null,
        service_line: values.serviceLine,
        create_on_service_trade: values.createOnServiceTrade,
      })
      onStopMergedFromWorksheet(updated, 'deficiency')
    },
    [addDeficiencyTarget, readOnly, routeId, monthDate, run?.id, onStopMergedFromWorksheet],
  )

  const siteModalHasServiceTradeLink = useMemo(() => {
    if (siteModalStopId == null) return false
    const loc = locations.find((row) => row.location_id === siteModalStopId)
    if (!loc) return false
    return loc.has_service_trade_link ?? loc.service_trade_site_location_id != null
  }, [siteModalStopId, locations])

  const rows = useMemo(() => flattenRunDetailReviewRows(locations), [locations])

  const billingRowMeta = useMemo(() => {
    const meta = new Map<number, { isFirst: boolean; rowSpan: number }>()
    const byLocation = new Map<number, RunDetailReviewRow[]>()
    for (const row of rows) {
      const list = byLocation.get(row.location.location_id) ?? []
      list.push(row)
      byLocation.set(row.location.location_id, list)
    }
    for (const locRows of byLocation.values()) {
      const span = locRows.length
      locRows.forEach((row, index) => {
        meta.set(row.location.location_id, { isFirst: index === 0, rowSpan: span })
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
              <th className="run-details-review-col-procedures">Testing procedures</th>
              <th className="run-details-review-col-location-comments">Location comments</th>
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
                const stop = row.location
    const locationLabel = row.location.location_label
    const siteCount = 1
    const locationId = row.location.location_id
    const billingStatus = row.location.billing_status
                const sid = stop.location_id
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
                const ws = locationStopAsWorksheetStop(stop, locationLabel)
                const locationCellTone = runReviewLocationCellTone(ws, monthDate)
                const hasServiceTradeLink =
                  stop.has_service_trade_link ??
                  stop.service_trade_site_location_id != null

                return (
                  <tr
                    key={sid}
                    className={[
                      `run-details-review-table-row run-details-review-table-row--${locationRowCounter % 2 === 0 ? 'even' : 'odd'}`,
                      officeReplacedPartRowClass(officeStopHasReplacedPart(stop)),
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <td className="run-details-prepare-sticky-order tabular-nums align-top run-details-review-stop-cell-td">
                      <div className="run-details-review-stop-cell">
                        <span className="run-details-prepare-stop-num">{stop.stop_number}</span>
                        {showBillingColumn && isFirstAtLocation ? (
                          <RunDetailsLocationBillingControl
                            layout="vertical"
                            billingStatus={billingStatus ?? null}
                            readOnly={readOnly}
                            error={billingErrors[locationId] ?? null}
                            onChange={(status) =>
                              void setBilling(locationId, status, billingStatus ?? null)
                            }
                          />
                        ) : null}
                      </div>
                    </td>
                    <td
                      className={`run-details-prepare-sticky-address align-middle run-details-review-location-cell ${runReviewLocationCellClass(locationCellTone)}`}
                    >
                      <ReviewLocationResultCell
                        row={row}
                        monthDate={monthDate}
                        routeId={routeId}
                        run={run}
                        readOnly={readOnly}
                        tone={locationCellTone}
                        onStopUpdated={onStopMergedFromWorksheet}
                        onOpenSite={setSiteModalStopId}
                        onOpenTickets={
                          isFirstAtLocation
                            ? (locId, label) =>
                                setTicketsModal({ locationId: locId, locationLabel: label })
                            : undefined
                        }
                      />
                    </td>
                    <td className="align-middle run-details-prepare-stack-cell run-details-review-stack-cell-td">
                      <div className="run-details-prepare-stack">
                        <ReviewReadonlyStackField label="Ring" value={stop.ring} />
                        <ReviewReadonlyStackField label="Key" value={stop.key_number} />
                        <ReviewReadonlyStackField label="Door" value={stop.door_code} />
                      </div>
                    </td>
                    <td className="align-middle run-details-prepare-stack-cell run-details-review-stack-cell-td">
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
                        locationId={sid}
                        compact
                        readOnly={readOnly}
                        onDeficiencyUpdated={onDeficiencyUpdated}
                        onAdd={
                          readOnly
                            ? undefined
                            : () =>
                                setAddDeficiencyTarget({
                                  locationId: sid,
                                  hasServiceTradeLink,
                                  modalContext: {
                                    locationLabel,
                                    stopNumber: stop.stop_number,
                                    siteLabel: multiSite ? siteLabel : undefined,
                                  },
                                })
                        }
                        showServiceTradeDeficiencies
                        hasServiceTradeLink={hasServiceTradeLink}
                        locationLabel={locationLabel}
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
                    <td className="align-top run-details-prepare-longtext-cell run-details-review-col-procedures">
                      <ReviewReadonlyCommentCell
                        stop={stop}
                        field="testing_procedures"
                        value={stop.testing_procedures}
                      />
                    </td>
                    <td className="align-top run-details-prepare-longtext-cell run-details-review-col-location-comments">
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
        show={siteModalStopId != null && ticketsModal == null}
        locationId={siteModalStopId}
        routeId={routeId}
        monthDate={monthDate}
        run={run}
        hasServiceTradeLink={siteModalHasServiceTradeLink}
        onHide={() => setSiteModalStopId(null)}
        stopPatch={stopPatch}
        onStopMergedFromWorksheet={onStopMergedFromWorksheet}
      />
      {ticketsModal ? (
        <LocationTicketsModal
          show
          routeId={routeId}
          locationId={ticketsModal.locationId}
          locationLabel={ticketsModal.locationLabel}
          monthDate={monthDate}
          onHide={() => setTicketsModal(null)}
          onTicketsChanged={onTicketsChanged}
        />
      ) : null}
      <PortalDeficiencyModal
        show={addDeficiencyTarget != null}
        mode="add"
        onHide={() => setAddDeficiencyTarget(null)}
        onSave={handleAddDeficiencySave}
        officeServiceTrade={
          addDeficiencyTarget
            ? { hasServiceTradeLink: addDeficiencyTarget.hasServiceTradeLink }
            : null
        }
      />
    </>
  )
}
