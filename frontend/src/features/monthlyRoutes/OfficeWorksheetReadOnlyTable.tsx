import { useCallback, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import { Table } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'
import {
  auditChangeForCompactLabel,
  auditChangeForLongTextField,
  groupOfficeWorksheetStops,
  groupOfficeWorksheetStopsInSubmissionOrder,
  officeAccessCellUpdated,
  notableStopInclusionReasons,
  officeAddressCellUpdated,
  officeMonitoringCellUpdated,
  officePanelCellUpdated,
  officeStopStatus,
  officeStopStatusLabel,
  officeWorksheetTableCssVars,
  computeOfficeWorksheetChangeColumnVisibility,
  OFFICE_WORKSHEET_ALL_CHANGE_COLUMNS_VISIBLE,
  renderFieldChangeInline,
  stopHasRunComments,
  shouldShowWorksheetTimeOutRow,
  worksheetReadOnlyDisplay,
  worksheetSkipReasonDisplayBlock,
  worksheetSkipReasonDuplicatesTimeInNote,
  worksheetTimeInOutDisplayLine,
  type OfficeFieldChange,
  type OfficeStopStatus,
  type OfficeWorksheetChangeColumnVisibility,
} from './officeWorksheetTableShared'
import { locationPrimaryLabel, locationDisplaySubline } from './locationDisplay'
import { stopMonitoringDisplay } from './stopMonitoringDisplay'
import { stopHasNewCommentField, type RunDetailNewCommentField } from './runDetailsLocationReview'

function officeCellClassName(updated: boolean | undefined, extra = ''): string {
  const base = `tw-office-detail-cell${extra ? ` ${extra}` : ''}`
  return updated ? `${base} tw-office-cell--updated` : base
}

function OfficeCompactField({
  label,
  value,
  change,
  wide,
}: {
  label: string
  value: string | null | undefined
  change?: OfficeFieldChange
  wide?: boolean
}) {
  const displayValue = worksheetReadOnlyDisplay(value)
  const empty = displayValue === '—' && !change
  return (
    <div
      className={`tw-office-compact-field${wide ? ' tw-office-compact-field--wide' : ''}${empty ? ' tw-office-compact-field--empty' : ''}${change ? ' tw-office-compact-field--changed' : ''}`}
    >
      <span className="tw-office-compact-label">{label}</span>
      {change ? (
        <span className="tw-office-compact-value tw-office-field-change">{renderFieldChangeInline(change)}</span>
      ) : (
        <span className="tw-office-compact-value">{displayValue}</span>
      )}
    </div>
  )
}

function OfficeStatusPill({
  status,
  closedRun,
}: {
  status: OfficeStopStatus
  closedRun?: boolean
}) {
  return (
    <span className={`tw-office-status-pill tw-office-status-pill--${status}`}>
      {officeStopStatusLabel(status, { closedRun })}
    </span>
  )
}

function OfficeStopColGroup({ columns }: { columns: OfficeWorksheetChangeColumnVisibility }) {
  return (
    <colgroup>
      <col className="tw-office-col-stop" />
      <col className="tw-office-col-address" />
      <col className="tw-office-col-result" />
      {columns.access ? <col className="tw-office-col-access" /> : null}
      {columns.panel ? <col className="tw-office-col-panel" /> : null}
      {columns.monitoring ? <col className="tw-office-col-monitoring" /> : null}
      {columns.procedures ? <col className="tw-office-col-procedures" /> : null}
      {columns.locationComments ? <col className="tw-office-col-location-comments" /> : null}
      {columns.runComments ? <col className="tw-office-col-run-comments" /> : null}
    </colgroup>
  )
}

function OfficeTableHeaderRow({ columns }: { columns: OfficeWorksheetChangeColumnVisibility }) {
  return (
    <tr>
      <th className="tw-office-sticky tw-office-sticky-order">#</th>
      <th className="tw-office-sticky tw-office-sticky-address">Address</th>
      <th className="tw-office-sticky tw-office-sticky-result">Result</th>
      {columns.access ? <th>Access</th> : null}
      {columns.panel ? <th>Panel</th> : null}
      {columns.monitoring ? <th>Monitoring</th> : null}
      {columns.procedures ? <th>Testing procedures</th> : null}
      {columns.locationComments ? <th>Location comments</th> : null}
      {columns.runComments ? <th>Job comments</th> : null}
    </tr>
  )
}

function OfficeLongTextCell({
  stop,
  locationId,
  fieldKey,
  fieldChangesByLocation,
  highlightUpdatedCells,
  highlightNewComments,
}: {
  stop: TechnicianWorksheetLocation
  locationId: number
  fieldKey: RunDetailNewCommentField
  fieldChangesByLocation?: Map<number, OfficeFieldChange[]>
  highlightUpdatedCells?: boolean
  highlightNewComments?: boolean
}) {
  const change = auditChangeForLongTextField(locationId, fieldKey, fieldChangesByLocation)
  const showPresentRunComment =
    fieldKey === 'run_comments' && highlightUpdatedCells && stopHasRunComments(stop) && change == null
  const highlightNew =
    highlightNewComments &&
    stopHasNewCommentField(stop, fieldKey) &&
    worksheetReadOnlyDisplay(stop[fieldKey]) !== '—'
  
  let inner: ReactNode
  if (change && !highlightUpdatedCells) {
    inner = <span className="tw-office-field-change">{renderFieldChangeInline(change)}</span>
  } else if (change && highlightUpdatedCells) {
    inner = <span className="tw-office-cell-updated-value">{renderFieldChangeInline(change)}</span>
  } else if (showPresentRunComment) {
    inner = <span className="tw-office-cell-updated-value">{worksheetReadOnlyDisplay(stop.run_comments)}</span>
  } else {
    inner = <>{worksheetReadOnlyDisplay(stop[fieldKey])}</>
  }

  if (highlightNew) {
    return <span className="tw-office-long-text-new">{inner}</span>
  }
  return inner
}

function OfficeStopTableRow({
  stop,
  monthDate,
  fieldChangesByLocation,
  columns,
  neutralStopNumbers,
  highlightUpdatedCells,
  highlightNewComments,
  closedRun,
}: {
  stop: TechnicianWorksheetLocation
  monthDate: string
  fieldChangesByLocation?: Map<number, OfficeFieldChange[]>
  columns: OfficeWorksheetChangeColumnVisibility
  neutralStopNumbers?: boolean
  highlightUpdatedCells?: boolean
  highlightNewComments?: boolean
  closedRun?: boolean
}) {
  const status = officeStopStatus(stop, monthDate)
  const skipReasonDisplayBlock = worksheetSkipReasonDisplayBlock(stop.skip_reason)
  const displayTimeIn = (stop.time_in || '').trim()
  const displayTimeOut = (stop.time_out || '').trim()
  const showWorksheetTimeInLine =
    displayTimeIn.length > 0 &&
    !worksheetSkipReasonDuplicatesTimeInNote(skipReasonDisplayBlock, stop.result_status, displayTimeIn)
  const showWorksheetTimeOutLine =
    displayTimeOut.length > 0 && shouldShowWorksheetTimeOutRow(displayTimeIn, displayTimeOut)
  const primaryLabel = locationPrimaryLabel(stop)
  const addressSubline = locationDisplaySubline(stop, { primaryLabel })
  const buildingDisplay = (() => {
    const raw = (stop.building_name ?? '').trim()
    if (!raw) return null
    if (raw.toLowerCase() === primaryLabel.trim().toLowerCase()) return null
    return raw
  })()
  const timeSummaryParts = [
    showWorksheetTimeInLine ? worksheetTimeInOutDisplayLine('in', displayTimeIn) : null,
    showWorksheetTimeOutLine ? worksheetTimeInOutDisplayLine('out', displayTimeOut) : null,
  ].filter((part): part is string => part != null)
  const resultDetailLines = [
    skipReasonDisplayBlock != null && status !== 'pending' ? skipReasonDisplayBlock : null,
    timeSummaryParts.length > 0 ? timeSummaryParts.join(' · ') : null,
  ].filter((part): part is string => part != null)
  if (resultDetailLines.length === 0) resultDetailLines.push('No times recorded')

  const lid = stop.location_id
  const accessUpdated = highlightUpdatedCells && officeAccessCellUpdated(lid, fieldChangesByLocation)
  const panelUpdated = highlightUpdatedCells && officePanelCellUpdated(lid, fieldChangesByLocation)
  const monitoringUpdated =
    highlightUpdatedCells && officeMonitoringCellUpdated(lid, fieldChangesByLocation)
  const proceduresUpdated =
    highlightUpdatedCells &&
    auditChangeForLongTextField(lid, 'testing_procedures', fieldChangesByLocation) != null
  const locationCommentsUpdated =
    highlightUpdatedCells &&
    auditChangeForLongTextField(lid, 'inspection_tech_notes', fieldChangesByLocation) != null
  const runCommentsUpdated =
    highlightUpdatedCells &&
    (auditChangeForLongTextField(lid, 'run_comments', fieldChangesByLocation) != null ||
      stopHasRunComments(stop))
  const addressUpdated =
    highlightUpdatedCells && officeAddressCellUpdated(lid, fieldChangesByLocation)
  const resultUpdated =
    highlightUpdatedCells && (status === 'skipped' || status === 'annual')
  const inclusionTitle =
    highlightUpdatedCells && neutralStopNumbers
      ? notableStopInclusionReasons(stop, monthDate, fieldChangesByLocation).join(' · ')
      : undefined

  const orderCellClass = neutralStopNumbers
    ? 'tw-office-sticky tw-office-sticky-order tw-office-sticky-order--neutral tabular-nums'
    : 'tw-office-sticky tw-office-sticky-order tabular-nums'

  return (
    <tr className={`tw-office-table-row tw-office-table-row--${status}`} title={inclusionTitle}>
      <td className={orderCellClass}>{stop.stop_number}</td>
      <td
        className={officeCellClassName(
          addressUpdated,
          'tw-office-sticky tw-office-sticky-address',
        )}
      >
        <div className="tw-office-address-cell">
          <Link to={`/monthlies/locations/${lid}`} className="tw-office-location-link">
            {primaryLabel}
          </Link>
          <div className="tw-office-address-meta">
            {addressUpdated && auditChangeForCompactLabel(lid, 'Building', fieldChangesByLocation) ? (
              <span className="tw-office-cell-updated-value">
                {renderFieldChangeInline(
                  auditChangeForCompactLabel(lid, 'Building', fieldChangesByLocation)!,
                )}
              </span>
            ) : (
              <span>{worksheetReadOnlyDisplay(buildingDisplay)}</span>
            )}
            {addressUpdated && auditChangeForCompactLabel(lid, 'PMC', fieldChangesByLocation) ? (
              <span className="tw-office-cell-updated-value">
                {renderFieldChangeInline(
                  auditChangeForCompactLabel(lid, 'PMC', fieldChangesByLocation)!,
                )}
              </span>
            ) : (
              <span>{worksheetReadOnlyDisplay(stop.property_management_company)}</span>
            )}
          </div>
          {addressSubline ? (
            <div className="tw-office-address-subline text-muted small">{addressSubline}</div>
          ) : null}
        </div>
      </td>
      <td className={officeCellClassName(resultUpdated, 'tw-office-sticky tw-office-sticky-result')}>
        <div className="tw-office-result-cell">
          <OfficeStatusPill status={status} closedRun={closedRun} />
          {resultDetailLines.map((line, index) => (
            <div key={`${index}:${line}`} className="tw-office-result-detail">
              {line}
            </div>
          ))}
        </div>
      </td>
      {columns.access ? (
        <td className={officeCellClassName(accessUpdated, 'tw-office-access-cell')}>
          <div className="tw-office-compact-field-list">
            <OfficeCompactField
              label="Ring"
              value={stop.ring}
              change={auditChangeForCompactLabel(lid, 'Ring', fieldChangesByLocation)}
            />
            <OfficeCompactField
              label="Key #"
              value={stop.key_number}
              change={auditChangeForCompactLabel(lid, 'Key #', fieldChangesByLocation)}
            />
            <OfficeCompactField
              label="Door code"
              value={stop.door_code}
              change={auditChangeForCompactLabel(lid, 'Door code', fieldChangesByLocation)}
            />
            <OfficeCompactField
              label="Annual"
              value={stop.annual_month}
              change={auditChangeForCompactLabel(lid, 'Annual', fieldChangesByLocation)}
            />
          </div>
        </td>
      ) : null}
      {columns.panel ? (
        <td className={officeCellClassName(panelUpdated)}>
          <div className="tw-office-compact-field-list">
            <OfficeCompactField
              label="Panel"
              value={stop.panel}
              change={auditChangeForCompactLabel(lid, 'Panel', fieldChangesByLocation)}
            />
            <OfficeCompactField
              label="Panel location"
              value={stop.panel_location}
              change={auditChangeForCompactLabel(lid, 'Panel location', fieldChangesByLocation)}
            />
          </div>
        </td>
      ) : null}
      {columns.monitoring ? (
        <td className={officeCellClassName(monitoringUpdated)}>
          <div className="tw-office-compact-field-list">
            {(() => {
              const monitoring = stopMonitoringDisplay(stop)
              return (
                <>
                  <OfficeCompactField
                    label="Company"
                    value={monitoring.company}
                    change={auditChangeForCompactLabel(lid, 'Company', fieldChangesByLocation)}
                  />
                  <OfficeCompactField
                    label="Account #"
                    value={monitoring.account}
                    change={auditChangeForCompactLabel(lid, 'Account #', fieldChangesByLocation)}
                  />
                  <OfficeCompactField
                    label="Password"
                    value={monitoring.password}
                    change={auditChangeForCompactLabel(lid, 'Password', fieldChangesByLocation)}
                  />
                  <OfficeCompactField
                    label="Notes"
                    value={monitoring.notes}
                    wide
                    change={auditChangeForCompactLabel(lid, 'Notes', fieldChangesByLocation)}
                  />
                </>
              )
            })()}
          </div>
        </td>
      ) : null}
      {columns.procedures ? (
        <td
          className={officeCellClassName(
            proceduresUpdated,
            `tw-office-long-text${
              highlightNewComments && stopHasNewCommentField(stop, 'testing_procedures')
                ? ' tw-office-long-text--new'
                : ''
            }`,
          )}
        >
          <OfficeLongTextCell
            stop={stop}
            locationId={lid}
            fieldKey="testing_procedures"
            fieldChangesByLocation={fieldChangesByLocation}
            highlightUpdatedCells={highlightUpdatedCells}
            highlightNewComments={highlightNewComments}
          />
        </td>
      ) : null}
      {columns.locationComments ? (
        <td
          className={officeCellClassName(
            locationCommentsUpdated,
            `tw-office-long-text${
              highlightNewComments && stopHasNewCommentField(stop, 'inspection_tech_notes')
                ? ' tw-office-long-text--new'
                : ''
            }`,
          )}
        >
          <OfficeLongTextCell
            stop={stop}
            locationId={lid}
            fieldKey="inspection_tech_notes"
            fieldChangesByLocation={fieldChangesByLocation}
            highlightUpdatedCells={highlightUpdatedCells}
            highlightNewComments={highlightNewComments}
          />
        </td>
      ) : null}
      {columns.runComments ? (
        <td
          className={officeCellClassName(
            runCommentsUpdated,
            `tw-office-long-text${
              highlightNewComments && stopHasNewCommentField(stop, 'run_comments')
                ? ' tw-office-long-text--new'
                : ''
            }`,
          )}
        >
          <OfficeLongTextCell
            stop={stop}
            locationId={lid}
            fieldKey="run_comments"
            fieldChangesByLocation={fieldChangesByLocation}
            highlightUpdatedCells={highlightUpdatedCells}
            highlightNewComments={highlightNewComments}
          />
        </td>
      ) : null}
    </tr>
  )
}

export type OfficeWorksheetReadOnlyTableProps = {
  stops: TechnicianWorksheetLocation[]
  monthDate: string
  fieldChangesByLocation?: Map<number, OfficeFieldChange[]>
  /** ``dashboard``: split header/body scroll like full office worksheet; ``embedded``: single scroll region. */
  layout?: 'dashboard' | 'embedded'
  /** Rendered above the table header strip (office worksheet summary card). */
  headerSlot?: ReactNode
  /** Grey stop # column (run details); does not use tested/skipped/annual colors. */
  neutralStopNumbers?: boolean
  /** Light-orange cell background for audited fields; still shows old → new in cell. */
  highlightUpdatedCells?: boolean
  /** Hide access/panel/monitoring/text columns with no audited changes on any location. */
  hideEmptyChangeColumns?: boolean
  /** Red highlight for comment fields newly added on this field run (exact history). */
  highlightNewComments?: boolean
  /** Completed run — pending stops show "No Results Submitted". */
  closedRun?: boolean
  /** Exact history: keep API stop order (one row per location; no same-address merge). */
  preserveSubmissionStopOrder?: boolean
}

export default function OfficeWorksheetReadOnlyTable({
  stops,
  monthDate,
  fieldChangesByLocation,
  layout = 'dashboard',
  headerSlot,
  neutralStopNumbers = false,
  highlightUpdatedCells = false,
  hideEmptyChangeColumns = false,
  highlightNewComments = false,
  closedRun = false,
  preserveSubmissionStopOrder = false,
}: OfficeWorksheetReadOnlyTableProps) {
  const headerScrollRef = useRef<HTMLDivElement | null>(null)
  const tableScrollRef = useRef<HTMLDivElement | null>(null)
  const groups = useMemo(
    () =>
      preserveSubmissionStopOrder
        ? groupOfficeWorksheetStopsInSubmissionOrder(stops)
        : groupOfficeWorksheetStops(stops),
    [stops, preserveSubmissionStopOrder],
  )

  const changeColumns = useMemo(() => {
    if (!hideEmptyChangeColumns) return OFFICE_WORKSHEET_ALL_CHANGE_COLUMNS_VISIBLE
    return computeOfficeWorksheetChangeColumnVisibility(fieldChangesByLocation, stops)
  }, [hideEmptyChangeColumns, fieldChangesByLocation, stops])

  const tableCssVars = useMemo(
    () => officeWorksheetTableCssVars(changeColumns) as CSSProperties,
    [changeColumns],
  )

  const syncHorizontalScroll = useCallback((source: 'header' | 'table') => {
    const headerEl = headerScrollRef.current
    const tableEl = tableScrollRef.current
    if (!headerEl || !tableEl) return
    if (source === 'header') {
      tableEl.scrollLeft = headerEl.scrollLeft
    } else {
      headerEl.scrollLeft = tableEl.scrollLeft
    }
  }, [])

  const bodyRows = groups.flatMap((group) =>
    group.stops.map((stop) => (
      <OfficeStopTableRow
        key={`office-stop-row:${stop.location_id}-${stop.month_date}-${stop.stop_number}`}
        stop={stop}
        monthDate={monthDate}
        fieldChangesByLocation={fieldChangesByLocation}
        columns={changeColumns}
        neutralStopNumbers={neutralStopNumbers}
        highlightUpdatedCells={highlightUpdatedCells}
        highlightNewComments={highlightNewComments}
        closedRun={closedRun}
      />
    )),
  )

  if (layout === 'embedded') {
    return (
      <div
        className="tw-office-table-card tw-office-table-card--embedded"
        style={hideEmptyChangeColumns ? tableCssVars : undefined}
      >
        <div className="tw-office-table-wrap">
          <Table size="sm" className="mb-0 tw-office-stop-table">
            <OfficeStopColGroup columns={changeColumns} />
            <thead>
              <OfficeTableHeaderRow columns={changeColumns} />
            </thead>
            <tbody>{bodyRows}</tbody>
          </Table>
        </div>
      </div>
    )
  }

  return (
    <>
      {headerSlot ? (
        <section className="tw-office-summary-card" aria-label="Worksheet summary">
          {headerSlot}
          <div
            ref={headerScrollRef}
            className="tw-office-header-scroll"
            onScroll={() => syncHorizontalScroll('header')}
          >
            <Table
              size="sm"
              className="mb-0 tw-office-stop-table tw-office-header-table"
              aria-label="Worksheet stop columns"
              style={hideEmptyChangeColumns ? tableCssVars : undefined}
            >
              <OfficeStopColGroup columns={changeColumns} />
              <thead>
                <OfficeTableHeaderRow columns={changeColumns} />
              </thead>
            </Table>
          </div>
        </section>
      ) : null}
      <div
        className="tw-office-table-card"
        style={hideEmptyChangeColumns ? tableCssVars : undefined}
      >
        <div
          ref={tableScrollRef}
          className="tw-office-table-wrap"
          onScroll={() => syncHorizontalScroll('table')}
        >
          <Table size="sm" className="mb-0 tw-office-stop-table">
            <OfficeStopColGroup columns={changeColumns} />
            {!headerSlot ? (
              <thead>
                <OfficeTableHeaderRow columns={changeColumns} />
              </thead>
            ) : null}
            <tbody>{bodyRows}</tbody>
          </Table>
        </div>
      </div>
    </>
  )
}
