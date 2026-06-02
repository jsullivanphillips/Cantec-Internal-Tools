import { useCallback, useEffect, useMemo, useState } from 'react'
import { Spinner, Table } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import RunDetailsFieldChangePrepCell from './RunDetailsFieldChangePrepCell'
import type { MonthlyRunDetailLocation, MonthlyRunDetailReviewStopDetailPayload } from './monthlyRoutesShared'
import type { NotableChangeItem } from './notableStopChanges'
import { auditedFieldChangeItems } from './notableStopChanges'
import {
  FIELD_CHANGE_PREP_COLUMN_ORDER,
  groupChangesByPrepColumn,
  type FieldChangePrepColumnId,
} from './fieldChangePrepLayout'
import { buildStopCardFromLocation } from './runDetailsLocationReview'
import { apiJson } from '../../lib/apiClient'

type FieldChangeStopEntry = {
  location: MonthlyRunDetailLocation
  stopNumber: number
  testingSiteId: number
  locationLabel: string
  siteLabel: string
  showSiteMeta: boolean
  changes: NotableChangeItem[]
}

type PendingStopEntry = {
  location: MonthlyRunDetailLocation
  stopNumber: number
  testingSiteId: number
  locationLabel: string
  siteLabel: string
  showSiteMeta: boolean
}

const COLUMN_HEADER: Record<FieldChangePrepColumnId, string> = {
  address: 'Address',
  access: 'Access',
  monitoring: 'Monitoring',
  run_comments: 'Job comments',
  procedures: 'Testing procedures',
  location_comments: 'Location comments',
}

const COLUMN_CELL_CLASS: Record<FieldChangePrepColumnId, string> = {
  address: 'run-details-prepare-sticky-address align-top',
  access: 'align-top run-details-prepare-stack-cell',
  monitoring: 'align-top run-details-prepare-stack-cell',
  run_comments: 'align-top run-details-prepare-longtext-cell',
  procedures: 'align-top run-details-prepare-longtext-cell',
  location_comments: 'align-top run-details-prepare-longtext-cell',
}

function AddressColumnCell({
  locationLabel,
  locationId,
  siteLabel,
  showSiteMeta,
  items,
  side,
}: {
  locationLabel: string
  locationId: number
  siteLabel: string
  showSiteMeta: boolean
  items: NotableChangeItem[] | undefined
  side: 'before' | 'after'
}) {
  const hasFieldStack = (items?.length ?? 0) > 0
  return (
    <>
      {side === 'before' ? (
        <>
          <Link
            to={`/monthlies/locations/${locationId}`}
            className="run-details-prepare-address-link"
          >
            {locationLabel}
          </Link>
          {showSiteMeta ? (
            <div className="run-details-prepare-site-label run-details-prepare-site-label--multi text-muted small">
              {siteLabel !== 'Primary testing location' ? siteLabel : 'Site'}
            </div>
          ) : null}
        </>
      ) : null}
      {hasFieldStack ? (
        <div className={side === 'before' ? 'mt-1' : undefined}>
          <RunDetailsFieldChangePrepCell items={items} side={side} columnId="address" />
        </div>
      ) : (
        <span
          className={`run-details-prepare-display run-details-prepare-display--empty${side === 'before' ? ' mt-1' : ''}`}
        >
          —
        </span>
      )}
    </>
  )
}

function FieldChangeStopPairRows({
  entry,
  pairIndex,
}: {
  entry: FieldChangeStopEntry
  pairIndex: number
}) {
  const grouped = groupChangesByPrepColumn(entry.changes)
  const pairClass = `run-details-field-change-pair run-details-field-change-pair--${pairIndex % 2 === 0 ? 'even' : 'odd'}`

  return (
    <>
      <tr className={`${pairClass} run-details-field-change-row--before`}>
        <td
          className="run-details-prepare-sticky-order tabular-nums align-top"
          rowSpan={2}
        >
          <span className="run-details-prepare-stop-num">{entry.stopNumber}</span>
        </td>
        <td className="run-details-field-change-version align-top">
          <span className="run-details-field-change-version__label">Before</span>
        </td>
        {FIELD_CHANGE_PREP_COLUMN_ORDER.map((columnId) => (
          <td key={columnId} className={COLUMN_CELL_CLASS[columnId]}>
            {columnId === 'address' ? (
              <AddressColumnCell
                locationLabel={entry.locationLabel}
                locationId={entry.location.location_id}
                siteLabel={entry.siteLabel}
                showSiteMeta={entry.showSiteMeta}
                items={grouped.address}
                side="before"
              />
            ) : (
              <RunDetailsFieldChangePrepCell
                items={grouped[columnId]}
                side="before"
                columnId={columnId}
              />
            )}
          </td>
        ))}
      </tr>
      <tr className={`${pairClass} run-details-field-change-row--after`}>
        <td className="run-details-field-change-version align-top">
          <span className="run-details-field-change-version__label">After</span>
        </td>
        {FIELD_CHANGE_PREP_COLUMN_ORDER.map((columnId) => (
          <td key={columnId} className={COLUMN_CELL_CLASS[columnId]}>
            {columnId === 'address' ? (
              <AddressColumnCell
                locationLabel={entry.locationLabel}
                locationId={entry.location.location_id}
                siteLabel={entry.siteLabel}
                showSiteMeta={entry.showSiteMeta}
                items={grouped.address}
                side="after"
              />
            ) : (
              <RunDetailsFieldChangePrepCell
                items={grouped[columnId]}
                side="after"
                columnId={columnId}
              />
            )}
          </td>
        ))}
      </tr>
    </>
  )
}

