import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Badge, Button, Card, Modal, Spinner, Table } from 'react-bootstrap'
import { Link, useParams } from 'react-router-dom'
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

type SyncState = 'synced' | 'saved_offline' | 'syncing' | 'conflict'

function hhmmNow(): string {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
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

function autosizeTextarea(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

export default function TechnicianWorksheetPage() {
  const { routeId, monthIso } = useParams<{ routeId: string; monthIso: string }>()
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
  const [topbarHeight, setTopbarHeight] = useState(0)
  const syncingRef = useRef(false)
  const topbarRef = useRef<HTMLDivElement | null>(null)

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
              <div>
                <div className="fw-semibold">{payload.route.label}</div>
                <div className="small text-muted">{formatMonthHeading(payload.month_date)}</div>
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
                <span className="small text-muted">{queueLength} queued</span>
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
        </div>
      ) : null}
      <div
        className="container-fluid py-3"
        style={topbarHeight ? { paddingTop: topbarHeight } : undefined}
      >
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <Link to={Number.isNaN(idNum) ? '/monthlies/routes' : `/monthlies/routes/${idNum}`} className="small">
          ← Back to route
        </Link>
        <Link to="/monthlies/routes" className="small text-muted">
          All routes
        </Link>
      </div>
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
              <div className="technician-worksheet-table-wrap">
                <Table size="sm" className="mb-0 align-middle technician-worksheet-table">
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
                  <tbody>
                    {payload.rows.map((row, index) => (
                      <tr
                        key={`${row.location_id}-${row.month_date}`}
                        className={isAnnualForMonth(row.annual_month, payload.month_date) ? 'tw-row-annual' : undefined}
                      >
                        {(() => {
                          const annualKey = `annual_month:${row.location_id}`
                          const ringKey = `ring:${row.location_id}`
                          const keyNumberKey = `key_number:${row.location_id}`
                          const facpKey = `facp:${row.location_id}`
                          const proceduresKey = `testing_procedures:${row.location_id}`
                          const notesKey = `inspection_tech_notes:${row.location_id}`
                          const annualMatch = isAnnualForMonth(row.annual_month, payload.month_date)
                          return (
                            <>
                        <td className="tw-col-order text-center tabular-nums">{index + 1}</td>
                        <td className="tw-col-address">
                          <div className="tw-address-block">
                            <div className="fw-semibold">{row.display_address}</div>
                            <div className="small text-muted">{'building name'}</div>
                            <div className="small text-muted">{row.property_management_company || '—'}</div>
                          </div>
                        </td>
                        <td className="tw-col-stacked-ark">
                          <div className="tw-stacked-cell">
                            <label className="tw-stacked-label">Annual</label>
                            <input
                              className={`form-control form-control-sm ${isEditorActive(annualKey) ? '' : 'tw-readonly-field'} ${
                                annualMatch ? 'tw-annual-current-month' : ''
                              }`}
                              defaultValue={row.annual_month ?? ''}
                              readOnly={!isEditorActive(annualKey)}
                              autoFocus={isEditorActive(annualKey)}
                              onClick={() => setActiveEditorKey(annualKey)}
                              onBlur={(e) => {
                                onFieldChange(row, 'annual_month', e.target.value)
                                if (activeEditorKey === annualKey) setActiveEditorKey(null)
                              }}
                            />
                            <label className="tw-stacked-label">Ring</label>
                            <input
                              className={`form-control form-control-sm ${isEditorActive(ringKey) ? '' : 'tw-readonly-field'}`}
                              defaultValue={row.ring ?? ''}
                              readOnly={!isEditorActive(ringKey)}
                              autoFocus={isEditorActive(ringKey)}
                              onClick={() => setActiveEditorKey(ringKey)}
                              onBlur={(e) => {
                                onFieldChange(row, 'ring', e.target.value)
                                if (activeEditorKey === ringKey) setActiveEditorKey(null)
                              }}
                            />
                            <label className="tw-stacked-label">Key #</label>
                            <input
                              className={`form-control form-control-sm ${isEditorActive(keyNumberKey) ? '' : 'tw-readonly-field'}`}
                              defaultValue={row.key_number ?? ''}
                              readOnly={!isEditorActive(keyNumberKey)}
                              autoFocus={isEditorActive(keyNumberKey)}
                              onClick={() => setActiveEditorKey(keyNumberKey)}
                              onBlur={(e) => {
                                onFieldChange(row, 'key_number', e.target.value)
                                if (activeEditorKey === keyNumberKey) setActiveEditorKey(null)
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
                            onClick={() => setActiveEditorKey(facpKey)}
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
                            onClick={() => setActiveEditorKey(proceduresKey)}
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
                            onClick={() => setActiveEditorKey(notesKey)}
                            onBlur={(e) => {
                              autosizeTextarea(e.currentTarget)
                              onFieldChange(row, 'inspection_tech_notes', e.target.value)
                              if (activeEditorKey === notesKey) setActiveEditorKey(null)
                            }}
                          />
                        </td>
                        <td className="tw-col-action">
                          <div className="d-grid gap-1">
                            {row.time_in ? (
                              <div className="small text-muted">Time In: {row.time_in}</div>
                            ) : null}
                            {row.time_out ? (
                              <div className="small text-muted">Time Out: {row.time_out}</div>
                            ) : null}
                            {!row.time_in ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="success"
                                  onClick={() => {
                                    setTimeInModalRow(row)
                                    setTimeInDraft(row.time_in || hhmmNow())
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
                            ) : !row.time_out ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="success"
                                  onClick={() => {
                                    setTimeOutModalRow(row)
                                    setTimeOutDraft(row.time_out || hhmmNow())
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
