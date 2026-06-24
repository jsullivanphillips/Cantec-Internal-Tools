import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Alert, Button, Table } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import RunDetailsPrepareAnnualSchedulePill from './RunDetailsPrepareAnnualSchedulePill'
import RunDetailsPreparePriorMonthEditsPill from './RunDetailsPreparePriorMonthEditsPill'
import {
  prepRowAnnualDueForStop,
  prepRowShowsAnnualTestControl,
} from './prepAnnualSchedule'
import { monitoringCompanyDisplayName } from './MonitoringCompanySelect'
import {
  PrepCompactField,
  PrepCompanyField,
  PrepLongTextCell,
  PrepReadOnlyCompactField,
} from './RunDetailsPrepareFields'
import RunDetailsDeficiencyList from './RunDetailsDeficiencyList'
import { openDeficiencySummaries } from './runDetailsDeficiencyDisplay'
import {
  orderedLocationIdsFromPrepRows,
  reorderPrepRowsByLocationIds,
  renumberPrepRowStopNumbers,
  type RunDetailPrepRow,
} from './runDetailsLocationReview'
import {
  isOnHoldMonthlyLocation,
  type AnnualScheduleCheckLocation,
  type AnnualScheduleCheckStatus,
  type MonthlyRunDetailDeficiencySummary,
} from './monthlyRoutesShared'
import type { RunDetailsStopPatchApi } from './useRunDetailsStopPatch'
import { useMonitoringCompanies } from './useMonitoringCompanies'
import { apiJson } from '../../lib/apiClient'
import { locationDisplaySubline, locationPrimaryLabel } from './locationDisplay'
import { officeWorksheetPrepTableCssVars, stopIsOfficePrepSkipped } from './officeWorksheetTableShared'
import OfficeSkipSiteModal, { type OfficeSkipSitePayload } from './OfficeSkipSiteModal'
import { deletePrepSiteSkip, postPrepSiteSkip } from './prepSiteSkipApi'
import { deletePrepAnnualTest, postPrepAnnualTest } from './prepAnnualTestApi'
import { detailPatchFromWorksheetStop } from './runDetailsPrepPatch'
import type { MonthlyRunDetailLocation, TechnicianWorksheetRun } from './monthlyRoutesShared'

type PrepDragHandleProps = Pick<ReturnType<typeof useSortable>, 'attributes' | 'listeners'>

const PREP_FIELD_LAYOUT = 'office' as const

function PrepTableColGroup() {
  return (
    <colgroup>
      <col className="tw-office-col-stop" />
      <col className="tw-office-col-address" />
      <col className="tw-office-col-access" />
      <col className="tw-office-col-panel" />
      <col className="tw-office-col-monitoring" />
      <col className="tw-office-col-deficiencies" />
      <col className="tw-office-col-procedures" />
      <col className="tw-office-col-location-comments" />
      <col className="tw-office-col-office-comments" />
    </colgroup>
  )
}

function PrepTableHeaderRow() {
  return (
    <tr>
      <th className="tw-office-sticky tw-office-sticky-order">#</th>
      <th className="tw-office-sticky tw-office-sticky-address">Address</th>
      <th>Access</th>
      <th>Panel</th>
      <th>Monitoring</th>
      <th>Deficiencies</th>
      <th>Testing procedures</th>
      <th>Location comments</th>
      <th>Office comments</th>
    </tr>
  )
}

type PrepRowTone = 'skipped' | 'annual-due' | 'on-hold' | 'attention'

function prepRowTone(
  stop: RunDetailPrepRow['location'],
  annualDue: boolean,
  highlighted: boolean,
  onHold: boolean,
): PrepRowTone | null {
  if (stopIsOfficePrepSkipped(stop)) return 'skipped'
  if (highlighted) return 'attention'
  if (annualDue) return 'annual-due'
  if (onHold) return 'on-hold'
  return null
}