export default function RunDetailsFieldChangesTable({
  locations,
  routeId,
  monthDate,
}: {
  locations: MonthlyRunDetailLocation[]
  routeId: number
  monthDate: string
}) {
  const [changeDetailsByStopId, setChangeDetailsByStopId] = useState<Record<number, NotableChangeItem[]>>(
    {},
  )
  const [loadingStopIds, setLoadingStopIds] = useState<Set<number>>(() => new Set())
  const [loadErrors, setLoadErrors] = useState<Record<number, string>>({})

  const stopsNeedingFetch = useMemo(() => {
    const out: number[] = []
    for (const location of locations) {
      for (const stop of location.stops) {
        if (!stop.has_field_edits) continue
        if (changeDetailsByStopId[stop.testing_site_id]) continue
        out.push(stop.testing_site_id)
      }
    }
    return out
  }, [locations, changeDetailsByStopId])

  const loadStopDetail = useCallback(
    async (testingSiteId: number) => {
      setLoadingStopIds((prev) => new Set(prev).add(testingSiteId))
      setLoadErrors((prev) => {
        const next = { ...prev }
        delete next[testingSiteId]
        return next
      })
      try {
        const qs = new URLSearchParams({ month: monthDate })
        const data = await apiJson<MonthlyRunDetailReviewStopDetailPayload>(
          `/api/monthly_routes/routes/${routeId}/run_details/review/stops/${testingSiteId}?${qs.toString()}`,
        )
        setChangeDetailsByStopId((prev) => ({ ...prev, [testingSiteId]: data.changes }))
      } catch {
        setLoadErrors((prev) => ({
          ...prev,
          [testingSiteId]: 'Could not load changes for this stop.',
        }))
      } finally {
        setLoadingStopIds((prev) => {
          const next = new Set(prev)
          next.delete(testingSiteId)
          return next
        })
      }
    },
    [monthDate, routeId],
  )

  useEffect(() => {
    for (const testingSiteId of stopsNeedingFetch) {
      if (loadingStopIds.has(testingSiteId)) continue
      void loadStopDetail(testingSiteId)
    }
  }, [stopsNeedingFetch, loadingStopIds, loadStopDetail])

  const { readyStops, pendingStops, errors } = useMemo(() => {
    const ready: FieldChangeStopEntry[] = []
    const pending: PendingStopEntry[] = []
    const errList: string[] = []

    for (const location of locations) {
      const multiStop = location.stops.length > 1
      for (const stop of location.stops) {
        if (!stop.has_field_edits) continue
        const card = buildStopCardFromLocation(location, stop, monthDate)
        const base = {
          location,
          stopNumber: stop.stop_number,
          testingSiteId: stop.testing_site_id,
          locationLabel: location.location_label,
          siteLabel: card.siteLabel,
          showSiteMeta: multiStop && card.siteCount > 1,
        }

        if (loadingStopIds.has(stop.testing_site_id)) {
          pending.push(base)
          continue
        }
        const stopError = loadErrors[stop.testing_site_id]
        if (stopError) {
          errList.push(stopError)
          continue
        }
        const loaded = changeDetailsByStopId[stop.testing_site_id]
        if (!loaded) {
          pending.push(base)
          continue
        }
        const changes = auditedFieldChangeItems(loaded)
        if (changes.length > 0) {
          ready.push({ ...base, changes })
        }
      }
    }

    return { readyStops: ready, pendingStops: pending, errors: errList }
  }, [locations, monthDate, changeDetailsByStopId, loadingStopIds, loadErrors])

  const colCount = 2 + FIELD_CHANGE_PREP_COLUMN_ORDER.length
  const anyLoading = pendingStops.length > 0
  const hasContent = readyStops.length > 0 || anyLoading || errors.length > 0

  if (!hasContent) {
    return <p className="monthly-run-detail-empty mb-0">No field changes on this run.</p>
  }

  return (
    <div className="run-details-prepare-table-shell run-details-field-changes-shell">
      <Table size="sm" className="run-details-prepare-table run-details-field-changes-table mb-0">
        <colgroup>
          <col className="run-details-prepare-col-stop" />
          <col className="run-details-field-change-col-version" />
          <col className="run-details-prepare-col-address" />
          <col className="run-details-prepare-col-access" />
          <col className="run-details-prepare-col-monitoring" />
          <col className="run-details-prepare-col-run-comments" />
          <col className="run-details-prepare-col-procedures" />
          <col className="run-details-prepare-col-location-comments" />
        </colgroup>
        <thead>
          <tr>
            <th className="run-details-prepare-sticky-order">#</th>
            <th className="run-details-field-change-version">Version</th>
            {FIELD_CHANGE_PREP_COLUMN_ORDER.map((columnId) => (
              <th
                key={columnId}
                className={
                  columnId === 'address' ? 'run-details-prepare-sticky-address' : undefined
                }
              >
                {COLUMN_HEADER[columnId]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pendingStops.length > 0 && readyStops.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="text-center py-3">
                <Spinner animation="border" size="sm" aria-label="Loading field changes" />
              </td>
            </tr>
          ) : null}
          {errors.length > 0 && readyStops.length === 0 && pendingStops.length === 0 ? (
            <tr>
              <td colSpan={colCount}>
                <p className="text-danger small mb-0" role="alert">
                  {errors[0]}
                </p>
              </td>
            </tr>
          ) : null}
          {readyStops.map((entry, index) => (
            <FieldChangeStopPairRows key={entry.testingSiteId} entry={entry} pairIndex={index} />
          ))}
        </tbody>
      </Table>
    </div>
  )
}
