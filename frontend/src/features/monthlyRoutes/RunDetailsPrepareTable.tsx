import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Alert, Table } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import { annualMonthHint } from './annualMonthHint'
import RunDetailsPrepareAnnualSchedulePill from './RunDetailsPrepareAnnualSchedulePill'
import {
  mergePrepAnnualScheduleRow,
  prepRowAnnualDueForStop,
} from './prepAnnualSchedule'
import { monitoringCompanyDisplayName } from './MonitoringCompanySelect'
import {
  PrepAnnualMonthField,
  PrepCompactField,
  PrepCompanyField,
  PrepLongTextCell,
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
import { shortStreetAddress } from './locationDisplay'

type PrepDragHandleProps = Pick<ReturnType<typeof useSortable>, 'attributes' | 'listeners'>

function PrepTableColGroup() {
  return (
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
  )
}

function PrepTableHeaderRow() {
  return (
    <tr>
      <th className="run-details-prepare-sticky-order">#</th>
      <th className="run-details-prepare-sticky-address">Address</th>
      <th>Access</th>
      <th>Monitoring</th>
      <th>Deficiencies</th>
      <th>Office job comment</th>
      <th>Testing procedures</th>
      <th>Location comments</th>
    </tr>
  )
}

function prepRowClassName(annualDue: boolean, highlighted: boolean, onHold: boolean): string | undefined {
  return (
    [
      onHold ? 'run-details-prepare-row--on-hold' : annualDue ? 'run-details-prepare-row--annual' : '',
      highlighted ? 'run-details-prepare-row--attention' : '',
    ]
      .filter(Boolean)
      .join(' ') || undefined
  )
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
    <div className="run-details-prepare-stop-order-cell">
      {showDragHandle ? (
        <button
          type="button"
          className="btn btn-link p-0 text-muted run-details-prepare-drag-handle"
          style={{ cursor: orderSaving ? 'not-allowed' : 'grab' }}
          disabled={orderSaving}
          aria-label={`Drag to reorder: ${locationLabel}`}
          {...(dragHandleProps?.attributes ?? {})}
          {...(dragHandleProps?.listeners ?? {})}
        >
          <i className="bi bi-grip-vertical fs-5" aria-hidden />
        </button>
      ) : null}
      <span className="run-details-prepare-stop-num">{stopNumber}</span>
    </div>
  )
}

