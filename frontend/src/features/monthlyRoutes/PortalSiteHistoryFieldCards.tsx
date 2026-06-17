import type { ReactNode } from 'react'
import RichTextDisplay from '../richText/RichTextDisplay'
import { richTextIsEmpty } from '../richText/richTextSanitize'
import { locationDisplaySubline, locationPrimaryLabel } from './locationDisplay'
import {
  formatSkipReasonDisplayText,
  portalSkipReasonDetail,
} from './portalWorkflowShared'
import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'
import {
  officeStopStatus,
  officeStopStatusLabel,
  shouldShowWorksheetTimeOutRow,
  worksheetReadOnlyDisplay,
  worksheetSkipReasonDisplayBlock,
  worksheetSkipReasonDuplicatesTimeInNote,
  worksheetTimeInOutDisplayLine,
  type OfficeStopStatus,
} from './officeWorksheetTableShared'
import {
  runReviewLocationCellClass,
  runReviewLocationCellTone,
  runReviewLocationResultCardClass,
} from './officeRunReviewShared'

type Props = {
  stop: TechnicianWorksheetLocation
  monthDate: string
  closedRun?: boolean
}

function HistoryStatusPill({
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

function buildResultDetailLines(
  stop: TechnicianWorksheetLocation,
  status: OfficeStopStatus,
): string[] {
  const rawSkipReasonBlock = worksheetSkipReasonDisplayBlock(stop.skip_reason)
  const skipReasonDisplayLine =
    rawSkipReasonBlock != null && status !== 'pending'
      ? status === 'skipped'
        ? portalSkipReasonDetail(stop) ??
          formatSkipReasonDisplayText(stop.skip_reason) ??
          rawSkipReasonBlock
        : rawSkipReasonBlock
      : null
  const displayTimeIn = (stop.time_in || '').trim()
  const displayTimeOut = (stop.time_out || '').trim()
  const showWorksheetTimeInLine =
    displayTimeIn.length > 0 &&
    !worksheetSkipReasonDuplicatesTimeInNote(rawSkipReasonBlock, stop.result_status, displayTimeIn)
  const showWorksheetTimeOutLine =
    displayTimeOut.length > 0 && shouldShowWorksheetTimeOutRow(displayTimeIn, displayTimeOut)
  const timeSummaryParts = [
    showWorksheetTimeInLine ? worksheetTimeInOutDisplayLine('in', displayTimeIn) : null,
    showWorksheetTimeOutLine ? worksheetTimeInOutDisplayLine('out', displayTimeOut) : null,
  ].filter((part): part is string => part != null)
  const resultDetailLines = [
    skipReasonDisplayLine,
    timeSummaryParts.length > 0 ? timeSummaryParts.join(' · ') : null,
  ].filter((part): part is string => part != null)
  if (resultDetailLines.length === 0) resultDetailLines.push('No times recorded')
  return resultDetailLines
}

function HistoryLongTextValue({
  value,
}: {
  value: string | null | undefined
}) {
  if (richTextIsEmpty(value)) {
    return <>{worksheetReadOnlyDisplay(value)}</>
  }
  return <RichTextDisplay value={value} />
}

function HistoryFieldCard({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <article className="portal-site-history-field-card">
      <h3 className="portal-site-history-field-card__label">{label}</h3>
      <div className="portal-site-history-field-card__body">{children}</div>
    </article>
  )
}

export default function PortalSiteHistoryFieldCards({
  stop,
  monthDate,
  closedRun = true,
}: Props) {
  const status = officeStopStatus(stop, monthDate)
  const resultDetailLines = buildResultDetailLines(stop, status)
  const primaryLabel = locationPrimaryLabel(stop)
  const addressSubline = locationDisplaySubline(stop, { primaryLabel })
  const buildingDisplay = (() => {
    const raw = (stop.building_name ?? '').trim()
    if (!raw) return null
    if (raw.toLowerCase() === primaryLabel.trim().toLowerCase()) return null
    return raw
  })()
  const tone = runReviewLocationCellTone(stop, monthDate)
  const cellClass = runReviewLocationCellClass(tone)
  const cardClass = runReviewLocationResultCardClass(tone)

  return (
    <div className="portal-site-history-field-cards">
      <HistoryFieldCard label="Address">
        <div className="portal-site-history-address">
          <div className="portal-site-history-address__primary">{primaryLabel}</div>
          <div className="portal-site-history-address__meta">
            <span>{worksheetReadOnlyDisplay(buildingDisplay)}</span>
            <span>{worksheetReadOnlyDisplay(stop.property_management_company)}</span>
          </div>
          {addressSubline ? (
            <div className="portal-site-history-address__subline text-muted small">{addressSubline}</div>
          ) : null}
        </div>
      </HistoryFieldCard>

      <HistoryFieldCard label="Test result">
        <div className={`portal-site-history-result ${cellClass}`}>
          <div className={`tw-office-billing-test-result-card ${cardClass}`}>
            <HistoryStatusPill status={status} closedRun={closedRun} />
            {resultDetailLines.map((line, index) => (
              <div key={`${index}:${line}`} className="tw-office-result-detail">
                {line}
              </div>
            ))}
          </div>
        </div>
      </HistoryFieldCard>

      <HistoryFieldCard label="Testing procedures">
        <HistoryLongTextValue value={stop.testing_procedures} />
      </HistoryFieldCard>

      <HistoryFieldCard label="Location comments">
        <HistoryLongTextValue value={stop.inspection_tech_notes} />
      </HistoryFieldCard>

      <HistoryFieldCard label="Job comments">
        <HistoryLongTextValue value={stop.run_comments} />
      </HistoryFieldCard>
    </div>
  )
}
