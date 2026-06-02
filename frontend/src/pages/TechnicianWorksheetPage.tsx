import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { flushSync } from 'react-dom'
import { Alert, Badge, Button, Card, Modal, Spinner, Table } from 'react-bootstrap'
import { Link, useMatch, useParams } from 'react-router-dom'
import OfficeWorksheetReadOnlyTable from '../features/monthlyRoutes/OfficeWorksheetReadOnlyTable'
import {
  groupOfficeWorksheetStops,
  worksheetReadOnlyDisplay,
  worksheetStopIsAnnualSkip,
} from '../features/monthlyRoutes/officeWorksheetTableShared'
import { parseMonitoringSheetDisplay } from '../features/monthlyRoutes/monitoringSheetDisplay'
import {
  monthFirstIsoPacificToday,
  parseYearMonth,
  runOfficeStatusPillLabel,
  worksheetOfficeRunActivity,
  type TechnicianWorksheetPayload,
  type TechnicianWorksheetRow,
  WORKSHEET_CLOCK_IN_BLOCKED_MESSAGE,
} from '../features/monthlyRoutes/monthlyRoutesShared'
import {
  backoffMs,
  clearWorksheetCache,
  enqueueWorksheetChange,
  loadSyncQueue,
  loadWorksheetCache,
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

/** Open visit: explicit Time In, no Time Out, not tested/skipped. */
function worksheetRowIsOpenClockIn(row: TechnicianWorksheetRow): boolean {
  const rs = (row.result_status || '').trim().toLowerCase()
  if (rs === 'tested' || rs === 'skipped') return false
  const tin = (row.time_in || '').trim()
  const tout = (row.time_out || '').trim()
  if (!tin || tout) return false
  return looksLikeExplicitTimeValue(tin)
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
  if (!raw || raw === 'to') return false
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

type WorksheetGridColumn = 'facp' | 'monitoring' | 'testing_procedures' | 'inspection_tech_notes'

const WORKSHEET_GRID_COLUMNS: WorksheetGridColumn[] = [
  'facp',
  'monitoring',
  'testing_procedures',
  'inspection_tech_notes',
]

const WORKSHEET_GRID_COLUMN_LABELS: Record<WorksheetGridColumn, string> = {
  facp: 'FACP',
  monitoring: 'Monitoring',
  testing_procedures: 'Testing Procedures',
  inspection_tech_notes: 'Location comments',
}

function worksheetGridCellValue(row: TechnicianWorksheetRow, column: WorksheetGridColumn): string {
  switch (column) {
    case 'facp':
      return row.facp ?? ''
    case 'monitoring':
      return row.monitoring ?? ''
    case 'testing_procedures':
      return row.testing_procedures ?? ''
    case 'inspection_tech_notes':
      return row.inspection_tech_notes ?? ''
  }
}

function worksheetGridCellRegistryKey(locationId: number, column: WorksheetGridColumn): string {
  return `${locationId}:${column}`
}

/** Same normalization as ``onFieldChange`` (trim → null). */
function worksheetGridPersistedEquals(draft: string, committed: string | null | undefined): boolean {
  const d = draft.trim() ? draft : null
  const c = (committed ?? '').trim() ? String(committed) : null
  return d === c
}

function renderMonitoringSheetCellView(raw: string): ReactNode {
  const parsed = parseMonitoringSheetDisplay(raw)
  if (!parsed.isStructured) {
    if (!raw.trim()) return '\u00a0'
    return <span className="tw-monitoring-plain text-break">{raw}</span>
  }
  return (
    <div className="tw-stacked-cell tw-stacked-cell--monitoring">
      {parsed.remainderBefore ? (
        <div className="tw-monitoring-remainder text-break">{parsed.remainderBefore}</div>
      ) : null}
      {parsed.fields.map((f) => (
        <Fragment key={f.key}>
          <label className="tw-stacked-label">{f.label}</label>
          <div className="tw-monitoring-field-value form-control form-control-sm">{f.value ? f.value : '—'}</div>
        </Fragment>
      ))}
      {parsed.remainderAfter ? (
        <div className="tw-monitoring-remainder text-break">{parsed.remainderAfter}</div>
      ) : null}
    </div>
  )
}

const WORKSHEET_GRID_TAP_MOVE_THRESHOLD_SQ = 100 // 10px — ignore scroll-like drags

function worksheetGridIsTouchLikePointer(pointerType: string): boolean {
  return pointerType === 'touch' || pointerType === 'pen'
}

function worksheetRowIsAnnualSkip(row: TechnicianWorksheetRow, monthDate: string): boolean {
  const rs = (row.result_status || '').trim().toLowerCase()
  if (rs !== 'skipped') return isAnnualForMonth(row.annual_month, monthDate)
  return sheetSkipReasonIsAnnual(row.skip_reason) || isAnnualForMonth(row.annual_month, monthDate)
}

function worksheetRowStatusClass(row: TechnicianWorksheetRow, monthDate: string): string | undefined {
  const rs = (row.result_status || '').trim().toLowerCase()
  if (rs === 'skipped') {
    return worksheetRowIsAnnualSkip(row, monthDate) ? 'tw-row-annual' : 'tw-row-skipped'
  }
  if (isAnnualForMonth(row.annual_month, monthDate)) return 'tw-row-annual'
  return undefined
}

function worksheetAddressCellStatusClass(
  row: TechnicianWorksheetRow,
  monthDate: string,
): string | undefined {
  const rs = (row.result_status || '').trim().toLowerCase()
  if (rs === 'tested') return 'tw-address-cell-tested'
  if (rs === 'skipped') {
    return worksheetRowIsAnnualSkip(row, monthDate)
      ? 'tw-address-cell-annual'
      : 'tw-address-cell-skipped-other'
  }
  if (isAnnualForMonth(row.annual_month, monthDate)) return 'tw-address-cell-annual'
  return undefined
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
  /** Route-driven detection (works with Router ``basename``); ``pathname.startsWith('/tech/')`` misses subpath deploys. */
  const isPortalMode = useMatch({ path: '/tech/route/:routeId/worksheet/:monthIso', end: true }) != null
  const isOfficeReadOnly = !isPortalMode
  const idNum = routeId ? parseInt(routeId, 10) : NaN
  const monthQuery = (monthIso || '').trim()
  const monthOk = MONTH_FIRST_RE.test(monthQuery) && parseYearMonth(monthQuery) != null

  const [payload, setPayload] = useState<TechnicianWorksheetPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resetRunModalOpen, setResetRunModalOpen] = useState(false)
  const [resetRunBusy, setResetRunBusy] = useState(false)
  const [syncState, setSyncState] = useState<SyncState>('synced')
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [activeEditorKey, setActiveEditorKey] = useState<string | null>(null)
  const [timeInModalRow, setTimeInModalRow] = useState<TechnicianWorksheetRow | null>(null)
  const [timeInDraft, setTimeInDraft] = useState('')
  const [timeOutModalRow, setTimeOutModalRow] = useState<TechnicianWorksheetRow | null>(null)
  const [timeOutDraft, setTimeOutDraft] = useState('')
  const [skipReasonModalRow, setSkipReasonModalRow] = useState<TechnicianWorksheetRow | null>(null)
  const [skipReasonDraft, setSkipReasonDraft] = useState('')
  /** Time Out → Skipped: apply ``time_out`` only when skip reason is submitted (avoids time_out without skipped/tested). */
  const pendingTimeOutForSkipModalRef = useRef<string | null>(null)
  const [annualTestAnywayRows, setAnnualTestAnywayRows] = useState<Set<number>>(new Set())
  const [topbarHeight, setTopbarHeight] = useState(0)
  const syncingRef = useRef(false)
  const topbarRef = useRef<HTMLDivElement | null>(null)
  const headerScrollRef = useRef<HTMLDivElement | null>(null)
  const tableScrollRef = useRef<HTMLDivElement | null>(null)
  const syncingScrollRef = useRef<'header' | 'table' | null>(null)
  const worksheetGridCellRefs = useRef<Map<string, HTMLTableCellElement>>(new Map())
  const worksheetGridSelectionRef = useRef<{ locationId: number; column: WorksheetGridColumn } | null>(null)
  const worksheetGridDraftRef = useRef('')
  const worksheetFloatingEditorRef = useRef<HTMLTextAreaElement | null>(null)
  /** Touch/pen: pointerdown origin so pointerup can distinguish tap vs scroll and same cell. */
  const worksheetGridTouchPtrRef = useRef<{
    pointerId: number
    x: number
    y: number
    locationId: number
    column: WorksheetGridColumn
  } | null>(null)
  /** iOS emits a delayed synthetic click after touch; avoid fighting textarea focus / selection. */
  const worksheetGridSuppressNextClickRef = useRef(false)
  /** True while grid editor is open — updated synchronously so capture-phase handlers see current state. */
  const worksheetGridEditingRef = useRef(false)
  /** After committing edit by tapping another cell, skip pointerup/click so we don't enter edit on same gesture. */
  const worksheetGridSkipTapAfterSwitchRef = useRef(false)

  const [worksheetGridSelection, setWorksheetGridSelection] = useState<{
    locationId: number
    column: WorksheetGridColumn
  } | null>(null)
  const [worksheetGridEditing, setWorksheetGridEditing] = useState(false)
  const [worksheetGridDraft, setWorksheetGridDraft] = useState('')

  useEffect(() => {
    worksheetGridEditingRef.current = worksheetGridEditing
  }, [worksheetGridEditing])

  const updateLocalRow = useCallback(
    (locationId: number, patch: WorksheetChangeSet) => {
      setPayload((prev) => {
        if (!prev) return prev
        const rows = prev.rows.map((r) => (r.location_id === locationId ? { ...r, ...patch } : r))
        const next = { ...prev, rows }
        if (isPortalMode) saveWorksheetCache(next)
        return next
      })
    },
    [isPortalMode],
  )

  const openClockInRow = useMemo(() => {
    if (!payload?.rows?.length) return null
    return payload.rows.find(worksheetRowIsOpenClockIn) ?? null
  }, [payload?.rows])

  const timeInBlockedForRow = useCallback(
    (row: TechnicianWorksheetRow): boolean =>
      openClockInRow != null && openClockInRow.location_id !== row.location_id,
    [openClockInRow],
  )

  const openTimeInModal = useCallback(
    (row: TechnicianWorksheetRow) => {
      if (isOfficeReadOnly) return
      if (timeInBlockedForRow(row)) {
        window.alert(WORKSHEET_CLOCK_IN_BLOCKED_MESSAGE)
        return
      }
      setTimeInModalRow(row)
      setTimeInDraft((row.time_in || '').trim() || hhmmNow())
    },
    [isOfficeReadOnly, timeInBlockedForRow],
  )

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!routeId || Number.isNaN(idNum) || !monthOk) {
        setLoading(false)
        return
      }
      const cached = isPortalMode ? loadWorksheetCache(idNum, monthQuery) : null
      if (cached) {
        setPayload(cached)
        setSyncState(navigator.onLine ? 'synced' : 'saved_offline')
        setLoading(false)
      }
      setError(null)
      try {
        const qs = new URLSearchParams({ month: monthQuery })
        if (isPortalMode) qs.set('tech_portal', '1')
        else qs.set('include_stops', '1')
        const data = await apiJson<TechnicianWorksheetPayload>(
          `/api/monthly_routes/routes/${idNum}/worksheet?${qs.toString()}`,
          { signal }
        )
        if (signal?.aborted) return
        setPayload(data)
        if (isPortalMode) saveWorksheetCache(data)
        else clearWorksheetCache(idNum, monthQuery)
        setSyncState('synced')
      } catch (e) {
        if (isAbortError(e)) return
        if (!cached) {
          setError('Unable to load worksheet.')
          setSyncState('saved_offline')
        }
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [routeId, idNum, monthOk, monthQuery, isPortalMode]
  )

  const onConfirmResetRun = useCallback(async () => {
    if (Number.isNaN(idNum) || !monthOk) return
    setResetRunBusy(true)
    try {
      const qs = new URLSearchParams({ month: monthQuery })
      if (isPortalMode) qs.set('tech_portal', '1')
      const res = await apiJson<{
        ok: boolean
        worksheet: TechnicianWorksheetPayload
        cleared_rows: number
        preserved_annual_skip_rows: number
      }>(`/api/monthly_routes/routes/${idNum}/worksheet/reset_run?${qs.toString()}`, {
        method: 'POST',
        body: JSON.stringify({ source: 'technician_app' }),
      })
      setPayload(res.worksheet)
      if (isPortalMode) saveWorksheetCache(res.worksheet)
      else clearWorksheetCache(idNum, monthQuery)
      setAnnualTestAnywayRows(new Set())
      setResetRunModalOpen(false)
      setSyncMessage(null)
    } catch (e) {
      const msg =
        typeof e === 'object' && e != null && 'error' in (e as Record<string, unknown>)
          ? String((e as { error?: unknown }).error)
          : 'Could not reset run.'
      window.alert(msg)
    } finally {
      setResetRunBusy(false)
    }
  }, [idNum, monthOk, monthQuery, isPortalMode])

  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  }, [load])

  /** Remote SSE refresh deferred while grid edit or worksheet modals are open. */
  const worksheetDeferredRemoteFetchRef = useRef(false)
  const worksheetInteractiveBusyRef = useRef(false)
  useEffect(() => {
    worksheetInteractiveBusyRef.current =
      worksheetGridEditing ||
      timeInModalRow != null ||
      timeOutModalRow != null ||
      skipReasonModalRow != null ||
      activeEditorKey != null
  }, [
    worksheetGridEditing,
    timeInModalRow,
    timeOutModalRow,
    skipReasonModalRow,
    activeEditorKey,
  ])

  const applyRemoteWorksheetRefresh = useCallback(() => {
    if (worksheetInteractiveBusyRef.current) {
      worksheetDeferredRemoteFetchRef.current = true
      return
    }
    worksheetDeferredRemoteFetchRef.current = false
    void loadRef.current()
  }, [])

  useEffect(() => {
    const busy =
      worksheetGridEditing ||
      timeInModalRow != null ||
      timeOutModalRow != null ||
      skipReasonModalRow != null ||
      activeEditorKey != null
    if (busy) return
    if (!worksheetDeferredRemoteFetchRef.current) return
    worksheetDeferredRemoteFetchRef.current = false
    void loadRef.current()
  }, [
    worksheetGridEditing,
    timeInModalRow,
    timeOutModalRow,
    skipReasonModalRow,
    activeEditorKey,
  ])

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
        if (item.techPortal) qs.set('tech_portal', '1')
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
          if (isPortalMode) saveWorksheetCache(next)
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
  }, [idNum, monthOk, monthQuery, isPortalMode])

  useEffect(() => {
    const c = new AbortController()
    void load(c.signal)
    return () => c.abort()
  }, [load])

  useEffect(() => {
    worksheetDeferredRemoteFetchRef.current = false
  }, [idNum, monthQuery])

  useEffect(() => {
    const t = setInterval(() => {
      void runSyncQueue()
    }, 3500)
    return () => clearInterval(t)
  }, [runSyncQueue])

  /** SSE: notify when worksheet revision changes (session cookie auth).

    Must stay on while PIN portal shows preview rows before ``run`` exists so another
    device can Start Run / edit and this tab still receives revision bumps.
  */
  const sseEnabled = payload !== null && monthOk && !Number.isNaN(idNum)

  useEffect(() => {
    if (!sseEnabled) return

    let es: EventSource | null = null
    let reconnectTimer: ReturnType<typeof window.setTimeout> | null = null

    const clearReconnect = () => {
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
    }

    const scheduleReconnect = () => {
      clearReconnect()
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null
        openEs()
      }, 15000)
    }

    const openEs = () => {
      clearReconnect()
      if (!navigator.onLine || document.visibilityState !== 'visible') return
      const qs = new URLSearchParams({ month: monthQuery })
      if (isPortalMode) qs.set('tech_portal', '1')
      else qs.set('include_stops', '1')
      const url = `/api/monthly_routes/routes/${idNum}/worksheet/stream?${qs.toString()}`
      try {
        es = new EventSource(url)
      } catch {
        scheduleReconnect()
        return
      }
      es.onmessage = (event: MessageEvent<string>) => {
        try {
          const msg = JSON.parse(event.data) as {
            revision?: string
            route_id?: number
            month_date?: string
          }
          if (msg.route_id !== idNum || msg.month_date !== monthQuery) return
        } catch {
          return
        }
        applyRemoteWorksheetRefresh()
      }
      es.onerror = () => {
        es?.close()
        es = null
        scheduleReconnect()
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        clearReconnect()
        es?.close()
        es = null
      } else {
        openEs()
      }
    }

    const onOffline = () => {
      clearReconnect()
      es?.close()
      es = null
    }

    const onOnline = () => openEs()

    openEs()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      clearReconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      es?.close()
      es = null
    }
  }, [sseEnabled, idNum, monthQuery, isPortalMode, applyRemoteWorksheetRefresh])

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

  useEffect(() => {
    setWorksheetGridSelection(null)
    setWorksheetGridEditing(false)
  }, [idNum, monthQuery])

  useEffect(() => {
    worksheetGridSelectionRef.current = worksheetGridSelection
  }, [worksheetGridSelection])

  useEffect(() => {
    worksheetGridDraftRef.current = worksheetGridDraft
  }, [worksheetGridDraft])

  const queueLength = useMemo(() => {
    return loadSyncQueue().filter((q) => q.routeId === idNum && q.monthIso === monthQuery).length
  }, [idNum, monthQuery, payload, syncState])

  const officeWorksheetStops = useMemo(
    () => (isOfficeReadOnly ? (payload?.stops ?? []) : []),
    [isOfficeReadOnly, payload?.stops],
  )

  const officeStopGroups = useMemo(
    () => groupOfficeWorksheetStops(officeWorksheetStops),
    [officeWorksheetStops],
  )

  const showOfficeDashboard = isOfficeReadOnly && officeStopGroups.length > 0

  const officeStopProgress = useMemo(() => {
    const total = officeWorksheetStops.length
    let tested = 0
    let skipped = 0
    let annual = 0
    for (const stop of officeWorksheetStops) {
      const status = (stop.result_status || '').trim().toLowerCase()
      if (status === 'tested') tested += 1
      if (status === 'skipped') skipped += 1
      if (isAnnualForMonth(stop.annual_month, payload?.month_date ?? monthQuery) || worksheetStopIsAnnualSkip(stop, payload?.month_date ?? monthQuery)) {
        annual += 1
      }
    }
    return { tested, skipped, annual, open: Math.max(total - tested - skipped, 0), total }
  }, [officeWorksheetStops, payload?.month_date, monthQuery])

  const onFieldChange = useCallback(
    (row: TechnicianWorksheetRow, field: keyof WorksheetChangeSet, value: string) => {
      if (isOfficeReadOnly || !payload || payload.run === null) return
      const normalized = value.trim() ? value : null
      const patch = { [field]: normalized } as WorksheetChangeSet
      updateLocalRow(row.location_id, patch)
      enqueueWorksheetChange({
        routeId: idNum,
        locationId: row.location_id,
        monthIso: monthQuery,
        expectedUpdatedAt: row.version_updated_at,
        clientMutatedAt: new Date().toISOString(),
        techPortal: isPortalMode,
        changes: patch,
      })
      setSyncState('saved_offline')
    },
    [idNum, monthQuery, payload, updateLocalRow, isPortalMode, isOfficeReadOnly]
  )

  const commitWorksheetGridEdit = useCallback(() => {
    if (!worksheetGridEditingRef.current) return
    worksheetGridEditingRef.current = false
    const sel = worksheetGridSelectionRef.current
    const draft = worksheetGridDraftRef.current
    setWorksheetGridEditing(false)
    if (!sel || !payload) return
    const row = payload.rows.find((r) => r.location_id === sel.locationId)
    if (!row) return
    const committed = worksheetGridCellValue(row, sel.column)
    if (!worksheetGridPersistedEquals(draft, committed)) {
      onFieldChange(row, sel.column, draft)
    }
  }, [payload, onFieldChange])

  const cancelWorksheetGridEdit = useCallback(() => {
    worksheetGridEditingRef.current = false
    setWorksheetGridEditing(false)
  }, [])

  const openWorksheetGridEditorState = useCallback(
    (locationId: number, column: WorksheetGridColumn, opts?: { initialDraft?: string }) => {
      if (isOfficeReadOnly || !payload || payload.run === null) return false
      const row = payload.rows.find((r) => r.location_id === locationId)
      if (!row) return false
      const committed = worksheetGridCellValue(row, column)
      const draft = opts?.initialDraft !== undefined ? opts.initialDraft : committed
      worksheetGridSelectionRef.current = { locationId, column }
      setWorksheetGridSelection({ locationId, column })
      setWorksheetGridDraft(draft)
      worksheetGridDraftRef.current = draft
      worksheetGridEditingRef.current = true
      setWorksheetGridEditing(true)
      return true
    },
    [payload, isOfficeReadOnly]
  )

  const focusWorksheetFloatingEditorAtEnd = useCallback(() => {
    const ta = worksheetFloatingEditorRef.current
    if (!ta) return
    try {
      ta.focus({ preventScroll: true })
    } catch {
      ta.focus()
    }
    const len = ta.value.length
    try {
      ta.setSelectionRange(len, len)
    } catch {
      // ignore
    }
  }, [])

  /** Opens editor; ``useLayoutEffect`` focuses the textarea (fine for keyboard-driven opens). */
  const beginWorksheetGridEdit = useCallback(
    (locationId: number, column: WorksheetGridColumn, opts?: { initialDraft?: string }) => {
      openWorksheetGridEditorState(locationId, column, opts)
    },
    [openWorksheetGridEditorState]
  )

  /** Same as ``beginWorksheetGridEdit`` but commits synchronously and focuses immediately — required for iOS virtual keyboard. */
  const beginWorksheetGridEditUserGesture = useCallback(
    (locationId: number, column: WorksheetGridColumn, opts?: { initialDraft?: string }) => {
      flushSync(() => {
        openWorksheetGridEditorState(locationId, column, opts)
      })
      focusWorksheetFloatingEditorAtEnd()
    },
    [openWorksheetGridEditorState, focusWorksheetFloatingEditorAtEnd]
  )

  const worksheetGridTabNext = useCallback(
    (backward: boolean) => {
      if (!payload?.rows.length) return
      const cols = WORKSHEET_GRID_COLUMNS
      const sel = worksheetGridSelectionRef.current
      if (!sel) return
      const ri = payload.rows.findIndex((r) => r.location_id === sel.locationId)
      if (ri < 0) return
      const ci = cols.indexOf(sel.column)
      let next: { locationId: number; column: WorksheetGridColumn } | null = null
      if (!backward) {
        if (ci < cols.length - 1) next = { locationId: sel.locationId, column: cols[ci + 1] }
        else if (ri < payload.rows.length - 1) next = { locationId: payload.rows[ri + 1].location_id, column: cols[0] }
      } else {
        if (ci > 0) next = { locationId: sel.locationId, column: cols[ci - 1] }
        else if (ri > 0) next = { locationId: payload.rows[ri - 1].location_id, column: cols[cols.length - 1] }
      }
      if (next) {
        worksheetGridSelectionRef.current = next
        setWorksheetGridSelection(next)
      }
    },
    [payload]
  )

  const worksheetGridMoveSelection = useCallback(
    (dir: 'up' | 'down' | 'left' | 'right') => {
      if (!payload?.rows.length) return
      const cols = WORKSHEET_GRID_COLUMNS
      const sel = worksheetGridSelectionRef.current
      if (!sel) return
      const ri = payload.rows.findIndex((r) => r.location_id === sel.locationId)
      if (ri < 0) return
      const ci = cols.indexOf(sel.column)
      let next: { locationId: number; column: WorksheetGridColumn } | null = null
      if (dir === 'up') {
        if (ri > 0) next = { locationId: payload.rows[ri - 1].location_id, column: sel.column }
      } else if (dir === 'down') {
        if (ri < payload.rows.length - 1) next = { locationId: payload.rows[ri + 1].location_id, column: sel.column }
      } else if (dir === 'left') {
        if (ci > 0) next = { locationId: sel.locationId, column: cols[ci - 1] }
        else if (ri > 0) next = { locationId: payload.rows[ri - 1].location_id, column: cols[cols.length - 1] }
      } else if (dir === 'right') {
        if (ci < cols.length - 1) next = { locationId: sel.locationId, column: cols[ci + 1] }
        else if (ri < payload.rows.length - 1) next = { locationId: payload.rows[ri + 1].location_id, column: cols[0] }
      }
      if (next) {
        worksheetGridSelectionRef.current = next
        setWorksheetGridSelection(next)
      }
    },
    [payload]
  )

  useLayoutEffect(() => {
    if (!worksheetGridEditing || !worksheetGridSelection) return
    const ta = worksheetFloatingEditorRef.current
    if (!ta) return
    try {
      ta.focus({ preventScroll: true })
    } catch {
      ta.focus()
    }
    const len = ta.value.length
    try {
      ta.setSelectionRange(len, len)
    } catch {
      // ignore
    }
  }, [worksheetGridEditing, worksheetGridSelection?.locationId, worksheetGridSelection?.column])

  useLayoutEffect(() => {
    if (worksheetGridEditing || !worksheetGridSelection) return
    const el = worksheetGridCellRefs.current.get(
      worksheetGridCellRegistryKey(worksheetGridSelection.locationId, worksheetGridSelection.column)
    )
    try {
      el?.focus({ preventScroll: true })
    } catch {
      el?.focus()
    }
  }, [worksheetGridSelection, worksheetGridEditing])

  const focusWorksheetGridCellEl = useCallback((sel: { locationId: number; column: WorksheetGridColumn }) => {
    window.requestAnimationFrame(() => {
      const el = worksheetGridCellRefs.current.get(worksheetGridCellRegistryKey(sel.locationId, sel.column))
      try {
        el?.focus({ preventScroll: true })
      } catch {
        el?.focus()
      }
    })
  }, [])

  const onWorksheetGridCellKeyDown = useCallback(
    (row: TechnicianWorksheetRow, column: WorksheetGridColumn) => (e: ReactKeyboardEvent<HTMLElement>) => {
      if (isOfficeReadOnly || !payload || payload.run === null) return
      if (worksheetGridEditing) return
      const sel = { locationId: row.location_id, column }
      if (e.key === 'Enter') {
        e.preventDefault()
        worksheetGridSelectionRef.current = sel
        setWorksheetGridSelection(sel)
        beginWorksheetGridEdit(row.location_id, column)
        return
      }
      if (e.key === 'F2') {
        e.preventDefault()
        worksheetGridSelectionRef.current = sel
        setWorksheetGridSelection(sel)
        beginWorksheetGridEdit(row.location_id, column)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        worksheetGridSelectionRef.current = sel
        setWorksheetGridSelection(sel)
        worksheetGridTabNext(e.shiftKey)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        worksheetGridSelectionRef.current = sel
        setWorksheetGridSelection(sel)
        worksheetGridMoveSelection('up')
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        worksheetGridSelectionRef.current = sel
        setWorksheetGridSelection(sel)
        worksheetGridMoveSelection('down')
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        worksheetGridSelectionRef.current = sel
        setWorksheetGridSelection(sel)
        worksheetGridMoveSelection('left')
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        worksheetGridSelectionRef.current = sel
        setWorksheetGridSelection(sel)
        worksheetGridMoveSelection('right')
        return
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        worksheetGridSelectionRef.current = sel
        setWorksheetGridSelection(sel)
        beginWorksheetGridEdit(row.location_id, column, { initialDraft: e.key })
      }
    },
    [payload, worksheetGridEditing, beginWorksheetGridEdit, worksheetGridTabNext, worksheetGridMoveSelection, isOfficeReadOnly]
  )

  const onWorksheetFloatingEditorKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancelWorksheetGridEdit()
        const sel = worksheetGridSelectionRef.current
        if (sel) focusWorksheetGridCellEl(sel)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        const sel = worksheetGridSelectionRef.current
        commitWorksheetGridEdit()
        if (sel) focusWorksheetGridCellEl(sel)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        commitWorksheetGridEdit()
        worksheetGridTabNext(e.shiftKey)
        const sel = worksheetGridSelectionRef.current
        if (sel) focusWorksheetGridCellEl(sel)
      }
    },
    [
      cancelWorksheetGridEdit,
      commitWorksheetGridEdit,
      focusWorksheetGridCellEl,
      worksheetGridTabNext,
    ]
  )

  const isEditorActive = useCallback((key: string) => activeEditorKey === key, [activeEditorKey])

  const activateEditorAndFocus = useCallback(
    (key: string, el: HTMLInputElement) => {
      if (isOfficeReadOnly || !payload || payload.run === null) return
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
      focusEditor()
      window.requestAnimationFrame(() => {
        focusEditor()
      })
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          focusEditor()
        })
      })
      window.setTimeout(() => {
        focusEditor()
      }, 0)
    },
    [activeEditorKey, payload, isOfficeReadOnly]
  )

  const queueRowChanges = useCallback(
    (row: TechnicianWorksheetRow, patch: WorksheetChangeSet) => {
      if (isOfficeReadOnly || !payload || payload.run === null) return
      updateLocalRow(row.location_id, patch)
      enqueueWorksheetChange({
        routeId: idNum,
        locationId: row.location_id,
        monthIso: monthQuery,
        expectedUpdatedAt: row.version_updated_at,
        clientMutatedAt: new Date().toISOString(),
        techPortal: isPortalMode,
        changes: patch,
      })
      setSyncState('saved_offline')
    },
    [idNum, monthQuery, payload, updateLocalRow, isPortalMode, isOfficeReadOnly]
  )

  const dismissSkipReasonModal = useCallback(() => {
    pendingTimeOutForSkipModalRef.current = null
    setSkipReasonModalRow(null)
  }, [])

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

  function renderWorksheetGridColumnTd(row: TechnicianWorksheetRow, column: WorksheetGridColumn, tdClass: string) {
    const valueDisplay = worksheetGridCellValue(row, column)
    const cellViewContent =
      column === 'monitoring'
        ? renderMonitoringSheetCellView(valueDisplay)
        : valueDisplay || '\u00a0'
    if (isOfficeReadOnly || !payload || payload.run === null) {
      return (
        <td
          className={`${tdClass} tw-worksheet-grid-td`}
          tabIndex={-1}
          role="gridcell"
          aria-label={`${WORKSHEET_GRID_COLUMN_LABELS[column]}${payload?.run == null ? ' (preview)' : ''}, ${row.display_address}`}
        >
          <div className="tw-worksheet-cell-surface tw-worksheet-cell-surface--excel-shell">
            <div className="tw-worksheet-cell-flow">
              <div className="tw-worksheet-cell-view">{cellViewContent}</div>
            </div>
          </div>
        </td>
      )
    }
    const selected =
      worksheetGridSelection?.locationId === row.location_id && worksheetGridSelection.column === column
    const showEditor = worksheetGridEditing && selected
    const cellViewContentInteractive =
      column === 'monitoring' && !showEditor ? renderMonitoringSheetCellView(valueDisplay) : valueDisplay || '\u00a0'
    /** Selection ref is updated synchronously on select so touch second-tap sees correct state. */
    const alreadySelectedNotEditing =
      worksheetGridSelectionRef.current?.locationId === row.location_id &&
      worksheetGridSelectionRef.current.column === column &&
      !worksheetGridEditing
    return (
      <td
        ref={(el) => {
          const k = worksheetGridCellRegistryKey(row.location_id, column)
          if (el) worksheetGridCellRefs.current.set(k, el)
          else worksheetGridCellRefs.current.delete(k)
        }}
        tabIndex={selected && !showEditor ? 0 : -1}
        role="gridcell"
        aria-label={`${WORKSHEET_GRID_COLUMN_LABELS[column]}, ${row.display_address}`}
        className={`${tdClass} tw-worksheet-grid-td`}
        onKeyDown={showEditor ? undefined : onWorksheetGridCellKeyDown(row, column)}
        onPointerDownCapture={() => {
          if (!worksheetGridEditingRef.current) return
          if (showEditor) return
          const prevSel = worksheetGridSelectionRef.current
          const next = { locationId: row.location_id, column }
          flushSync(() => {
            commitWorksheetGridEdit()
          })
          const switched =
            prevSel != null &&
            (prevSel.locationId !== next.locationId || prevSel.column !== next.column)
          if (switched) {
            worksheetGridSkipTapAfterSwitchRef.current = true
            worksheetGridSuppressNextClickRef.current = true
            window.setTimeout(() => {
              worksheetGridSuppressNextClickRef.current = false
            }, 450)
            flushSync(() => {
              worksheetGridSelectionRef.current = next
              setWorksheetGridSelection(next)
            })
            focusWorksheetGridCellEl(next)
          }
        }}
        onPointerDown={(e: ReactPointerEvent<HTMLTableCellElement>) => {
          if (showEditor) return
          if (!worksheetGridIsTouchLikePointer(e.pointerType)) return
          worksheetGridTouchPtrRef.current = {
            pointerId: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            locationId: row.location_id,
            column,
          }
        }}
        onPointerCancel={(e: ReactPointerEvent<HTMLTableCellElement>) => {
          if (worksheetGridTouchPtrRef.current?.pointerId === e.pointerId) {
            worksheetGridTouchPtrRef.current = null
          }
        }}
        onPointerUp={(e: ReactPointerEvent<HTMLTableCellElement>) => {
          if (showEditor) return
          if (worksheetGridSkipTapAfterSwitchRef.current) {
            worksheetGridSkipTapAfterSwitchRef.current = false
            worksheetGridTouchPtrRef.current = null
            return
          }
          if (!worksheetGridIsTouchLikePointer(e.pointerType)) return
          const start = worksheetGridTouchPtrRef.current
          worksheetGridTouchPtrRef.current = null
          if (!start || start.pointerId !== e.pointerId) return
          if (start.locationId !== row.location_id || start.column !== column) return
          const dx = e.clientX - start.x
          const dy = e.clientY - start.y
          if (dx * dx + dy * dy > WORKSHEET_GRID_TAP_MOVE_THRESHOLD_SQ) return
          e.stopPropagation()
          worksheetGridSuppressNextClickRef.current = true
          window.setTimeout(() => {
            worksheetGridSuppressNextClickRef.current = false
          }, 450)
          if (alreadySelectedNotEditing) {
            beginWorksheetGridEditUserGesture(row.location_id, column)
          } else {
            const next = { locationId: row.location_id, column }
            worksheetGridSelectionRef.current = next
            setWorksheetGridSelection(next)
          }
        }}
        onClick={(e) => {
          e.stopPropagation()
          if (showEditor) return
          if (worksheetGridSuppressNextClickRef.current) {
            worksheetGridSuppressNextClickRef.current = false
            return
          }
          if (alreadySelectedNotEditing) {
            beginWorksheetGridEditUserGesture(row.location_id, column)
          } else {
            const next = { locationId: row.location_id, column }
            worksheetGridSelectionRef.current = next
            setWorksheetGridSelection(next)
          }
        }}
      >
        <div className="tw-worksheet-cell-surface tw-worksheet-cell-surface--excel-shell">
          <div className="tw-worksheet-cell-flow">
            <div className={`tw-worksheet-cell-view${showEditor ? ' tw-worksheet-cell-view--under-editor' : ''}`}>
              {cellViewContentInteractive}
            </div>
          </div>
        </div>
        <div
          className={`tw-worksheet-cell-overlay${selected ? ' tw-worksheet-cell-selected' : ''}`}
          aria-hidden={!showEditor}
        >
          {showEditor ? (
            <textarea
              ref={worksheetFloatingEditorRef}
              className="form-control form-control-sm tw-worksheet-cell-editor"
              aria-label={`Edit ${WORKSHEET_GRID_COLUMN_LABELS[column]}, ${row.display_address}`}
              value={worksheetGridDraft}
              onChange={(e) => {
                const v = e.target.value
                setWorksheetGridDraft(v)
                worksheetGridDraftRef.current = v
              }}
              onBlur={() => commitWorksheetGridEdit()}
              onKeyDown={onWorksheetFloatingEditorKeyDown}
            />
          ) : null}
        </div>
      </td>
    )
  }

  function renderOfficeDashboard() {
    if (!payload) return null
    const startedLabel = formatRunStartedAt(payload.run?.started_at ?? null)
    const completedLabel = formatRunStartedAt(payload.run?.completed_at ?? null)
    const runActivityLabel =
      officeRunActivityPhase != null
        ? runOfficeStatusPillLabel(officeRunActivityPhase, payload.month_date, payload.route)
        : completedLabel
          ? `Completed ${completedLabel}`
          : 'Not completed'
    return (
      <div className="tw-office-dashboard">
        <OfficeWorksheetReadOnlyTable
          stops={officeWorksheetStops}
          monthDate={payload.month_date}
          layout="dashboard"
          headerSlot={
            <div className="tw-office-summary-main">
              <div>
                <div className="tw-office-summary-eyebrow">Office worksheet</div>
                <h2 className="tw-office-summary-title">{payload.route.label}</h2>
                <div className="tw-office-summary-meta">
                  {formatMonthHeading(payload.month_date)}
                  {startedLabel ? <span>Field run started {startedLabel}</span> : null}
                  {completedLabel ? <span>Run completed {completedLabel}</span> : null}
                </div>
              </div>
              <div className="tw-office-summary-metrics" aria-label="Stop counts">
                <div className="tw-office-summary-metric">
                  <strong>{officeStopProgress.tested}</strong>
                  <span>Tested</span>
                </div>
                <div className="tw-office-summary-metric">
                  <strong>{officeStopProgress.skipped}</strong>
                  <span>Skipped</span>
                </div>
                <div className="tw-office-summary-metric">
                  <strong>{officeStopProgress.annual}</strong>
                  <span>Annual</span>
                </div>
                <div className="tw-office-summary-metric">
                  <strong>{officeStopProgress.open}</strong>
                  <span>Pending</span>
                </div>
                <div className="tw-office-summary-metric tw-office-summary-metric--total">
                  <strong>{officeStopProgress.total}</strong>
                  <span>Total stops</span>
                </div>
              </div>
              {officeRunActivityPhase ? (
                <Badge
                  bg={
                    officeRunActivityPhase === 'completed'
                      ? 'success'
                      : officeRunActivityPhase === 'active'
                        ? 'primary'
                        : 'secondary'
                  }
                  className="tw-office-summary-badge"
                >
                  {runActivityLabel}
                </Badge>
              ) : null}
            </div>
          }
        />
      </div>
    )
  }

  const isNonCurrentMonth =
    payload != null && monthOk && payload.month_date !== monthFirstIsoPacificToday()
  const isEmptyHistorical =
    isNonCurrentMonth && payload!.run == null && (payload!.rows?.length ?? 0) === 0
  const isCurrentMonthPreview =
    payload != null && payload.run == null && payload.month_date === monthFirstIsoPacificToday()
  const isHistoricalView =
    payload?.run?.is_historical === true ||
    (isNonCurrentMonth && (payload?.rows?.length ?? 0) > 0)
  const worksheetFrozenNoRun = isPortalMode
    ? isHistoricalView
    : isCurrentMonthPreview || isHistoricalView
  const officeRunActivityPhase =
    payload?.run != null ? worksheetOfficeRunActivity(payload.run) : null

  const showResetRun =
    payload !== null &&
    payload.run != null &&
    payload.run.is_historical !== true &&
    monthOk &&
    !Number.isNaN(idNum)

  const invalidParams =
    !routeId || Number.isNaN(idNum) || !monthIso ? (
      <Alert variant="danger">Missing route or month.</Alert>
    ) : !monthOk ? (
      <Alert variant="danger">Month must be first-of-month (example `2026-04-01`).</Alert>
    ) : null

  return (
    <div className={`technician-worksheet-page${isPortalMode ? ' technician-worksheet-page--portal' : ''}`}>
      {payload ? (
        <div ref={topbarRef} className="technician-worksheet-topbar card shadow-sm">
          <div className="card-body py-2 container-fluid px-0">
            <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 px-3">
              <div className="d-flex align-items-center gap-2">
                <Link
                  to={
                    isPortalMode
                      ? Number.isNaN(idNum)
                        ? '/tech/start'
                        : `/tech/route/${idNum}`
                      : Number.isNaN(idNum)
                        ? '/monthlies/routes'
                        : monthOk
                          ? `/monthlies/routes/${idNum}/paperwork?month=${encodeURIComponent(monthQuery)}`
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
                  <div className="small text-muted">
                    {isEmptyHistorical ? (
                      <>{formatMonthHeading(payload.month_date)} — no worksheet recorded</>
                    ) : isCurrentMonthPreview ? (
                      <>
                        {formatMonthHeading(payload.month_date)} — preview (run not started)
                      </>
                    ) : isHistoricalView ? (
                      <>{formatMonthHeading(payload.month_date)} — historical</>
                    ) : (
                      <>{formatMonthHeading(payload.month_date)} run</>
                    )}
                  </div>
                  {!worksheetFrozenNoRun ? (
                    (() => {
                      const startedLabel = formatRunStartedAt(payload.run?.started_at ?? null)
                      const completedLabel = formatRunStartedAt(payload.run?.completed_at ?? null)
                      return (
                        <>
                          {startedLabel ? (
                            <div className="small text-muted">Field run started {startedLabel}</div>
                          ) : null}
                          {completedLabel ? (
                            <div className="small text-muted">Run completed {completedLabel}</div>
                          ) : null}
                        </>
                      )
                    })()
                  ) : null}
                  {!isPortalMode && officeRunActivityPhase != null ? (
                    <div className="small mt-1">
                      <Badge
                        bg={
                          officeRunActivityPhase === 'completed'
                            ? 'success'
                            : officeRunActivityPhase === 'active'
                              ? 'primary'
                              : 'secondary'
                        }
                        className={
                          officeRunActivityPhase === 'inactive'
                            ? 'fw-normal bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle'
                            : 'fw-normal'
                        }
                      >
                        {payload
                          ? runOfficeStatusPillLabel(
                              officeRunActivityPhase,
                              payload.month_date,
                              payload.route,
                            )
                          : 'No run file'}
                      </Badge>
                    </div>
                  ) : null}
                  {!isPortalMode && officeStopProgress.total > 0 ? (
                    <div className="small text-muted mt-1">
                      {officeStopProgress.tested} tested · {officeStopProgress.skipped} skipped ·{' '}
                      {officeStopProgress.annual} annual · {officeStopProgress.open} pending ·{' '}
                      {officeStopProgress.total} stops
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="d-flex align-items-center gap-2 flex-wrap justify-content-end">
                <Badge
                  bg={
                    syncState === 'conflict'
                      ? 'danger'
                      : syncState === 'syncing'
                        ? 'info'
                        : syncState === 'saved_offline'
                          ? 'secondary'
                          : undefined
                  }
                  className={
                    syncState === 'synced' ? 'bg-success-subtle text-success-emphasis' : undefined
                  }
                >
                  {syncState === 'conflict'
                    ? 'Conflict'
                    : syncState === 'syncing'
                      ? 'Syncing'
                      : syncState === 'saved_offline'
                        ? 'Saved offline'
                        : 'Synced'}
                </Badge>
                {showResetRun ? (
                  <Button
                    size="sm"
                    variant="outline-danger"
                    disabled={
                      resetRunBusy ||
                      worksheetGridEditing ||
                      activeEditorKey != null ||
                      timeInModalRow != null ||
                      timeOutModalRow != null ||
                      skipReasonModalRow != null
                    }
                    onClick={() => setResetRunModalOpen(true)}
                  >
                    Reset run
                  </Button>
                ) : null}
                {queueLength > 0 ? <span className="small text-muted">{queueLength} queued</span> : null}
              </div>
            </div>
            {syncMessage ? <div className="small text-danger mt-1 px-3">{syncMessage}</div> : null}
          </div>
          {!isEmptyHistorical && !showOfficeDashboard ? (
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
                    <th className="tw-col-address">
                      {isOfficeReadOnly && officeWorksheetStops.length > 0 ? 'Address / Site' : 'Address'}
                    </th>
                    <th className="tw-col-stacked-ark">
                      {isOfficeReadOnly && officeWorksheetStops.length > 0 ? 'Access' : 'Annual / Ring / Key #'}
                    </th>
                    <th className="tw-col-facp">
                      {isOfficeReadOnly && officeWorksheetStops.length > 0 ? 'Panel' : 'FACP'}
                    </th>
                    <th className="tw-col-monitoring">Monitoring</th>
                    <th className="tw-col-procedures">Testing Procedures</th>
                    <th className="tw-col-notes">
                      {isOfficeReadOnly && officeWorksheetStops.length > 0 ? 'Comments' : 'Location comments'}
                    </th>
                    <th className="tw-col-action">{isPortalMode ? 'Action' : 'Result'}</th>
                  </tr>
                </thead>
              </Table>
            </div>
          ) : null}
        </div>
      ) : null}
      <div
        className="container-fluid px-0"
        style={
          ({
            paddingTop: topbarHeight > 0 ? topbarHeight : 0,
            paddingBottom: showOfficeDashboard ? 0 : '1rem',
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
          {isEmptyHistorical ? (
            <Alert variant="secondary" className="mx-3">
              No worksheet recorded for this month on this route.
            </Alert>
          ) : null}
          {showOfficeDashboard ? renderOfficeDashboard() : (
          <Card className={`technician-worksheet-grid-card shadow-sm${isEmptyHistorical ? ' d-none' : ''}`}>
            <Card.Body className="p-0">
              <div
                ref={tableScrollRef}
                className="technician-worksheet-table-wrap"
                onScroll={() => syncWorksheetHorizontalScroll('table')}
              >
                <Table
                  size="sm"
                  className="mb-0 align-middle technician-worksheet-table technician-worksheet-table--body-only"
                >
                  <WorksheetTableColGroup />
                  <tbody>
                    {payload.rows.map((row, index) => (
                      <tr
                        role="row"
                        key={`${row.location_id}-${row.month_date}`}
                        className={worksheetRowStatusClass(row, payload.month_date)}
                      >
                        {(() => {
                          const annualKey = `annual_month:${row.location_id}`
                          const ringKey = `ring:${row.location_id}`
                          const keyNumberKey = `key_number:${row.location_id}`
                          const isHistorical = isHistoricalView
                          const outcomeColumnReadOnly = isHistorical || isOfficeReadOnly
                          const addressStatusClass = worksheetAddressCellStatusClass(
                            row,
                            payload.month_date,
                          )
                          const displayTimeIn = (row.time_in || '').trim()
                          const displayTimeOut = (row.time_out || '').trim()
                          const hasTimeIn = displayTimeIn.length > 0
                          const hasTimeOut = displayTimeOut.length > 0
                          const annualMatch = isAnnualForMonth(row.annual_month, payload.month_date)
                          /** Icons for tested/skipped when the Result column is non-interactive. */
                          const showHistoricalStatusIcons = outcomeColumnReadOnly
                          const worksheetResultKey = (row.result_status || '').trim().toLowerCase()
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
                            !worksheetFrozenNoRun &&
                            !isOfficeReadOnly &&
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
                            <div className="small text-muted">{worksheetReadOnlyDisplay(row.building)}</div>
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
                              readOnly={isOfficeReadOnly || worksheetFrozenNoRun || !isEditorActive(ringKey)}
                              autoFocus={isEditorActive(ringKey)}
                              onClick={
                                isOfficeReadOnly || worksheetFrozenNoRun ? undefined : (e) => activateEditorAndFocus(ringKey, e.currentTarget)
                              }
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
                              readOnly={isOfficeReadOnly || worksheetFrozenNoRun || !isEditorActive(keyNumberKey)}
                              autoFocus={isEditorActive(keyNumberKey)}
                              onClick={
                                isOfficeReadOnly || worksheetFrozenNoRun
                                  ? undefined
                                  : (e) => activateEditorAndFocus(keyNumberKey, e.currentTarget)
                              }
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
                              readOnly={isOfficeReadOnly || worksheetFrozenNoRun || !isEditorActive(annualKey)}
                              autoFocus={isEditorActive(annualKey)}
                              onClick={
                                isOfficeReadOnly || worksheetFrozenNoRun
                                  ? undefined
                                  : (e) => activateEditorAndFocus(annualKey, e.currentTarget)
                              }
                              onBlur={(e) => {
                                onFieldChange(row, 'annual_month', e.target.value)
                                if (activeEditorKey === annualKey) setActiveEditorKey(null)
                              }}
                            />
                          </div>
                        </td>
                        {renderWorksheetGridColumnTd(row, 'facp', 'tw-col-facp')}
                        {renderWorksheetGridColumnTd(row, 'monitoring', 'tw-col-monitoring')}
                        {renderWorksheetGridColumnTd(row, 'testing_procedures', 'tw-col-procedures')}
                        {renderWorksheetGridColumnTd(row, 'inspection_tech_notes', 'tw-col-notes')}
                        <td className="tw-col-action">
                          <div className={`d-grid gap-1${outcomeColumnReadOnly ? ' text-center' : ''}`}>
                            {worksheetFrozenNoRun ? (
                              <div className="small text-muted text-center">Start run to log testing.</div>
                            ) : outcomeColumnReadOnly ? (
                              <>
                                {worksheetResultKey === 'tested' ? (
                                  <div className="fw-semibold small d-flex align-items-center justify-content-center gap-1">
                                    {showHistoricalStatusIcons ? (
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
                                      {showHistoricalStatusIcons ? (
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
                                ) : (
                                  <div className="small text-muted">—</div>
                                )}
                                {showWorksheetTimeInLine ? (
                                  <div className="text-muted tw-worksheet-time-io-line">
                                    {worksheetTimeInOutDisplayLine('in', displayTimeIn)}
                                  </div>
                                ) : null}
                                {showWorksheetTimeOutLine ? (
                                  <div className="text-muted tw-worksheet-time-io-line">
                                    {worksheetTimeInOutDisplayLine('out', displayTimeOut)}
                                  </div>
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
                                      variant="success"
                                      onClick={() => openTimeInModal(row)}
                                    >
                                      Time In
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline-secondary"
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
                                      <div className="text-muted tw-worksheet-time-io-line">
                                        {worksheetTimeInOutDisplayLine('in', displayTimeIn)}
                                      </div>
                                    ) : null}
                                    {showWorksheetTimeOutLine ? (
                                      <div className="text-muted tw-worksheet-time-io-line">
                                        {worksheetTimeInOutDisplayLine('out', displayTimeOut)}
                                      </div>
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
                                              variant="outline-secondary"
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
                                              onClick={() => openTimeInModal(row)}
                                            >
                                              Time In
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="warning"
                                              onClick={() => {
                                                pendingTimeOutForSkipModalRef.current = null
                                                setSkipReasonModalRow(row)
                                                setSkipReasonDraft(row.skip_reason || '')
                                              }}
                                            >
                                              Skip
                                            </Button>
                                            {annualMatch && annualTestAnywayRows.has(row.location_id) ? (
                                              <Button
                                                size="sm"
                                                variant="outline-secondary"
                                                onClick={() =>
                                                  setAnnualTestAnywayRows((prev) => {
                                                    const next = new Set(prev)
                                                    next.delete(row.location_id)
                                                    return next
                                                  })
                                                }
                                              >
                                                Cancel
                                              </Button>
                                            ) : null}
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
                                        <Button size="sm" variant="danger" onClick={() => window.alert('Deficiency workflow next phase')}>
                                          Add Deficiency
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline-secondary"
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
                                    )}
                                  </>
                                )}
                              </>
                            )}
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
          )}
        </>
      ) : null}
      <Modal
        show={resetRunModalOpen}
        onHide={() => {
          if (!resetRunBusy) setResetRunModalOpen(false)
        }}
        centered
        backdrop={resetRunBusy ? 'static' : true}
      >
        <Modal.Header closeButton={!resetRunBusy}>
          <Modal.Title className="h6 mb-0">Reset this run?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="mb-2">
            This clears everything recorded during this run for this month: tested/skipped outcomes,{' '}
            clock events, <strong>Time In</strong> / <strong>Time Out</strong>, run comments, billing status on
            each site, and any field edits (panel, annual month, door codes, etc.). Worksheet rows
            are restored from the library master. The <strong>field run started</strong> timestamp
            is cleared.
          </p>
          <p className="mb-0 small text-muted">
            Use this when you need a clean restart. Completed jobs must be reopened first.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="sm" disabled={resetRunBusy} onClick={() => setResetRunModalOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" disabled={resetRunBusy} onClick={() => void onConfirmResetRun()}>
            {resetRunBusy ? (
              <>
                <Spinner animation="border" size="sm" className="me-1" aria-hidden />
                Resetting…
              </>
            ) : (
              'Yes, reset run'
            )}
          </Button>
        </Modal.Footer>
      </Modal>
      <Modal show={isPortalMode && timeInModalRow != null} onHide={() => setTimeInModalRow(null)} centered>
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
              if (timeInBlockedForRow(timeInModalRow)) {
                window.alert(WORKSHEET_CLOCK_IN_BLOCKED_MESSAGE)
                return
              }
              queueRowChanges(timeInModalRow, {
                time_in: timeInDraft,
                time_out: null,
                result_status: null,
                skip_reason: null,
              })
              setTimeInModalRow(null)
            }}
          >
            Confirm Time In
          </Button>
        </Modal.Footer>
      </Modal>
      <Modal show={isPortalMode && timeOutModalRow != null} onHide={() => setTimeOutModalRow(null)} centered>
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
              pendingTimeOutForSkipModalRef.current = timeOutDraft
              setSkipReasonModalRow(timeOutModalRow)
              setSkipReasonDraft(timeOutModalRow.skip_reason || '')
              setTimeOutModalRow(null)
            }}
          >
            Skipped
          </Button>
        </Modal.Footer>
      </Modal>
      <Modal show={isPortalMode && skipReasonModalRow != null} onHide={dismissSkipReasonModal} centered>
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
          <Button variant="secondary" onClick={dismissSkipReasonModal}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!skipReasonModalRow) return
              const pendingOut = pendingTimeOutForSkipModalRef.current
              pendingTimeOutForSkipModalRef.current = null
              queueRowChanges(skipReasonModalRow, {
                ...(pendingOut != null ? { time_out: pendingOut } : {}),
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
