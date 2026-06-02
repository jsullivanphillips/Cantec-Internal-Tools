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
import { Alert, Table } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import { annualMonthHint, stopAnnualDueThisMonth } from './annualMonthHint'
import { monitoringCompanyDisplayName } from './MonitoringCompanySelect'
import {
  PrepCompactField,
  PrepCompanyField,
  PrepLongTextCell,
} from './RunDetailsPrepareFields'
import RunDetailsDeficiencyList from './RunDetailsDeficiencyList'
import { openDeficiencySummaries } from './runDetailsDeficiencyDisplay'
import {
  orderedLocationIdsFromPrepRows,
  priorMonthOutOfOrderHint,
  reorderPrepRowsByLocationIds,
  renumberPrepRowStopNumbers,
  type RunDetailPrepRow,
} from './runDetailsLocationReview'
import type { MonthlyRunDetailDeficiencySummary } from './monthlyRoutesShared'
import type { RunDetailsStopPatchApi } from './useRunDetailsStopPatch'
import { useMonitoringCompanies } from './useMonitoringCompanies'
import { apiJson } from '../../lib/apiClient'

type PrepDragHandleProps = Pick<ReturnType<typeof useSortable>, 'attributes' | 'listeners'>

function prepRowClassName(annualDue: boolean, highlighted: boolean): string | undefined {
  return (
    [
      annualDue ? 'run-details-prepare-row--annual' : '',
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
  const locationId = primary?.stop.location_id ?? 0
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
  reorderDisabled = false,
  onRouteOrderChanged,
}: {
  rows: RunDetailPrepRow[]
  routeId: number
  monthDate: string
  stopPatch: RunDetailsStopPatchApi
  onDeficiencyUpdated?: (
    testingSiteId: number,
    updated: MonthlyRunDetailDeficiencySummary,
  ) => void | Promise<void>
  prepEditsDisabled?: boolean
  reorderDisabled?: boolean
  onRouteOrderChanged?: () => void | Promise<void>
}) {
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null)
  const [optimisticRows, setOptimisticRows] = useState<RunDetailPrepRow[] | null>(null)
  const [orderSaving, setOrderSaving] = useState(false)
  const [orderError, setOrderError] = useState<string | null>(null)
  const { patchStop, error, isFieldSaving } = stopPatch
  const { companies, loading: companiesLoading, refresh, appendCompany } = useMonitoringCompanies()

  const reorderEnabled = !prepEditsDisabled && !reorderDisabled

  useEffect(() => {
    setOptimisticRows(null)
    setOrderError(null)
  }, [rows])

  const displayRows = optimisticRows ?? rows

  const locationBlocks = useMemo(() => {
    const blocks: RunDetailPrepRow[][] = []
    let current: RunDetailPrepRow[] = []
    let currentLocationId: number | null = null
    for (const row of displayRows) {
      const locationId = row.stop.location_id
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
        await onRouteOrderChanged?.()
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

  const fieldKey = (testingSiteId: number, suffix: string) => `${testingSiteId}-${suffix}`

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
      const { stop, locationLabel, siteCount } = row
      const sid = stop.testing_site_id
      const siteLabel = (stop.label || '').trim() || 'Primary testing location'
      const companyId = stop.monitoring_company_id ?? null
      const companyName =
        stop.monitoring_company_record?.name?.trim() ||
        stop.monitoring_company?.trim() ||
        monitoringCompanyDisplayName(companyId, companies, stop.monitoring_company)
      const openDeficiencies = openDeficiencySummaries(stop.deficiency_summaries)
      const multiSite = siteCount > 1
      const annualDue = stopAnnualDueThisMonth(stop, locationLabel, monthDate)
      const outOfOrderHint = priorMonthOutOfOrderHint(stop)
      const fk = (suffix: string) => fieldKey(sid, suffix)
      const officeComment = (stop.office_job_comment || '').trim()
      const highlighted = officeComment.length > 0

      return (
        <tr
          key={sid}
          ref={options.setNodeRef}
          style={options.style}
          className={prepRowClassName(annualDue, highlighted)}
        >
          <td className="run-details-prepare-sticky-order tabular-nums align-top">
            <PrepStopOrderCell
              stopNumber={stop.stop_number}
              showDragHandle={options.showDragHandle}
              orderSaving={orderSaving}
              locationLabel={locationLabel}
              dragHandleProps={options.dragHandleProps}
            />
          </td>
          <td className="run-details-prepare-sticky-address align-top">
            <Link
              to={`/monthlies/locations/${stop.location_id}`}
              className="run-details-prepare-address-link"
            >
              {locationLabel}
            </Link>
            {options.isPrimaryForLocation && outOfOrderHint ? (
              <span className="badge bg-warning text-dark mt-1 d-flex run-details-prep-badge run-details-prep-badge--out-of-order">
                <span className="run-details-prep-badge__body">
                  <span className="run-details-prep-badge__title">{outOfOrderHint.title}</span>
                  {outOfOrderHint.detail ? (
                    <span className="run-details-prep-badge__detail">{outOfOrderHint.detail}</span>
                  ) : null}
                </span>
                {!prepEditsDisabled ? (
                  <button
                    type="button"
                    className="run-details-prep-badge__dismiss btn-close btn-close-sm"
                    aria-label="Dismiss out-of-order hint"
                    disabled={isFieldSaving(sid, fk('dismiss-oof'))}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      void patchStop(
                        sid,
                        fk('dismiss-oof'),
                        { prior_month_out_of_order_dismissed: true },
                        {
                          prior_month_out_of_order: true,
                          prior_month_expected_stop_number:
                            stop.prior_month_expected_stop_number ?? null,
                          prior_month_out_of_order_dismissed: false,
                        },
                      )
                    }}
                  />
                ) : null}
              </span>
            ) : null}
            {options.isPrimaryForLocation && stop.prior_month_field_edits ? (
              <span className="badge bg-light text-dark border mt-1 d-block run-details-prep-badge">
                Edited last month
              </span>
            ) : null}
            {multiSite ? (
              <div
                className={`run-details-prepare-site-label text-muted small${multiSite ? ' run-details-prepare-site-label--multi' : ''}`}
              >
                {siteLabel}
              </div>
            ) : null}
          </td>
          <td className="align-top run-details-prepare-stack-cell">
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
                  void patchStop(sid, fk('ring'), { ring: next.trim() || null }, { ring: stop.ring })
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
                  void patchStop(
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
                  void patchStop(
                    sid,
                    fk('door'),
                    { door_code: next.trim() || null },
                    { door_code: stop.door_code },
                  )
                }
              />
              <PrepCompactField
                fieldKey={fk('annual')}
                label="Annual month"
                value={stop.annual_month || ''}
                saving={isFieldSaving(sid, fk('annual'))}
                activeKey={activeFieldKey}
                onActivate={setActiveFieldKey}
                hint={annualMonthHint(stop, locationLabel, monthDate) ?? undefined}
                disabled={prepEditsDisabled}
                onCommit={(next) =>
                  void patchStop(
                    sid,
                    fk('annual'),
                    { annual_month: next.trim() || null },
                    { annual_month: stop.annual_month },
                  )
                }
              />
            </div>
          </td>
          <td className="align-top run-details-prepare-stack-cell">
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
                  void patchStop(
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
                  void patchStop(
                    sid,
                    fk('account'),
                    { monitoring_account_number: next.trim() || null },
                    { monitoring_account_number: stop.monitoring_account_number },
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
                  void patchStop(
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
              testingSiteId={sid}
              compact
              onDeficiencyUpdated={onDeficiencyUpdated}
              modalContext={{
                locationLabel,
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
              onCommit={(next) =>
                void patchStop(
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
              onCommit={(next) =>
                void patchStop(
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
              onCommit={(next) =>
                void patchStop(
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
      appendCompany,
      companies,
      companiesLoading,
      isFieldSaving,
      monthDate,
      onDeficiencyUpdated,
      orderSaving,
      patchStop,
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
        const locationId = locationRows[0]?.stop.location_id ?? 0
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

  return (
    <div className="run-details-prepare-table-shell">
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
      <Table
        size="sm"
        className={`run-details-prepare-table mb-0${reorderEnabled ? ' run-details-prepare-table--reorderable' : ''}`}
      >
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
            <th className="run-details-prepare-sticky-order">#</th>
            <th className="run-details-prepare-sticky-address">Address</th>
            <th>Access</th>
            <th>Monitoring</th>
            <th>Deficiencies</th>
            <th>Office job comment</th>
            <th>Testing procedures</th>
            <th>Location comments</th>
          </tr>
        </thead>
        {reorderEnabled ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sortableLocationIds} strategy={verticalListSortingStrategy}>
              {tableBody}
            </SortableContext>
          </DndContext>
        ) : (
          tableBody
        )}
      </Table>
    </div>
  )
}
