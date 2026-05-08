import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Alert, Badge, Button, Card, Modal, Spinner, Table } from 'react-bootstrap'
import { Link, useLocation, useParams } from 'react-router-dom'
import {
  parseYearMonth,
  type TechnicianWorksheetAuditEvent,
  type TechnicianWorksheetPayload,
  type TechnicianWorksheetRow,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import {
  backoffMs,
  completionPending,
  enqueueWorksheetChange,
  loadSyncQueue,
  loadWorksheetCache,
  markCompletionPending,
  saveSyncQueue,
  saveWorksheetCache,
  type WorksheetChangeSet,
} from '../features/monthlyRoutes/worksheetOfflineStore'
import { apiJson, isAbortError } from '../lib/apiClient'

const MONTH_FIRST_RE = /^\d{4}-\d{2}-01$/

function formatMonthHeading(monthFirstIso: string): string {
  const ym = parseYearMonth(monthFirstIso)
  if (!ym) return monthFirstIso
  return new Intl.DateTimeFormat('en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(ym.year, ym.month - 1, 1)))
}

function formatRunStartedAt(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d)
}

type SyncState = 'synced' | 'saved_offline' | 'syncing' | 'conflict'

function hhmmNow(): string {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** Whole-cell value is only a clock time (24h or 12h); otherwise show raw text with no Time In/Out label (e.g. skip notes in the sheet). */
const EXPLICIT_TIME_VALUE_RE = /^\d{1,2}:\d{1,2}(:\d{1,2})?(\s*[ap]\.?m\.?)?$/i

function looksLikeExplicitTimeValue(raw: string | null | undefined): boolean {
  const s = (raw ?? '').trim()
  if (!s) return false
  return EXPLICIT_TIME_VALUE_RE.test(s)
}

function worksheetTimeInOutDisplayLine(kind: 'in' | 'out', value: string): string {
  const v = value.trim()
  if (!v) return ''
  if (looksLikeExplicitTimeValue(v)) {
    return kind === 'in' ? `Time In: ${v}` : `Time Out: ${v}`
  }
  return v
}

function normalizedActionCellDetail(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** If ``time_in`` is free text (not a clock), treat ``time_out`` as sheet noise — only show ``time_in``. */
function shouldShowWorksheetTimeOutRow(displayTimeIn: string, displayTimeOut: string): boolean {
  if (!displayTimeOut.trim()) return false
  const tin = displayTimeIn.trim()
  if (!tin) return true
  return looksLikeExplicitTimeValue(displayTimeIn)
}

/** Skip reason line already shows the same note as a non-clock ``time_in`` cell (avoid "ANNUAL…" twice). */
function worksheetSkipReasonDuplicatesTimeInNote(
  skipReasonBlock: string | null,
  resultStatus: string | null | undefined,
  displayTimeIn: string,
): boolean {
  if ((resultStatus || '').trim().toLowerCase() !== 'skipped') return false
  if (skipReasonBlock == null || skipReasonBlock === '—') return false
  const note = displayTimeIn.trim()
  if (!note || looksLikeExplicitTimeValue(displayTimeIn)) return false
  return normalizedActionCellDetail(skipReasonBlock) === normalizedActionCellDetail(note)
}

function isAnnualForMonth(annualMonth: string | null | undefined, monthIso: string): boolean {
  const raw = (annualMonth || '').trim().toLowerCase()
  if (!raw) return false
  const ym = parseYearMonth(monthIso)
  if (!ym) return false
  const monthFull = new Intl.DateTimeFormat('en-CA', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(ym.year, ym.month - 1, 1)))
    .toLowerCase()
  const monthShort = monthFull.slice(0, 3)
  return raw === monthFull || raw === monthShort
}

/** Matches ``_sheet_skip_reason_is_annual`` in ``monthly_routes.py`` (sheet / CSV classification). */
function sheetSkipReasonIsAnnual(skipReason: string | null | undefined): boolean {
  const s = (skipReason || '').trim().toLowerCase()
  return s === 'annual' || s === 'annual_booked'
}

/** Importer / sheet internal codes — omit separate reason line (status still shows Skipped). */
function worksheetSkipReasonDisplayBlock(skipReason: string | null | undefined): string | null {
  const s = (skipReason ?? '').trim()
  const low = s.toLowerCase()
  if (low === 'annual_booked' || low === 'sheet_value') return null
  if (!s) return '—'
  return s
}

function worksheetAddressCellStatusClass(
  row: TechnicianWorksheetRow,
  monthDate: string,
  isHistorical: boolean,
): string | undefined {
  const rs = (row.result_status || '').trim().toLowerCase()
  const annualMatch = isAnnualForMonth(row.annual_month, monthDate)
  if (rs === 'tested') return 'tw-address-cell-tested'
  if (rs === 'skipped') {
    // Active run: any explicit technician skip should look "skipped" (yellow),
    // even when reason is annual. Historical runs keep annual-vs-other tinting.
    if (!isHistorical) return 'tw-address-cell-skipped-other'
    return sheetSkipReasonIsAnnual(row.skip_reason) ? 'tw-address-cell-annual' : 'tw-address-cell-skipped-other'
  }
  if (annualMatch) return 'tw-address-cell-annual'
  return undefined
}

function autosizeTextarea(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

function WorksheetTableColGroup() {
  return (
    <colgroup>
      <col style={{ width: '3%' }} />
      <col style={{ width: '13%' }} />
      <col style={{ width: '12%' }} />
      <col style={{ width: '17%' }} />
      <col style={{ width: '14%' }} />
      <col style={{ width: '16%' }} />
      <col style={{ width: '16%' }} />
      <col style={{ width: '9%' }} />
    </colgroup>
  )
}

export default function TechnicianWorksheetPage() {
  const { routeId, monthIso } = useParams<{ routeId: string; monthIso: string }>()
  const location = useLocation()
  const isPortalMode = location.pathname.startsWith('/tech/')
  const idNum = routeId ? parseInt(routeId, 10) : NaN
  const monthQuery = (monthIso || '').trim()
  const monthOk = MONTH_FIRST_RE.test(monthQuery) && parseYearMonth(monthQuery) != null

  const [payload, setPayload] = useState<TechnicianWorksheetPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncState, setSyncState] = useState<SyncState>('synced')
  const [auditForRow, setAuditForRow] = useState<TechnicianWorksheetRow | null>(null)
  const [auditEvents, setAuditEvents] = useState<TechnicianWorksheetAuditEvent[]>([])
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [activeEditorKey, setActiveEditorKey] = useState<string | null>(null)
  const [timeInModalRow, setTimeInModalRow] = useState<TechnicianWorksheetRow | null>(null)
  const [timeInDraft, setTimeInDraft] = useState('')
  const [timeOutModalRow, setTimeOutModalRow] = useState<TechnicianWorksheetRow | null>(null)
  const [timeOutDraft, setTimeOutDraft] = useState('')
  const [skipReasonModalRow, setSkipReasonModalRow] = useState<TechnicianWorksheetRow | null>(null)
  const [skipReasonDraft, setSkipReasonDraft] = useState('')
  const [annualTestAnywayRows, setAnnualTestAnywayRows] = useState<Set<number>>(new Set())
  const [topbarHeight, setTopbarHeight] = useState(0)
  const syncingRef = useRef(false)
  const topbarRef = useRef<HTMLDivElement | null>(null)
  const headerScrollRef = useRef<HTMLDivElement | null>(null)
  const tableScrollRef = useRef<HTMLDivElement | null>(null)
  const syncingScrollRef = useRef<'header' | 'table' | null>(null)

  const updateLocalRow = useCallback((locationId: number, patch: WorksheetChangeSet) => {
    setPayload((prev) => {
      if (!prev) return prev
      const rows = prev.rows.map((r) => (r.location_id === locationId ? { ...r, ...patch } : r))
      const next = { ...prev, rows }
      saveWorksheetCache(next)
      return next
    })
  }, [])

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!routeId || Number.isNaN(idNum) || !monthOk) {
        setLoading(false)
        return
      }
      const cached = loadWorksheetCache(idNum, monthQuery)
      if (cached) {
        setPayload(cached)
        setSyncState(navigator.onLine ? 'synced' : 'saved_offline')
        setLoading(false)
      }
      setError(null)
      try {
        const qs = new URLSearchParams({ month: monthQuery })
        const data = await apiJson<TechnicianWorksheetPayload>(
          `/api/monthly_routes/routes/${idNum}/worksheet?${qs.toString()}`,
          { signal }
        )
        if (signal?.aborted) return
        setPayload(data)
        saveWorksheetCache(data)
        setSyncState('synced')
      } catch (e) {
        if (isAbortError(e)) return
        if (!cached) setError('Unable to load worksheet.')
        setSyncState('saved_offline')
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [routeId, idNum, monthOk, monthQuery]
  )

  const runSyncQueue = useCallback(async () => {
    if (syncingRef.current || Number.isNaN(idNum) || !monthOk || !navigator.onLine) return
    const queue = loadSyncQueue()
    if (queue.length === 0) {
      setSyncState('synced')
      return
    }
    syncingRef.current = true
    setSyncState('syncing')
    let nextQueue = [...queue]
    for (const item of queue) {
      if (item.nextAttemptAt > Date.now()) continue
      if (item.routeId !== idNum || item.monthIso !== monthQuery) continue
      try {
        const qs = new URLSearchParams({ month: item.monthIso })
        const res = await apiJson<{ row: TechnicianWorksheetRow }>(
          `/api/monthly_routes/routes/${item.routeId}/worksheet/rows/${item.locationId}?${qs.toString()}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              expected_updated_at: item.expectedUpdatedAt,
              client_mutation_id: item.id,
              client_mutated_at: item.clientMutatedAt,
              source: 'technician_app',
              changes: item.changes,
            }),
          }
        )
        setPayload((prev) => {
          if (!prev) return prev
          const rows = prev.rows.map((r) => (r.location_id === item.locationId ? res.row : r))
          const next = { ...prev, rows }
          saveWorksheetCache(next)
          return next
        })
        nextQueue = nextQueue.filter((q) => q.id !== item.id)
      } catch (e) {
        const maybeErr = e as { error?: unknown; conflict?: { message?: string } }
        if (maybeErr?.error === 'conflict' || maybeErr?.conflict) {
          setSyncState('conflict')
          setSyncMessage('A server conflict needs manual review for one or more rows.')
          syncingRef.current = false
          return
        }
        nextQueue = nextQueue.map((q) =>
          q.id !== item.id
            ? q
            : {
                ...q,
                attempts: q.attempts + 1,
                nextAttemptAt: Date.now() + backoffMs(q.attempts + 1),
              }
        )
      }
    }
    saveSyncQueue(nextQueue)
    syncingRef.current = false
    setSyncState(nextQueue.length > 0 ? 'saved_offline' : 'synced')
  }, [idNum, monthOk, monthQuery])

  useEffect(() => {
    const c = new AbortController()
    void load(c.signal)
    return () => c.abort()
  }, [load])

  useEffect(() => {
    const t = setInterval(() => {
      void runSyncQueue()
    }, 3500)
    return () => clearInterval(t)
  }, [runSyncQueue])

  useEffect(() => {
    const el = topbarRef.current
    if (!el) {
      setTopbarHeight(0)
      return
    }
    const ro = new ResizeObserver(() => setTopbarHeight(el.offsetHeight))
    ro.observe(el)
    setTopbarHeight(el.offsetHeight)
    return () => ro.disconnect()
  }, [payload])

  useEffect(() => {
    setAnnualTestAnywayRows(new Set())
  }, [idNum, monthQuery, payload?.month_date])

  const queueLength = useMemo(() => {
    return loadSyncQueue().filter((q) => q.routeId === idNum && q.monthIso === monthQuery).length
  }, [idNum, monthQuery, payload, syncState])

  const onFieldChange = useCallback(
    (row: TechnicianWorksheetRow, field: keyof WorksheetChangeSet, value: string) => {
      const normalized = value.trim() ? value : null
      const patch = { [field]: normalized } as WorksheetChangeSet
      updateLocalRow(row.location_id, patch)
      enqueueWorksheetChange({
        routeId: idNum,
        locationId: row.location_id,
        monthIso: monthQuery,
        expectedUpdatedAt: row.version_updated_at,
        clientMutatedAt: new Date().toISOString(),
        changes: patch,
      })
      setSyncState('saved_offline')
    },
    [idNum, monthQuery, updateLocalRow]
  )

  const isEditorActive = useCallback((key: string) => activeEditorKey === key, [activeEditorKey])

  const activateEditorAndFocus = useCallback(
    (key: string, el: HTMLInputElement | HTMLTextAreaElement) => {
      if (activeEditorKey !== key) setActiveEditorKey(key)
      const focusEditor = () => {
        try {
          el.focus({ preventScroll: true })
        } catch {
          el.focus()
        }
        if (typeof el.setSelectionRange === 'function') {
          const len = (el.value || '').length
          try {
            el.setSelectionRange(len, len)
          } catch {
            // Some input types do not support text selection ranges.
          }
        }
      }
      // First call keeps focus in the same tap gesture; follow-ups handle React's readonly->editable flip.
      focusEditor()
      window.requestAnimationFrame(focusEditor)
      window.setTimeout(focusEditor, 0)
    },
    [activeEditorKey]
  )

  const queueRowChanges = useCallback(
    (row: TechnicianWorksheetRow, patch: WorksheetChangeSet) => {
      updateLocalRow(row.location_id, patch)
      enqueueWorksheetChange({
        routeId: idNum,
        locationId: row.location_id,
        monthIso: monthQuery,
        expectedUpdatedAt: row.version_updated_at,
        clientMutatedAt: new Date().toISOString(),
        changes: patch,
      })
      setSyncState('saved_offline')
    },
    [idNum, monthQuery, updateLocalRow]
  )

  const loadAudit = useCallback(
    async (row: TechnicianWorksheetRow) => {
      const qs = new URLSearchParams({ month: monthQuery })
      const data = await apiJson<{ events: TechnicianWorksheetAuditEvent[] }>(
        `/api/monthly_routes/routes/${idNum}/worksheet/rows/${row.location_id}/audit?${qs.toString()}`
      )
      setAuditForRow(row)
      setAuditEvents(data.events || [])
    },
    [idNum, monthQuery]
  )

  const syncWorksheetHorizontalScroll = useCallback((source: 'header' | 'table') => {
    const headerEl = headerScrollRef.current
    const tableEl = tableScrollRef.current
    if (!headerEl || !tableEl) return
    if (syncingScrollRef.current && syncingScrollRef.current !== source) return
    syncingScrollRef.current = source
    if (source === 'header') {
      if (tableEl.scrollLeft !== headerEl.scrollLeft) tableEl.scrollLeft = headerEl.scrollLeft
    } else if (headerEl.scrollLeft !== tableEl.scrollLeft) {
      headerEl.scrollLeft = tableEl.scrollLeft
    }
    requestAnimationFrame(() => {
      syncingScrollRef.current = null
    })
  }, [])

  const invalidParams =
    !routeId || Number.isNaN(idNum) || !monthIso ? (
      <Alert variant="danger">Missing route or month.</Alert>
    ) : !monthOk ? (
      <Alert variant="danger">Month must be first-of-month (example `2026-04-01`).</Alert>
    ) : null

  return (
    <div className="technician-worksheet-page">
      {payload ? (
        <div ref={topbarRef} className="technician-worksheet-topbar card shadow-sm">
          <div className="card-body py-2 container-fluid">
            <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
              <div className="d-flex align-items-center gap-2">
                <Link
                  to={
                    isPortalMode
                      ? '/tech/start'
                      : Number.isNaN(idNum)
                        ? '/monthlies/routes'
                        : `/monthlies/routes/${idNum}`
                  }
                  className="btn btn-link text-primary p-0 d-inline-flex align-items-center justify-content-center tw-worksheet-back-btn"
                  aria-label="Back"
                  title="Back"
                >
                  <i className="bi bi-arrow-left-circle-fill" aria-hidden />
                </Link>
                <div>
                  <div className="fw-semibold">{payload.route.label}</div>
                  <div className="small text-muted">{formatMonthHeading(payload.month_date)} run</div>
                  {(() => {
                    const startedLabel = formatRunStartedAt(payload.run?.started_at ?? null)
                    return startedLabel ? (
                      <div className="small text-muted">Run started {startedLabel}</div>
                    ) : null
                  })()}
                </div>
              </div>
              <div className="d-flex align-items-center gap-2">
                {completionPending(idNum, monthQuery) ? <Badge bg="warning">Pending Confirmation</Badge> : null}
                <Badge bg={syncState === 'conflict' ? 'danger' : syncState === 'syncing' ? 'info' : syncState === 'saved_offline' ? 'secondary' : 'success'}>
                  {syncState === 'conflict'
                    ? 'Conflict'
                    : syncState === 'syncing'
                      ? 'Syncing'
                      : syncState === 'saved_offline'
                        ? 'Saved offline'
                        : 'Synced'}
                </Badge>
                {queueLength > 0 ? <span className="small text-muted">{queueLength} queued</span> : null}
                <Button
                  size="sm"
                  variant="outline-secondary"
                  onClick={() => {
                    markCompletionPending(idNum, monthQuery, true)
                  }}
                >
                  Complete (Offline)
                </Button>
              </div>
            </div>
            {syncMessage ? <div className="small text-danger mt-1">{syncMessage}</div> : null}
          </div>
          <div
            ref={headerScrollRef}
            className="technician-worksheet-column-header-wrap technician-worksheet-column-header-wrap--topbar"
            onScroll={() => syncWorksheetHorizontalScroll('header')}
          >
            <Table size="sm" className="mb-0 align-middle technician-worksheet-column-header-table">
              <WorksheetTableColGroup />
              <thead className="table-light">
                <tr>
                  <th className="tw-col-order">#</th>
                  <th className="tw-col-address">Address</th>
                  <th className="tw-col-stacked-ark">Annual / Ring / Key #</th>
                  <th className="tw-col-facp">FACP</th>
                  <th className="tw-col-monitoring">Monitoring</th>
                  <th className="tw-col-procedures">Testing Procedures</th>
                  <th className="tw-col-notes">Tech Comments & Notes</th>
                  <th className="tw-col-action">Action</th>
                </tr>
              </thead>
            </Table>
          </div>
        </div>
      ) : null}
      <div
        className="container-fluid px-0"
        style={
          ({
            paddingTop: topbarHeight > 0 ? topbarHeight : 0,
            paddingBottom: '1rem',
            ['--tw-worksheet-topbar-h' as string]: `${topbarHeight}px`,
          } as CSSProperties)
        }
      >
      {invalidParams}
      {loading && !payload ? (
        <div className="d-flex align-items-center justify-content-center gap-2 text-muted py-5">
          <Spinner animation="border" size="sm" /> Loading worksheet…
        </div>
      ) : null}
      {error ? <Alert variant="danger">{error}</Alert> : null}
      {payload ? (
        <>
          <Card className="shadow-sm">
            <Card.Body className="p-0">
              <div
                ref={tableScrollRef}
                className="technician-worksheet-table-wrap"
                onScroll={() => syncWorksheetHorizontalScroll('table')}
              >
                <Table size="sm" className="mb-0 align-middle technician-worksheet-table">
                  <WorksheetTableColGroup />
                  <tbody>
                    {payload.rows.map((row, index) => (
                      <tr
                        key={`${row.location_id}-${row.month_date}`}
                        className={(() => {
                          const rs = (row.result_status || '').trim().toLowerCase()
                          const annualMatch = isAnnualForMonth(row.annual_month, payload.month_date)
                          const isHistorical = payload.run?.is_historical === true
                          if (rs === 'skipped') {
                            if (isHistorical && sheetSkipReasonIsAnnual(row.skip_reason)) return 'tw-row-annual'
                            return 'tw-row-skipped'
                          }
                          return annualMatch ? 'tw-row-annual' : undefined
                        })()}
                      >
                        {(() => {
                          const annualKey = `annual_month:${row.location_id}`
                          const ringKey = `ring:${row.location_id}`
                          const keyNumberKey = `key_number:${row.location_id}`
                          const facpKey = `facp:${row.location_id}`
                          const proceduresKey = `testing_procedures:${row.location_id}`
                          const notesKey = `inspection_tech_notes:${row.location_id}`
                          const isHistorical = payload.run?.is_historical === true
                          const addressStatusClass = worksheetAddressCellStatusClass(row, payload.month_date, isHistorical)
                          const displayTimeIn = (row.time_in || '').trim()
                          const displayTimeOut = (row.time_out || '').trim()
                          const hasTimeIn = displayTimeIn.length > 0
                          const hasTimeOut = displayTimeOut.length > 0
                          const annualMatch = isAnnualForMonth(row.annual_month, payload.month_date)
                          const showOfficeStatusIcons = isHistorical && !isPortalMode
                          const worksheetResultKey = (row.result_status || '').trim().toLowerCase()
                          const worksheetHasTestedOrSkipped =
                            worksheetResultKey === 'tested' || worksheetResultKey === 'skipped'
                          const showHistoricalOfficeResultButtons =
                            isHistorical && !isPortalMode && !worksheetHasTestedOrSkipped
                          const skipReasonDisplayBlock = worksheetSkipReasonDisplayBlock(row.skip_reason)
                          const showWorksheetTimeInLine =
                            hasTimeIn &&
                            !worksheetSkipReasonDuplicatesTimeInNote(
                              skipReasonDisplayBlock,
                              row.result_status,
                              displayTimeIn,
                            )
                          const showWorksheetTimeOutLine = hasTimeOut && shouldShowWorksheetTimeOutRow(displayTimeIn, displayTimeOut)
                          const showAnnualPromptBeforeTesting =
                            !isHistorical &&
                            !hasTimeIn &&
                            annualMatch &&
                            !annualTestAnywayRows.has(row.location_id)
                          return (
                            <>
                        <td className="tw-col-order text-center tabular-nums">{index + 1}</td>
                        <td className={`tw-col-address${addressStatusClass ? ` ${addressStatusClass}` : ''}`}>
                          <div className="tw-address-block">
                            <Link
                              to={`/monthlies/locations/${row.location_id}`}
                              className="fw-semibold text-break text-decoration-none link-primary d-inline-block"
                            >
                              {row.display_address}
                            </Link>
                            <div className="small text-muted">{'building name'}</div>
                            <div className="small text-muted">{row.property_management_company || '—'}</div>
                          </div>
                        </td>
                        <td className="tw-col-stacked-ark">
                          <div className="tw-stacked-cell">
                            <label className="tw-stacked-label">Ring</label>
                            <input
                              key={`ring:${row.location_id}:${row.month_date}:${row.ring ?? ''}`}
                              className={`form-control form-control-sm ${isEditorActive(ringKey) ? '' : 'tw-readonly-field'}`}
                              defaultValue={row.ring ?? ''}
                              readOnly={!isEditorActive(ringKey)}
                              autoFocus={isEditorActive(ringKey)}
                              onClick={(e) => activateEditorAndFocus(ringKey, e.currentTarget)}
                              onBlur={(e) => {
                                onFieldChange(row, 'ring', e.target.value)
                                if (activeEditorKey === ringKey) setActiveEditorKey(null)
                              }}
                            />
                            <label className="tw-stacked-label">Key #</label>
                            <input
                              key={`key:${row.location_id}:${row.month_date}:${row.key_number ?? ''}`}
                              className={`form-control form-control-sm ${isEditorActive(keyNumberKey) ? '' : 'tw-readonly-field'}`}
                              defaultValue={row.key_number ?? ''}
                              readOnly={!isEditorActive(keyNumberKey)}
                              autoFocus={isEditorActive(keyNumberKey)}
                              onClick={(e) => activateEditorAndFocus(keyNumberKey, e.currentTarget)}
                              onBlur={(e) => {
                                onFieldChange(row, 'key_number', e.target.value)
                                if (activeEditorKey === keyNumberKey) setActiveEditorKey(null)
                              }}
                            />
                            <label className="tw-stacked-label">Annual</label>
                            <input
                              key={`annual:${row.location_id}:${row.month_date}:${row.annual_month ?? ''}`}
                              className={`form-control form-control-sm ${isEditorActive(annualKey) ? '' : 'tw-readonly-field'}`}
                              defaultValue={row.annual_month ?? ''}
                              readOnly={!isEditorActive(annualKey)}
                              autoFocus={isEditorActive(annualKey)}
                              onClick={(e) => activateEditorAndFocus(annualKey, e.currentTarget)}
                              onBlur={(e) => {
                                onFieldChange(row, 'annual_month', e.target.value)
                                if (activeEditorKey === annualKey) setActiveEditorKey(null)
                              }}
                            />
                          </div>
                        </td>
                        <td className="tw-col-facp">
                          <textarea
                            className={`form-control form-control-sm ${isEditorActive(facpKey) ? '' : 'tw-readonly-field'}`}
                            rows={1}
                            defaultValue={row.facp ?? ''}
                            readOnly={!isEditorActive(facpKey)}
                            ref={(el) => {
                              if (el) autosizeTextarea(el)
                            }}
                            onInput={(e) => autosizeTextarea(e.currentTarget)}
                            onClick={(e) => activateEditorAndFocus(facpKey, e.currentTarget)}
                            onBlur={(e) => {
                              autosizeTextarea(e.currentTarget)
                              onFieldChange(row, 'facp', e.target.value)
                              if (activeEditorKey === facpKey) setActiveEditorKey(null)
                            }}
                          />
                        </td>
                        <td className="small tw-col-monitoring">{row.monitoring ?? '—'}</td>
                        <td className="tw-col-procedures">
                          <textarea
                            className={`form-control form-control-sm ${isEditorActive(proceduresKey) ? '' : 'tw-readonly-field'}`}
                            rows={1}
                            defaultValue={row.testing_procedures ?? ''}
                            readOnly={!isEditorActive(proceduresKey)}
                            ref={(el) => {
                              if (el) autosizeTextarea(el)
                            }}
                            onInput={(e) => autosizeTextarea(e.currentTarget)}
                            onClick={(e) => activateEditorAndFocus(proceduresKey, e.currentTarget)}
                            onBlur={(e) => {
                              autosizeTextarea(e.currentTarget)
                              onFieldChange(row, 'testing_procedures', e.target.value)
                              if (activeEditorKey === proceduresKey) setActiveEditorKey(null)
                            }}
                          />
                        </td>
                        <td className="tw-col-notes">
                          <textarea
                            className={`form-control form-control-sm ${isEditorActive(notesKey) ? '' : 'tw-readonly-field'}`}
                            rows={1}
                            defaultValue={row.inspection_tech_notes ?? ''}
                            readOnly={!isEditorActive(notesKey)}
                            ref={(el) => {
                              if (el) autosizeTextarea(el)
                            }}
                            onInput={(e) => autosizeTextarea(e.currentTarget)}
                            onClick={(e) => activateEditorAndFocus(notesKey, e.currentTarget)}
                            onBlur={(e) => {
                              autosizeTextarea(e.currentTarget)
                              onFieldChange(row, 'inspection_tech_notes', e.target.value)
                              if (activeEditorKey === notesKey) setActiveEditorKey(null)
                            }}
                          />
                        </td>
                        <td className="tw-col-action">
                          <div className={`d-grid gap-1${isHistorical ? ' text-center' : ''}`}>
                            {isHistorical ? (
                              <>
                                {worksheetResultKey === 'tested' ? (
                                  <div className="fw-semibold small d-flex align-items-center justify-content-center gap-1">
                                    {showOfficeStatusIcons ? (
                                      <i
                                        className="bi bi-check-circle-fill text-success flex-shrink-0"
                                        style={{ fontSize: '1rem' }}
                                        title="Tested"
                                        aria-hidden
                                      />
                                    ) : null}
                                    <span>Tested</span>
                                  </div>
                                ) : worksheetResultKey === 'skipped' ? (
                                  <>
                                    <div className="fw-semibold small d-flex align-items-center justify-content-center gap-1">
                                      {showOfficeStatusIcons ? (
                                        <span
                                          className="rounded-circle bg-warning flex-shrink-0 d-inline-block tw-office-skipped-dot"
                                          title="Skipped"
                                          aria-hidden
                                        />
                                      ) : null}
                                      <span>Skipped</span>
                                    </div>
                                    {skipReasonDisplayBlock != null ? (
                                      <div className="small text-muted text-break text-center">{skipReasonDisplayBlock}</div>
                                    ) : null}
                                  </>
                                ) : showHistoricalOfficeResultButtons ? (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="success"
                                      onClick={() => {
                                        queueRowChanges(row, { result_status: 'tested', skip_reason: null })
                                      }}
                                    >
                                      Set as tested
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="warning"
                                      onClick={() => {
                                        setSkipReasonModalRow(row)
                                        setSkipReasonDraft(row.skip_reason || '')
                                      }}
                                    >
                                      Set as skipped
                                    </Button>
                                  </>
                                ) : (
                                  <div className="small text-muted">—</div>
                                )}
                                {showWorksheetTimeInLine ? (
                                  <div className="small text-muted">{worksheetTimeInOutDisplayLine('in', displayTimeIn)}</div>
                                ) : null}
                                {showWorksheetTimeOutLine ? (
                                  <div className="small text-muted">{worksheetTimeInOutDisplayLine('out', displayTimeOut)}</div>
                                ) : null}
                              </>
                            ) : (
                              <>
                                {worksheetResultKey === 'skipped' ? (
                                  <>
                                    <div className="fw-semibold small text-center">Skipped</div>
                                    {skipReasonDisplayBlock != null ? (
                                      <div className="small text-muted text-break text-center">{skipReasonDisplayBlock}</div>
                                    ) : null}
                                    <Button
                                      size="sm"
                                      variant="outline-secondary"
                                      className="tw-worksheet-reset-btn"
                                      onClick={() => {
                                        setAnnualTestAnywayRows((prev) => {
                                          const next = new Set(prev)
                                          next.delete(row.location_id)
                                          return next
                                        })
                                        queueRowChanges(row, {
                                          result_status: null,
                                          skip_reason: null,
                                          time_in: null,
                                          time_out: null,
                                        })
                                      }}
                                    >
                                      Reset
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    {showWorksheetTimeInLine ? (
                                      <div className="small text-muted">{worksheetTimeInOutDisplayLine('in', displayTimeIn)}</div>
                                    ) : null}
                                    {showWorksheetTimeOutLine ? (
                                      <div className="small text-muted">{worksheetTimeInOutDisplayLine('out', displayTimeOut)}</div>
                                    ) : null}
                                    {!hasTimeIn ? (
                                      <>
                                        {showAnnualPromptBeforeTesting ? (
                                          <>
                                            <div className="small fw-semibold text-uppercase text-warning-emphasis text-center">
                                              ANNUAL
                                            </div>
                                            <Button
                                              size="sm"
                                          variant="warning"
                                          onClick={() => {
                                            queueRowChanges(row, { result_status: 'skipped', skip_reason: 'annual' })
                                          }}
                                        >
                                          Skip
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline-secondary"
                                              className="tw-annual-test-anyway-btn"
                                              onClick={() =>
                                                setAnnualTestAnywayRows((prev) => {
                                                  const next = new Set(prev)
                                                  next.add(row.location_id)
                                                  return next
                                                })
                                              }
                                            >
                                              Test Anyway
                                            </Button>
                                          </>
                                        ) : (
                                          <>
                                            <Button
                                              size="sm"
                                              variant="success"
                                              onClick={() => {
                                                setTimeInModalRow(row)
                                                setTimeInDraft(displayTimeIn || hhmmNow())
                                              }}
                                            >
                                              Time In
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="warning"
                                              onClick={() => {
                                                setSkipReasonModalRow(row)
                                                setSkipReasonDraft(row.skip_reason || '')
                                              }}
                                            >
                                              Skip
                                            </Button>
                                          </>
                                        )}
                                      </>
                                    ) : !hasTimeOut ? (
                                      <>
                                        <Button
                                          size="sm"
                                          variant="success"
                                          onClick={() => {
                                            setTimeOutModalRow(row)
                                            setTimeOutDraft(displayTimeOut || hhmmNow())
                                          }}
                                        >
                                          Time Out
                                        </Button>
                                        <Button size="sm" variant="danger" onClick={() => window.alert('Deficiency workflow next phase')}>
                                          Add Deficiency
                                        </Button>
                                      </>
                                    ) : (
                                      <>
                                        <Button
                                          size="sm"
                                          variant="outline-secondary"
                                          onClick={() => {
                                            queueRowChanges(row, {
                                              time_in: null,
                                              time_out: null,
                                              skip_reason: null,
                                              result_status: 'tested',
                                            })
                                          }}
                                        >
                                          Clear Time In/Out
                                        </Button>
                                        <Button size="sm" variant="danger" onClick={() => window.alert('Deficiency workflow next phase')}>
                                          Add Deficiency
                                        </Button>
                                      </>
                                    )}
                                  </>
                                )}
                              </>
                            )}
                            <Button variant="link" size="sm" className="px-0 tw-audit-link" onClick={() => void loadAudit(row)}>
                              Audit
                            </Button>
                          </div>
                        </td>
                            </>
                          )
                        })()}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </Card.Body>
          </Card>
        </>
      ) : null}
      <Modal show={auditForRow != null} onHide={() => setAuditForRow(null)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title className="h6 mb-0">{auditForRow?.display_address} · Audit</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {auditEvents.length === 0 ? (
            <div className="text-muted small">No audit events yet.</div>
          ) : (
            <Table size="sm" bordered responsive>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Field</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Who</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {auditEvents.map((ev) => (
                  <tr key={ev.id}>
                    <td className="small text-nowrap">{ev.changed_at ? new Date(ev.changed_at).toLocaleString() : '—'}</td>
                    <td className="small">{ev.field_name}</td>
                    <td className="small text-break">{String(ev.old_value ?? '—')}</td>
                    <td className="small text-break">{String(ev.new_value ?? '—')}</td>
                    <td className="small">{ev.changed_by_name || ev.changed_by_username || '—'}</td>
                    <td className="small">{ev.source}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Modal.Body>
      </Modal>
      <Modal show={timeInModalRow != null} onHide={() => setTimeInModalRow(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="h6 mb-0">Time In</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="small mb-2 text-muted">{timeInModalRow?.display_address}</div>
          <input
            className="form-control"
            value={timeInDraft}
            onChange={(e) => setTimeInDraft(e.target.value)}
            placeholder="HH:MM"
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setTimeInModalRow(null)}>Cancel</Button>
          <Button
            variant="success"
            onClick={() => {
              if (!timeInModalRow) return
              queueRowChanges(timeInModalRow, { time_in: timeInDraft })
              setTimeInModalRow(null)
            }}
          >
            Confirm Time In
          </Button>
        </Modal.Footer>
      </Modal>
      <Modal show={timeOutModalRow != null} onHide={() => setTimeOutModalRow(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="h6 mb-0">Time Out</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="small mb-2 text-muted">{timeOutModalRow?.display_address}</div>
          <input
            className="form-control"
            value={timeOutDraft}
            onChange={(e) => setTimeOutDraft(e.target.value)}
            placeholder="HH:MM"
          />
        </Modal.Body>
        <Modal.Footer className="w-100 d-grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Button
            variant="success"
            onClick={() => {
              if (!timeOutModalRow) return
              queueRowChanges(timeOutModalRow, { time_out: timeOutDraft, result_status: 'tested', skip_reason: null })
              setTimeOutModalRow(null)
            }}
          >
            Tested
          </Button>
          <Button
            variant="warning"
            onClick={() => {
              if (!timeOutModalRow) return
              queueRowChanges(timeOutModalRow, { time_out: timeOutDraft })
              setSkipReasonModalRow(timeOutModalRow)
              setSkipReasonDraft(timeOutModalRow.skip_reason || '')
              setTimeOutModalRow(null)
            }}
          >
            Skipped
          </Button>
        </Modal.Footer>
      </Modal>
      <Modal show={skipReasonModalRow != null} onHide={() => setSkipReasonModalRow(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="h6 mb-0">Skip Reason</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="small mb-2 text-muted">{skipReasonModalRow?.display_address}</div>
          <input
            className="form-control"
            value={skipReasonDraft}
            onChange={(e) => setSkipReasonDraft(e.target.value)}
            placeholder="Why was this site skipped?"
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setSkipReasonModalRow(null)}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!skipReasonModalRow) return
              queueRowChanges(skipReasonModalRow, {
                result_status: 'skipped',
                skip_reason: skipReasonDraft.trim() || 'No reason provided',
              })
              setSkipReasonModalRow(null)
            }}
          >
            Submit
          </Button>
        </Modal.Footer>
      </Modal>
      </div>
    </div>
  )
}