function prepRowClassName(tone: PrepRowTone | null): string | undefined {
  if (!tone) return 'tw-office-table-row'
  const modifier =
    tone === 'skipped'
      ? 'run-details-prep-office-row--skipped'
      : tone === 'annual-due'
        ? 'run-details-prep-office-row--annual'
        : tone === 'on-hold'
          ? 'run-details-prep-office-row--on-hold'
          : tone === 'attention'
            ? 'run-details-prep-office-row--attention'
            : ''
  return ['tw-office-table-row', modifier].filter(Boolean).join(' ')
}

function PrepStopOrderCell({
  stopNumber,
  showDragHandle,
  orderSaving,
  locationLabel,
  dragHandleProps,
}: {
  stopNumber: number
  showDragHandle: boolean
  orderSaving: boolean
  locationLabel: string
  dragHandleProps?: PrepDragHandleProps
}) {
  return (
    <div className="run-details-prep-office-stop-order-cell">
      {showDragHandle ? (
        <button
          type="button"
          className="btn btn-link p-0 text-muted run-details-prep-office-drag-handle"
          style={{ cursor: orderSaving ? 'not-allowed' : 'grab' }}
          disabled={orderSaving}
          aria-label={`Drag to reorder: ${locationLabel}`}
          {...(dragHandleProps?.attributes ?? {})}
          {...(dragHandleProps?.listeners ?? {})}
        >
          <i className="bi bi-grip-vertical" aria-hidden />
        </button>
      ) : null}
      <span className="run-details-prep-office-stop-num tabular-nums">{stopNumber}</span>
    </div>
  )
}