function PrepRowDragPreview({ locationRows }: { locationRows: RunDetailPrepRow[] }) {
  const primary = locationRows[0]
  if (!primary) return null
  const stop = primary.location
  const label = shortStreetAddress(primary.location.location_label)
  const siteCount = locationRows.length

  return (
    <div className="run-details-prepare-drag-overlay" role="presentation">
      <span className="run-details-prepare-stop-num">{stop.stop_number}</span>
      <div className="run-details-prepare-drag-overlay__copy">
        <span className="run-details-prepare-drag-overlay__label">{label}</span>
        {siteCount > 1 ? (
          <span className="run-details-prepare-drag-overlay__meta">{siteCount} sites</span>
        ) : null}
      </div>
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
      isDragging?: boolean
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
    transition: sortable.isDragging ? undefined : sortable.transition,
    opacity: sortable.isDragging ? 0.22 : undefined,
  }

  return (
    <>
      {locationRows.map((row, index) => {
        const isPrimary = index === 0
        return renderRow(row, {
          isPrimaryForLocation: isPrimary,
          showDragHandle: isPrimary && reorderEnabled,
          isDragging: isPrimary && sortable.isDragging,
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
  reorderDisabled?: boolean
  onRouteOrderChanged?: (orderedLocationIds: number[]) => void | Promise<void>
  annualScheduleStatus?: AnnualScheduleCheckStatus
  annualScheduleByLocationId?: Record<number, AnnualScheduleCheckLocation> | null
  onAnnualScheduleRefresh?: () => void | Promise<void>
}) {
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null)
  const [activeDragLocationId, setActiveDragLocationId] = useState<number | null>(null)
  const [optimisticRows, setOptimisticRows] = useState<RunDetailPrepRow[] | null>(null)
  const [orderSaving, setOrderSaving] = useState(false)
  const [orderError, setOrderError] = useState<string | null>(null)
  const { patchStop: commitStopPatch, patchStopForRow, error, isFieldSaving } = stopPatch
  const { companies, loading: companiesLoading, refresh, appendCompany } = useMonitoringCompanies()

  const reorderEnabled = !prepEditsDisabled && !reorderDisabled

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

  const activeDragBlock = useMemo(() => {
    if (activeDragLocationId == null) return null
    return (
      locationBlocks.find(
        (block) => block[0]?.location.location_id === activeDragLocationId,
      ) ?? null
    )
  }, [activeDragLocationId, locationBlocks])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
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

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const id = Number(event.active.id)
    if (Number.isFinite(id)) setActiveDragLocationId(id)
  }, [])

  const handleDragCancel = useCallback(() => {
    setActiveDragLocationId(null)
  }, [])

  const handleDragEndWithOverlay = useCallback(
    (event: DragEndEvent) => {
      handleDragEnd(event)
      setActiveDragLocationId(null)
    },
    [handleDragEnd],
  )

  const fieldKey = (locationId: number, suffix: string) => `${locationId}-${suffix}`

  const renderPrepRow = useCallback(
    (
      row: RunDetailPrepRow,
      options: {
        isPrimaryForLocation: boolean
        showDragHandle: boolean
        isDragging?: boolean
        dragHandleProps?: PrepDragHandleProps
        setNodeRef?: (element: HTMLElement | null) => void
        style?: CSSProperties
      },
    ) => {
      const stop = row.location
    const locationLabel = row.location.location_label
      const displayLocationLabel = shortStreetAddress(locationLabel)
      const sid = stop.location_id
      const siteLabel = (stop.label || '').trim() || 'Primary testing location'
      const companyId = stop.monitoring_company_id ?? null
      const companyName =
        stop.monitoring_company_record?.name?.trim() ||
        stop.monitoring_company?.trim() ||
        monitoringCompanyDisplayName(companyId, companies, stop.monitoring_company)
      const openDeficiencies = openDeficiencySummaries(stop.deficiency_summaries)
      const multiSite = false
      const annualDue = prepRowAnnualDueForStop(
        annualScheduleStatus,
        annualScheduleByLocationId?.[sid] ?? null,
        stop.annual_month,
        monthDate,
      )
      const scheduleRow = mergePrepAnnualScheduleRow(
        annualScheduleByLocationId?.[sid] ?? null,
        stop.annual_month,
        monthDate,
      )
      const fk = (suffix: string) => fieldKey(sid, suffix)
      const patchRow = patchStopForRow(stop.stop_number)
      const officeComment = (stop.office_job_comment || '').trim()
      const highlighted = officeComment.length > 0
      const onHold = isOnHoldMonthlyLocation(stop)

      return (
        <tr
          key={sid}
          ref={options.setNodeRef}
          style={options.style}
          className={[
            prepRowClassName(annualDue, highlighted, onHold),
            options.isDragging ? 'run-details-prepare-row--dragging' : '',
          ]
            .filter(Boolean)
            .join(' ') || undefined}
        >
          <td className="run-details-prepare-sticky-order tabular-nums align-middle">
            <PrepStopOrderCell
              stopNumber={stop.stop_number}
              showDragHandle={options.showDragHandle}
              orderSaving={orderSaving}
              locationLabel={displayLocationLabel}
              dragHandleProps={options.dragHandleProps}
            />
          </td>
          <td className="run-details-prepare-sticky-address align-middle">
            <Link
              to={`/monthlies/locations/${stop.location_id}`}
              className="run-details-prepare-address-link"
            >
              {displayLocationLabel}
            </Link>
            {options.isPrimaryForLocation && stop.prior_month_field_edits ? (
              <span className="badge bg-light text-dark border mt-1 d-block run-details-prep-badge">
                Edited last month
              </span>
            ) : null}
            {options.isPrimaryForLocation && onHold ? (
              <span className="badge run-details-prep-badge run-details-prep-badge--on-hold mt-1 d-block">
                On hold
              </span>
            ) : null}
            {options.isPrimaryForLocation ? (
              <RunDetailsPrepareAnnualSchedulePill schedule={scheduleRow} />
            ) : null}
            {multiSite ? (
              <div
                className={`run-details-prepare-site-label text-muted small${multiSite ? ' run-details-prepare-site-label--multi' : ''}`}
              >
                {siteLabel}
              </div>
            ) : null}
          </td>
          <td className="align-middle run-details-prepare-stack-cell">
            <div className="run-details-prepare-stack">
              <PrepCompactField
                fieldKey={fk('ring')}
                label="Ring"
                value={stop.ring || ''}
                saving={isFieldSaving(sid, fk('ring'))}
                activeKey={activeFieldKey}
                onActivate={setActiveFieldKey}
                disabled={prepEditsDisabled}
                onCommit={(next) =>
                  void patchRow(sid, fk('ring'), { ring: next.trim() || null }, { ring: stop.ring })
                }
              />
              <PrepCompactField
                fieldKey={fk('key')}
                label="Key"
                value={stop.key_number || ''}
                saving={isFieldSaving(sid, fk('key'))}
                activeKey={activeFieldKey}
                onActivate={setActiveFieldKey}
                disabled={prepEditsDisabled}
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
                label="Door"
                value={stop.door_code || ''}
                saving={isFieldSaving(sid, fk('door'))}
                activeKey={activeFieldKey}
                onActivate={setActiveFieldKey}
                disabled={prepEditsDisabled}
                onCommit={(next) =>
                  void patchRow(
                    sid,
                    fk('door'),
                    { door_code: next.trim() || null },
                    { door_code: stop.door_code },
                  )
                }
              />
              <PrepAnnualMonthField
                fieldKey={fk('annual')}
                label="Annual month"
                value={stop.annual_month}
                saving={isFieldSaving(sid, fk('annual'))}
                activeKey={activeFieldKey}
                onActivate={setActiveFieldKey}
                hint={annualMonthHint(stop, locationLabel, monthDate) ?? undefined}
                disabled={prepEditsDisabled}
                onCommit={(next) =>
                  void commitStopPatch(
                    sid,
                    fk('annual'),
                    { annual_month: next.trim() || null },
                    { annual_month: stop.annual_month },
                    stop.stop_number,
                  ).then(() => onAnnualScheduleRefresh?.())
                }
              />
            </div>
          </td>
          <td className="align-middle run-details-prepare-stack-cell">
            <div className="run-details-prepare-stack">
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
                disabled={prepEditsDisabled}
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
          <td className="align-top run-details-prepare-deficiency-cell">
            <RunDetailsDeficiencyList
              deficiencies={openDeficiencies}
              routeId={routeId}
              monthDate={monthDate}
              locationId={sid}
              compact
              onDeficiencyUpdated={onDeficiencyUpdated}
              modalContext={{
                locationLabel: displayLocationLabel,
                stopNumber: stop.stop_number,
                siteLabel: multiSite ? siteLabel : undefined,
              }}
            />
          </td>
          <td className="align-top run-details-prepare-longtext-cell">
            <PrepLongTextCell
              fieldKey={fk('office-job-comment')}
              value={stop.office_job_comment || ''}
              saving={isFieldSaving(sid, fk('office-job-comment'))}
              activeKey={activeFieldKey}
              onActivate={setActiveFieldKey}
              disabled={prepEditsDisabled}
              richText
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
          <td className="align-top run-details-prepare-longtext-cell">
            <PrepLongTextCell
              fieldKey={fk('procedures')}
              value={stop.testing_procedures || ''}
              saving={isFieldSaving(sid, fk('procedures'))}
              activeKey={activeFieldKey}
              onActivate={setActiveFieldKey}
              disabled={prepEditsDisabled}
              richText
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
          <td className="align-top run-details-prepare-longtext-cell">
            <PrepLongTextCell
              fieldKey={fk('loc-notes')}
              value={stop.inspection_tech_notes || ''}
              saving={isFieldSaving(sid, fk('loc-notes'))}
              activeKey={activeFieldKey}
              onActivate={setActiveFieldKey}
              disabled={prepEditsDisabled}
              richText
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
      monthDate,
      onAnnualScheduleRefresh,
      onDeficiencyUpdated,
      orderSaving,
      patchStopForRow,
      prepEditsDisabled,
      refresh,
      routeId,
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

  const tableClassName = `run-details-prepare-table mb-0${reorderEnabled ? ' run-details-prepare-table--reorderable' : ''}`

  const tableShell = (
    <div className="run-details-prepare-table-shell">
      <Table size="sm" className={tableClassName}>
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
  )

  return (
    <div className="run-details-prep-section monthly-location-detail-surface">
      {(prepEditsDisabled || orderError || error) && (
        <div className="run-details-prepare-alerts">
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
        </div>
      )}
      {reorderEnabled ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragCancel={handleDragCancel}
          onDragEnd={handleDragEndWithOverlay}
        >
          {tableShell}
          <DragOverlay adjustScale={false} dropAnimation={null}>
            {activeDragBlock ? <PrepRowDragPreview locationRows={activeDragBlock} /> : null}
          </DragOverlay>
        </DndContext>
      ) : (
        tableShell
      )}
    </div>
  )
}