function SortableLocationPrepRows({
  locationRows,
  reorderEnabled,
  orderSaving,
  renderRow,
}: {
  locationRows: RunDetailPrepRow[]
  reorderEnabled: boolean
  orderSaving: boolean
  renderRow: (
    row: RunDetailPrepRow,
    options: {
      isPrimaryForLocation: boolean
      showDragHandle: boolean
      dragHandleProps?: PrepDragHandleProps
      setNodeRef?: (element: HTMLElement | null) => void
      style?: CSSProperties
    },
  ) => ReactNode
}) {
  const primary = locationRows[0]
  const locationId = primary?.location.location_id ?? 0
  const sortable = useSortable({
    id: locationId,
    disabled: !reorderEnabled || orderSaving,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.72 : undefined,
  }

  return (
    <>
      {locationRows.map((row, index) => {
        const isPrimary = index === 0
        return renderRow(row, {
          isPrimaryForLocation: isPrimary,
          showDragHandle: isPrimary && reorderEnabled,
          dragHandleProps: isPrimary
            ? { attributes: sortable.attributes, listeners: sortable.listeners }
            : undefined,
          setNodeRef: isPrimary ? sortable.setNodeRef : undefined,
          style: isPrimary ? style : undefined,
        })
      })}
    </>
  )
}

export default function RunDetailsPrepareTable({
  rows,
  routeId,
  monthDate,
  stopPatch,
  onDeficiencyUpdated,
  prepEditsDisabled = false,
  readyEditLocked = false,
  draftPrepSkipEnabled = false,
  onPrepSkipPatched,
  onRunPatched,
  reorderDisabled = false,
  onRouteOrderChanged,
  annualScheduleStatus = 'idle',
  annualScheduleByLocationId = null,
  onAnnualScheduleRefresh,
}: {
  rows: RunDetailPrepRow[]
  routeId: number
  monthDate: string
  stopPatch: RunDetailsStopPatchApi
  onDeficiencyUpdated?: (
    locationId: number,
    updated: MonthlyRunDetailDeficiencySummary,
  ) => void | Promise<void>
  prepEditsDisabled?: boolean
  /** Block edits while run is prepared (Ready) until returned to preparation. */
  readyEditLocked?: boolean
  /** Draft prep only: show Skip / Unskip on active sites. */
  draftPrepSkipEnabled?: boolean
  onPrepSkipPatched?: (locationId: number, patch: Partial<MonthlyRunDetailLocation>) => void
  onRunPatched?: (run: TechnicianWorksheetRun) => void
  reorderDisabled?: boolean
  onRouteOrderChanged?: (orderedLocationIds: number[]) => void | Promise<void>
  annualScheduleStatus?: AnnualScheduleCheckStatus
  annualScheduleByLocationId?: Record<number, AnnualScheduleCheckLocation> | null
  onAnnualScheduleRefresh?: () => void | Promise<void>
}) {
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null)
  const [optimisticRows, setOptimisticRows] = useState<RunDetailPrepRow[] | null>(null)
  const [orderSaving, setOrderSaving] = useState(false)
  const [orderError, setOrderError] = useState<string | null>(null)
  const [skipModalLocation, setSkipModalLocation] = useState<{
    locationId: number
    label: string
  } | null>(null)
  const [skipSubmitting, setSkipSubmitting] = useState(false)
  const [skipError, setSkipError] = useState<string | null>(null)
  const [unskipBusyLocationId, setUnskipBusyLocationId] = useState<number | null>(null)
  const [annualTestBusyLocationId, setAnnualTestBusyLocationId] = useState<number | null>(null)
  const [annualTestError, setAnnualTestError] = useState<string | null>(null)
  const { patchStop: commitStopPatch, patchStopForRow, error, isFieldSaving } = stopPatch
  const { companies, loading: companiesLoading, refresh, appendCompany } = useMonitoringCompanies()

  const reorderEnabled = !prepEditsDisabled && !reorderDisabled && !readyEditLocked
  const tableCssVars = useMemo(() => officeWorksheetPrepTableCssVars() as CSSProperties, [])

  useEffect(() => {
    setOptimisticRows(null)
    setOrderError(null)
  }, [routeId, monthDate])

  useEffect(() => {
    if (optimisticRows == null || orderSaving) return
    const serverIds = orderedLocationIdsFromPrepRows(rows)
    const optIds = orderedLocationIdsFromPrepRows(optimisticRows)
    if (
      serverIds.length === optIds.length &&
      serverIds.every((id, index) => id === optIds[index])
    ) {
      setOptimisticRows(null)
    }
  }, [rows, optimisticRows, orderSaving])

  const displayRows = optimisticRows ?? rows

  const locationBlocks = useMemo(() => {
    const blocks: RunDetailPrepRow[][] = []
    let current: RunDetailPrepRow[] = []
    let currentLocationId: number | null = null
    for (const row of displayRows) {
      const locationId = row.location.location_id
      if (currentLocationId !== locationId) {
        if (current.length > 0) blocks.push(current)
        current = [row]
        currentLocationId = locationId
      } else {
        current.push(row)
      }
    }
    if (current.length > 0) blocks.push(current)
    return blocks
  }, [displayRows])

  const sortableLocationIds = useMemo(
    () => orderedLocationIdsFromPrepRows(displayRows),
    [displayRows],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const persistRouteOrder = useCallback(
    async (orderedLocationIds: number[]) => {
      setOrderSaving(true)
      setOrderError(null)
      try {
        await apiJson<{ locations: unknown[] }>(
          `/api/monthly_routes/routes/${routeId}/location_order`,
          {
            method: 'PUT',
            body: JSON.stringify({ ordered_location_ids: orderedLocationIds }),
          },
        )
        await onRouteOrderChanged?.(orderedLocationIds)
      } catch {
        setOrderError('Unable to save stop order.')
        setOptimisticRows(null)
      } finally {
        setOrderSaving(false)
      }
    },
    [routeId, onRouteOrderChanged],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id || orderSaving || !reorderEnabled) return
      const activeId = Number(active.id)
      const overId = Number(over.id)
      if (!Number.isFinite(activeId) || !Number.isFinite(overId)) return
      const currentIds = orderedLocationIdsFromPrepRows(displayRows)
      const oldIndex = currentIds.indexOf(activeId)
      const newIndex = currentIds.indexOf(overId)
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
      const nextIds = [...currentIds]
      const [moved] = nextIds.splice(oldIndex, 1)
      nextIds.splice(newIndex, 0, moved)
      const nextRows = renumberPrepRowStopNumbers(reorderPrepRowsByLocationIds(displayRows, nextIds))
      setOptimisticRows(nextRows)
      void persistRouteOrder(nextIds)
    },
    [displayRows, orderSaving, persistRouteOrder, reorderEnabled],
  )

  const fieldKey = (locationId: number, suffix: string) => `${locationId}-${suffix}`

  const applyPrepSkipPatch = useCallback(
    (locationId: number, stop: Parameters<typeof detailPatchFromWorksheetStop>[0]) => {
      onPrepSkipPatched?.(locationId, detailPatchFromWorksheetStop(stop))
    },
    [onPrepSkipPatched],
  )

  const handleConfirmPrepSkip = useCallback(
    async (payload: OfficeSkipSitePayload) => {
      if (!skipModalLocation) return
      setSkipSubmitting(true)
      setSkipError(null)
      try {
        const body = await postPrepSiteSkip(routeId, skipModalLocation.locationId, monthDate, payload)
        applyPrepSkipPatch(skipModalLocation.locationId, body.stop)
        if (body.run) onRunPatched?.(body.run)
        setSkipModalLocation(null)
      } catch (e) {
        setSkipError(e instanceof Error ? e.message : 'Could not skip this site.')
      } finally {
        setSkipSubmitting(false)
      }
    },
    [applyPrepSkipPatch, monthDate, onRunPatched, routeId, skipModalLocation],
  )

  const handleUnskipSite = useCallback(
    async (locationId: number) => {
      setUnskipBusyLocationId(locationId)
      setSkipError(null)
      try {
        const body = await deletePrepSiteSkip(routeId, locationId, monthDate)
        applyPrepSkipPatch(locationId, body.stop)
      } catch (e) {
        setSkipError(e instanceof Error ? e.message : 'Could not unskip this site.')
      } finally {
        setUnskipBusyLocationId(null)
      }
    },
    [applyPrepSkipPatch, monthDate, routeId],
  )

  const handleApplyAnnualTest = useCallback(
    async (locationId: number) => {
      setAnnualTestBusyLocationId(locationId)
      setAnnualTestError(null)
      try {
        const body = await postPrepAnnualTest(routeId, locationId, monthDate)
        applyPrepSkipPatch(locationId, body.stop)
        if (body.run) onRunPatched?.(body.run)
        await onAnnualScheduleRefresh?.()
      } catch (e) {
        setAnnualTestError(e instanceof Error ? e.message : 'Could not force test for this site.')
      } finally {
        setAnnualTestBusyLocationId(null)
      }
    },
    [applyPrepSkipPatch, monthDate, onAnnualScheduleRefresh, onRunPatched, routeId],
  )

  const handleClearAnnualTest = useCallback(
    async (locationId: number) => {
      setAnnualTestBusyLocationId(locationId)
      setAnnualTestError(null)
      try {
        const body = await deletePrepAnnualTest(routeId, locationId, monthDate)
        applyPrepSkipPatch(locationId, body.stop)
        await onAnnualScheduleRefresh?.()
      } catch (e) {
        setAnnualTestError(e instanceof Error ? e.message : 'Could not clear annual test override.')
      } finally {
        setAnnualTestBusyLocationId(null)
      }
    },
    [applyPrepSkipPatch, monthDate, onAnnualScheduleRefresh, routeId],
  )

  const renderPrepRow = useCallback(
    (
      row: RunDetailPrepRow,
      options: {
        isPrimaryForLocation: boolean
        showDragHandle: boolean
        dragHandleProps?: PrepDragHandleProps
        setNodeRef?: (element: HTMLElement | null) => void
        style?: CSSProperties
      },
    ) => {
      const stop = row.location
      const locationLabel = row.location.location_label
      const primaryLabel = locationPrimaryLabel({
        label: stop.label,
        display_address: stop.display_address || locationLabel,
      })
      const addressSubline = locationDisplaySubline(
        { label: stop.label, display_address: stop.display_address || locationLabel },
        { primaryLabel },
      )
      const sid = stop.location_id
      const siteLabel = (stop.label || '').trim() || 'Primary testing location'
      const companyId = stop.monitoring_company_id ?? null
      const companyName =
        stop.monitoring_company_record?.name?.trim() ||
        stop.monitoring_company?.trim() ||
        monitoringCompanyDisplayName(companyId, companies, stop.monitoring_company)
      const openDeficiencies = openDeficiencySummaries(stop.deficiency_summaries)
      const multiSite = false
      const scheduleRow = annualScheduleByLocationId?.[sid] ?? null
      const annualDue = prepRowAnnualDueForStop(annualScheduleStatus, scheduleRow, stop)
      const fk = (suffix: string) => fieldKey(sid, suffix)
      const patchRow = patchStopForRow(stop.stop_number)
      const officeComment = (stop.office_job_comment || '').trim()
      const highlighted = officeComment.length > 0
      const onHold = isOnHoldMonthlyLocation(stop)
      const rowTone = prepRowTone(stop, annualDue, highlighted, onHold)
      const prepSkipped = stopIsOfficePrepSkipped(stop)
      const isActiveSite =
        (stop.status_normalized || 'active').trim().toLowerCase() === 'active'
      const showPrepActionControl =
        draftPrepSkipEnabled && options.isPrimaryForLocation && isActiveSite && !prepEditsDisabled
      const showAnnualTestControl =
        showPrepActionControl &&
        prepRowShowsAnnualTestControl(annualScheduleStatus, scheduleRow, stop)
      const showSkipControl = showPrepActionControl && !showAnnualTestControl
      const annualTestOverrideActive = Boolean(stop.annual_test_override)
      const fieldLayout = PREP_FIELD_LAYOUT

      return (
        <tr
          key={sid}
          ref={options.setNodeRef}
          style={options.style}
          className={prepRowClassName(rowTone)}
        >
          <td className="tw-office-sticky tw-office-sticky-order tw-office-sticky-order--neutral">
            <PrepStopOrderCell
              stopNumber={stop.stop_number}
              showDragHandle={options.showDragHandle}
              orderSaving={orderSaving}
              locationLabel={primaryLabel}
              dragHandleProps={options.dragHandleProps}
            />
          </td>
          <td className="tw-office-sticky tw-office-sticky-address">
            <div className="tw-office-address-cell">
              <div className="run-details-prep-office-address-head">
                <div className="run-details-prep-office-address-main">
                  <Link to={`/monthlies/locations/${stop.location_id}`} className="tw-office-location-link">
                    {primaryLabel}
                  </Link>
                  {addressSubline ? (
                    <div className="tw-office-address-subline text-muted small">{addressSubline}</div>
                  ) : null}
                </div>
                {showAnnualTestControl ? (
                  <Button
                    type="button"
                    variant="outline-primary"
                    size="sm"
                    className="run-details-prep-skip-btn"
                    disabled={annualTestBusyLocationId === sid || skipSubmitting}
                    onClick={() => void handleApplyAnnualTest(sid)}
                  >
                    {annualTestBusyLocationId === sid ? '…' : 'Test'}
                  </Button>
                ) : showSkipControl ? (
                  <Button
                    type="button"
                    variant="outline-secondary"
                    size="sm"
                    className="run-details-prep-skip-btn"
                    disabled={
                      skipSubmitting ||
                      unskipBusyLocationId === sid ||
                      annualTestBusyLocationId === sid
                    }
                    onClick={() => {
                      if (prepSkipped) {
                        void handleUnskipSite(sid)
                        return
                      }
                      if (annualTestOverrideActive) {
                        void handleClearAnnualTest(sid)
                        return
                      }
                      setSkipError(null)
                      setSkipModalLocation({ locationId: sid, label: primaryLabel })
                    }}
                  >
                    {unskipBusyLocationId === sid || annualTestBusyLocationId === sid
                      ? '…'
                      : prepSkipped
                        ? 'Unskip'
                        : 'Skip'}
                  </Button>
                ) : null}
              </div>
              {options.isPrimaryForLocation ? (
                <div className="run-details-prep-office-address-pills">
                  <RunDetailsPreparePriorMonthEditsPill location={stop} />
                  {onHold ? (
                    <span className="badge run-details-prep-badge run-details-prep-badge--on-hold">
                      On hold
                    </span>
                  ) : null}
                  <RunDetailsPrepareAnnualSchedulePill schedule={scheduleRow} />
                </div>
              ) : null}
              {multiSite ? (
                <div className="tw-office-site-subline">{siteLabel}</div>
              ) : null}
            </div>
          </td>
          <td className="tw-office-access-cell">
            <div className="tw-office-compact-field-list">
              <PrepCompactField
                fieldKey={fk('ring')}
                label="Ring"
                value={stop.ring || ''}
                saving={isFieldSaving(sid, fk('ring'))}
                activeKey={activeFieldKey}
                onActivate={setActiveFieldKey}
                disabled={prepEditsDisabled}
                readyEditLocked={readyEditLocked}
                layoutVariant={fieldLayout}
                onCommit={(next) =>
                  void patchRow(sid, fk('ring'), { ring: next.trim() || null }, { ring: stop.ring })
                }
              />
              <PrepCompactField
                fieldKey={fk('key')}
                label="Key #"
                value={stop.key_number || ''}
                saving={isFieldSaving(sid, fk('key'))}
                activeKey={activeFieldKey}
                onActivate={setActiveFieldKey}
                disabled={prepEditsDisabled}
                readyEditLocked={readyEditLocked}
                layoutVariant={fieldLayout}
                onCommit={(next) =>
                  void patchRow(
                    sid,
                    fk('key'),
                    { key_number: next.trim() || null },
                    { key_number: stop.key_number },
                  )
                }
              />
              <PrepCompactField
                fieldKey={fk('door')}
                label="Door code"
                value={stop.door_code || ''}
                saving={isFieldSaving(sid, fk('door'))}
                activeKey={activeFieldKey}
                onActivate={setActiveFieldKey}
                disabled={prepEditsDisabled}
                readyEditLocked={readyEditLocked}
                layoutVariant={fieldLayout}
                onCommit={(next) =>
                  void patchRow(
                    sid,
                    fk('door'),
                    { door_code: next.trim() || null },
                    { door_code: stop.door_code },
                  )
                }
              />
            </div>
          </td>
          <td className="tw-office-panel-cell">
            <div className="tw-office-compact-field-list">
              <PrepReadOnlyCompactField label="Panel" value={stop.panel} stacked wide />
              <PrepReadOnlyCompactField label="Panel location" value={stop.panel_location} stacked wide />
            </div>
          </td>
          <td className="tw-office-monitoring-cell">
            <div className="tw-office-compact-field-list">
              <PrepCompanyField
                fieldKey={fk('company')}
                label="Company"
                companyId={companyId}
                companyName={companyName}
                companies={companies}
                companiesLoading={companiesLoading}
                saving={isFieldSaving(sid, fk('company'))}
                activeKey={activeFieldKey}
                onActivate={setActiveFieldKey}
                disabled={prepEditsDisabled}
                readyEditLocked={readyEditLocked}
                layoutVariant={fieldLayout}
                stacked
                onCommit={(nextId) =>
                  void patchRow(
                    sid,
                    fk('company'),
                    { monitoring_company_id: nextId },
                    {
                      monitoring_company_id: stop.monitoring_company_id,
                      monitoring_company: stop.monitoring_company,
                      monitoring_company_record: stop.monitoring_company_record,
                    },
                  )
                }
                onCompanyCreated={(company) => {
                  appendCompany(company)
                  void refresh()
                }}
              />
              <PrepCompactField
                fieldKey={fk('account')}
                label="Account #"
                value={stop.monitoring_account_number || ''}
                saving={isFieldSaving(sid, fk('account'))}
                activeKey={activeFieldKey}
                onActivate={setActiveFieldKey}
                disabled={prepEditsDisabled}
                readyEditLocked={readyEditLocked}
                layoutVariant={fieldLayout}
                stacked
                wide
                onCommit={(next) =>
                  void patchRow(
                    sid,
                    fk('account'),
                    { monitoring_account_number: next.trim() || null },
                    { monitoring_account_number: stop.monitoring_account_number },
                  )
                }
              />
              <PrepCompactField
                fieldKey={fk('password')}
                label="Password"
                value={stop.monitoring_password || ''}
                saving={isFieldSaving(sid, fk('password'))}
                activeKey={activeFieldKey}
                onActivate={setActiveFieldKey}
                disabled={prepEditsDisabled}
                readyEditLocked={readyEditLocked}
                layoutVariant={fieldLayout}
                stacked
                wide
                onCommit={(next) =>
                  void patchRow(
                    sid,
                    fk('password'),
                    { monitoring_password: next.trim() || null },
                    { monitoring_password: stop.monitoring_password },
                  )
                }
              />
              <PrepCompactField
                fieldKey={fk('mon-notes')}
                label="Notes"
                value={stop.monitoring_notes || ''}
                saving={isFieldSaving(sid, fk('mon-notes'))}
                activeKey={activeFieldKey}
                onActivate={setActiveFieldKey}
                multiline
                stacked
                wide
                disabled={prepEditsDisabled}
                readyEditLocked={readyEditLocked}
                layoutVariant={fieldLayout}
                onCommit={(next) =>
                  void patchRow(
                    sid,
                    fk('mon-notes'),
                    { monitoring_notes: next.trim() || null },
                    { monitoring_notes: stop.monitoring_notes },
                  )
                }
              />
            </div>
          </td>
          <td className="run-details-prep-office-deficiency-cell">
            <RunDetailsDeficiencyList
              deficiencies={openDeficiencies}
              routeId={routeId}
              monthDate={monthDate}
              locationId={sid}
              compact
              readOnly={readyEditLocked}
              onDeficiencyUpdated={onDeficiencyUpdated}
              modalContext={{
                locationLabel: primaryLabel,
                stopNumber: stop.stop_number,
                siteLabel: multiSite ? siteLabel : undefined,
              }}
            />
          </td>
          <td className="tw-office-detail-cell">
            <PrepLongTextCell
              fieldKey={fk('procedures')}
              value={stop.testing_procedures || ''}
              saving={isFieldSaving(sid, fk('procedures'))}
              activeKey={activeFieldKey}
              onActivate={setActiveFieldKey}
              disabled={prepEditsDisabled}
              readyEditLocked={readyEditLocked}
              richText
              layoutVariant={fieldLayout}
              onCommit={(next) =>
                void patchRow(
                  sid,
                  fk('procedures'),
                  { testing_procedures: next },
                  { testing_procedures: stop.testing_procedures },
                )
              }
            />
          </td>
          <td className="tw-office-detail-cell">
            <PrepLongTextCell
              fieldKey={fk('loc-notes')}
              value={stop.inspection_tech_notes || ''}
              saving={isFieldSaving(sid, fk('loc-notes'))}
              activeKey={activeFieldKey}
              onActivate={setActiveFieldKey}
              disabled={prepEditsDisabled}
              readyEditLocked={readyEditLocked}
              richText
              layoutVariant={fieldLayout}
              onCommit={(next) =>
                void patchRow(
                  sid,
                  fk('loc-notes'),
                  { inspection_tech_notes: next },
                  { inspection_tech_notes: stop.inspection_tech_notes },
                )
              }
            />
          </td>
          <td className="tw-office-detail-cell">
            <PrepLongTextCell
              fieldKey={fk('office-job-comment')}
              value={stop.office_job_comment || ''}
              saving={isFieldSaving(sid, fk('office-job-comment'))}
              activeKey={activeFieldKey}
              onActivate={setActiveFieldKey}
              disabled={prepEditsDisabled}
              readyEditLocked={readyEditLocked}
              richText
              layoutVariant={fieldLayout}
              onCommit={(next) =>
                void patchRow(
                  sid,
                  fk('office-job-comment'),
                  { office_job_comment: next },
                  { office_job_comment: stop.office_job_comment },
                )
              }
            />
          </td>
        </tr>
      )
    },
    [
      activeFieldKey,
      annualScheduleByLocationId,
      annualScheduleStatus,
      appendCompany,
      commitStopPatch,
      companies,
      companiesLoading,
      isFieldSaving,
      draftPrepSkipEnabled,
      handleApplyAnnualTest,
      handleClearAnnualTest,
      handleUnskipSite,
      annualTestBusyLocationId,
      monthDate,
      onAnnualScheduleRefresh,
      onDeficiencyUpdated,
      orderSaving,
      patchStopForRow,
      prepEditsDisabled,
      readyEditLocked,
      refresh,
      routeId,
      skipSubmitting,
      unskipBusyLocationId,
    ],
  )

  if (rows.length === 0) {
    return <p className="monthly-run-detail-empty mb-0">No stops on this route yet.</p>
  }

  const tableBody = (
    <tbody>
      {locationBlocks.map((locationRows) => {
        const locationId = locationRows[0]?.location.location_id ?? 0
        if (reorderEnabled) {
          return (
            <SortableLocationPrepRows
              key={locationId}
              locationRows={locationRows}
              reorderEnabled={reorderEnabled}
              orderSaving={orderSaving}
              renderRow={renderPrepRow}
            />
          )
        }
        return locationRows.map((row, index) =>
          renderPrepRow(row, {
            isPrimaryForLocation: index === 0,
            showDragHandle: false,
          }),
        )
      })}
    </tbody>
  )

  const tableShell = (
    <div
      className={`tw-office-table-card tw-office-table-card--embedded${reorderEnabled ? ' run-details-prep-office-table--reorderable' : ''}`}
      style={tableCssVars}
    >
      <div className="tw-office-table-wrap">
        <Table size="sm" className="mb-0 tw-office-stop-table">
          <PrepTableColGroup />
          <thead>
            <PrepTableHeaderRow />
          </thead>
          {reorderEnabled ? (
            <SortableContext items={sortableLocationIds} strategy={verticalListSortingStrategy}>
              {tableBody}
            </SortableContext>
          ) : (
            tableBody
          )}
        </Table>
      </div>
    </div>
  )

  return (
    <div className="run-details-history-section run-details-prep-section">
      {(prepEditsDisabled || orderError || error || skipError || annualTestError) && (
        <div className="run-details-prep-section__alerts">
          {prepEditsDisabled ? (
            <Alert variant="warning" className="py-2 small mb-2">
              Close the current month&apos;s paperwork before editing a future month.
            </Alert>
          ) : null}
          {orderError ? (
            <Alert variant="warning" className="py-2 small mb-2">
              {orderError}
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="danger" className="py-2 small mb-2">
              {error}
            </Alert>
          ) : null}
          {skipError && !skipModalLocation ? (
            <Alert variant="danger" className="py-2 small mb-2">
              {skipError}
            </Alert>
          ) : null}
          {annualTestError ? (
            <Alert variant="danger" className="py-2 small mb-2">
              {annualTestError}
            </Alert>
          ) : null}
        </div>
      )}
      <div className="run-details-history-shell">
        {reorderEnabled ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            {tableShell}
          </DndContext>
        ) : (
          tableShell
        )}
      </div>
      <OfficeSkipSiteModal
        show={skipModalLocation != null}
        monthIso={monthDate}
        locationLabel={skipModalLocation?.label ?? ''}
        submitting={skipSubmitting}
        error={skipError}
        onClose={() => {
          if (skipSubmitting) return
          setSkipModalLocation(null)
          setSkipError(null)
        }}
        onConfirm={(payload) => void handleConfirmPrepSkip(payload)}
      />
    </div>
  )
}
