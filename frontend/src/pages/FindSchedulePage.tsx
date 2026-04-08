import { useEffect, useState } from 'react'
import { apiFetch, apiJson, isAbortError } from '../lib/apiClient'
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Collapse,
  Dropdown,
  Form,
  Row,
  Spinner,
} from 'react-bootstrap'

type Tech = { id: number; name: string; type?: string }
type Grouped = Record<string, Tech[]>

type RowState = {
  tech_count: number
  technician_ids: number[]
  technician_types: string[]
  day_hours: number[]
}

type Assignment = {
  tech?: string
  span_dates?: string[]
  daily_hours?: Record<string, number>
  total_hours?: number
}

type CandidateBlock = {
  start_date?: string
  end_date?: string
  assignments?: Record<string, Assignment[]>
}

type ComputeResult = {
  candidate_blocks?: CandidateBlock[]
  tech_rows?: unknown[]
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function rowSelectionLabel(row: RowState, grouped: Grouped) {
  if (row.technician_types[0]) return row.technician_types[0]
  const techId = row.technician_ids[0]
  if (techId != null) {
    for (const techs of Object.values(grouped)) {
      const hit = techs.find((t) => t.id === techId)
      if (hit) return hit.name
    }
  }
  return 'Select technician...'
}

function fmtDate(iso?: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function FindSchedulePage() {
  const [grouped, setGrouped] = useState<Grouped>({})
  const [rows, setRows] = useState<RowState[]>([
    { tech_count: 1, technician_ids: [], technician_types: [], day_hours: [8] },
  ])
  const [weekdays, setWeekdays] = useState<number[]>([0, 1, 2, 3, 4])
  const [startTime, setStartTime] = useState('08:30')
  const [rrsc, setRrsc] = useState(false)
  const [projectsBlocking, setProjectsBlocking] = useState(false)
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingTechs, setLoadingTechs] = useState(true)
  const [paramsCollapsed, setParamsCollapsed] = useState(false)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    apiJson<Grouped>('/api/technicians', { signal: controller.signal })
      .then((data) => {
        if (active) setGrouped(data)
      })
      .catch((error) => {
        if (!isAbortError(error)) console.error(error)
      })
      .finally(() => {
        if (active) setLoadingTechs(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [])

  const toggleWeekday = (d: number) => {
    setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort()))
  }

  const updateRow = (i: number, patch: Partial<RowState>) => {
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)))
  }

  const addRow = () =>
    setRows((r) => [...r, { tech_count: 1, technician_ids: [], technician_types: [], day_hours: [8] }])

  const removeRow = (i: number) => setRows((r) => r.filter((_, j) => j !== i))

  const addDay = (i: number) => {
    setRows((r) =>
      r.map((row, j) => (j === i ? { ...row, day_hours: [...row.day_hours, 8] } : row))
    )
  }

  const removeDay = (i: number, di: number) => {
    setRows((r) =>
      r.map((row, j) => {
        if (j !== i) return row
        const next = row.day_hours.filter((_, k) => k !== di)
        return { ...row, day_hours: next.length ? next : [8] }
      })
    )
  }

  const updateDayHour = (i: number, di: number, val: number) => {
    setRows((r) =>
      r.map((row, j) => {
        if (j !== i) return row
        const next = [...row.day_hours]
        next[di] = Number.isFinite(val) ? val : 0
        return { ...row, day_hours: next }
      })
    )
  }

  const submit = async () => {
    setError(null)
    setParamsCollapsed(true)
    setLoading(true)
    try {
      const body = {
        rows: rows.map((row) => ({
          tech_count: row.tech_count,
          technician_ids: row.technician_ids,
          technician_types: row.technician_types,
          day_hours: row.day_hours,
        })),
        include_rrsc: rrsc,
        include_projects_blocking: projectsBlocking,
        weekdays,
        start_time: startTime,
      }
      const data = await apiJson<unknown>('/api/scheduling/compute', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      setResult(data)
    } catch (e) {
      if (result == null) setParamsCollapsed(false)
      const err = e as { error?: string }
      setError(typeof err === 'object' && err && 'error' in err ? String(err.error) : String(e))
    } finally {
      setLoading(false)
    }
  }

  const patchTechType = async (id: number, type: string) => {
    await apiFetch(`/api/technicians/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type }),
    })
    setGrouped(await apiJson('/api/technicians'))
  }

  if (loadingTechs) {
    return (
      <div className="container-fluid py-3 px-1">
        <div className="find-sched-page py-4 text-center text-muted">
          <Spinner animation="border" className="text-primary" role="status" />
          <div className="small mt-2">Loading technicians…</div>
        </div>
      </div>
    )
  }

  return (
    <div className="container-fluid py-3 px-1">
      <div className="find-sched-page">
      <Card className="app-surface-card mb-3">
        <Card.Body className="p-3 p-md-4">
          <h1 className="processing-page-title mb-1">Scheduling Assistant</h1>
          <p className="processing-page-subtitle mb-0">
            Build staffing requirements and find the best technician matches for your schedule.
          </p>
        </Card.Body>
      </Card>

      <Card className="app-surface-card mb-4">
        <Card.Header className="d-flex justify-content-between align-items-center flex-wrap gap-2">
          <div />
          {(result != null || loading) && (
            <Button
              variant="outline-secondary"
              size="sm"
              type="button"
              onClick={() => setParamsCollapsed((v) => !v)}
            >
              {paramsCollapsed ? 'Edit search' : 'Collapse'}
            </Button>
          )}
        </Card.Header>

        {paramsCollapsed && (
          <Card.Body className="py-2">
            <div className="small text-muted d-flex flex-wrap gap-3">
              <span>{rows.length} requirement row(s)</span>
              <span>
                Weekdays: {weekdays.length ? weekdays.map((i) => DAYS[i]).join(', ') : 'None'}
              </span>
              <span>Start: {startTime}</span>
              <span>RRSC: {rrsc ? 'Yes' : 'No'}</span>
              <span>Projects blocking: {projectsBlocking ? 'Yes' : 'No'}</span>
            </div>
          </Card.Body>
        )}

        <Collapse in={!paramsCollapsed}>
          <div>
            <Card.Body className="p-3 p-md-4">
              <div className="small text-uppercase fw-semibold text-muted mb-2">Step 1</div>
              <div className="find-sched-step-card mb-4">
                <div className="find-sched-req-head d-none d-md-grid px-3 py-2 rounded-top border border-bottom-0 bg-light text-muted small fw-semibold">
                  <div>Count</div>
                  <div>Technician / Category</div>
                  <div>Day requirements</div>
                  <div className="text-end">Actions</div>
                </div>
                {rows.map((row, i) => (
                  <div
                    key={i}
                    className={`find-sched-tech-row border bg-white p-3 ${i < rows.length - 1 ? '' : ''} ${i === 0 ? 'rounded-bottom' : ''}`}
                  >
                    <div className="find-sched-req-row d-grid align-items-center gap-3">
                <div className="d-flex align-items-center gap-2">
                    <Form.Control
                      type="number"
                      min={1}
                      value={row.tech_count}
                      onChange={(e) =>
                        updateRow(i, { tech_count: Number(e.target.value) || 1 })
                      }
                      className="find-sched-count-input text-center"
                      aria-label="Number of technicians"
                    />
                    <span className="text-secondary user-select-none px-1" aria-hidden>
                      ×
                    </span>
                </div>
                <div className="d-flex align-items-center gap-2">
                    <Dropdown
                      onSelect={(eventKey) => {
                        const v = String(eventKey || '')
                        if (!v) {
                          updateRow(i, { technician_ids: [], technician_types: [] })
                        } else if (v.startsWith('tech:')) {
                          updateRow(i, {
                            technician_ids: [Number(v.replace('tech:', ''))],
                            technician_types: [],
                          })
                        } else if (v.startsWith('type:')) {
                          updateRow(i, {
                            technician_ids: [],
                            technician_types: [v.replace('type:', '')],
                          })
                        }
                      }}
                      className="find-sched-tech-dropdown"
                    >
                      <Dropdown.Toggle
                        variant="primary"
                        className="find-sched-tech-select text-start border-0 shadow-sm"
                        style={{ minWidth: 160, maxWidth: 280 }}
                      >
                        {rowSelectionLabel(row, grouped)}
                      </Dropdown.Toggle>
                      <Dropdown.Menu className="find-sched-tech-menu">
                        <Dropdown.Item eventKey="">Clear selection</Dropdown.Item>
                        <Dropdown.Divider />
                        {Object.entries(grouped).map(([type, techs]) => (
                          <div key={type}>
                            <Dropdown.Item
                              eventKey={`type:${type}`}
                              className="find-sched-type-item fw-semibold"
                            >
                              {type}
                            </Dropdown.Item>
                            {techs.map((t) => (
                              <Dropdown.Item
                                key={t.id}
                                eventKey={`tech:${t.id}`}
                                className="find-sched-tech-item"
                              >
                                {t.name}
                              </Dropdown.Item>
                            ))}
                            <Dropdown.Divider />
                          </div>
                        ))}
                      </Dropdown.Menu>
                    </Dropdown>
                </div>
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  {row.day_hours.map((hours, di) => (
                    <div
                      key={di}
                      className="d-flex align-items-center gap-2"
                    >
                      <span className="small fw-semibold text-secondary text-nowrap">
                        Day {di + 1}:
                      </span>
                      <Form.Control
                        type="number"
                        min={0}
                        step={0.25}
                        value={hours}
                        onChange={(e) =>
                          updateDayHour(i, di, parseFloat(e.target.value) || 0)
                        }
                        className="find-sched-hours-input"
                        aria-label={`Hours for day ${di + 1}`}
                      />
                      <span className="small text-muted">hrs</span>
                      {row.day_hours.length > 1 && (
                        <Button
                          variant="light"
                          className="find-sched-remove-day-btn"
                          type="button"
                          onClick={() => removeDay(i, di)}
                          aria-label={`Remove day ${di + 1}`}
                        >
                          ×
                        </Button>
                      )}
                    </div>
                  ))}

                  <Button
                    variant="light"
                    size="sm"
                    type="button"
                    onClick={() => addDay(i)}
                    className="find-sched-add-day-btn w-100 text-nowrap"
                  >
                    + Add Day
                  </Button>
                </div>
                <div className="d-flex justify-content-start justify-content-md-end">
                {rows.length > 1 ? (
                  <Button
                    variant="light"
                    className="find-sched-remove-day-btn"
                    type="button"
                    onClick={() => removeRow(i)}
                    aria-label={`Remove requirement row ${i + 1}`}
                  >
                    ×
                  </Button>
                ) : (
                  <span />
                )}
                </div>
              </div>
                  </div>
                ))}

                <div className="mt-3">
                  <Button
                    variant="outline-primary"
                    size="lg"
                    type="button"
                    onClick={addRow}
                    className="find-sched-add-row-btn w-100"
                  >
                    + Add Tech Row
                  </Button>
                </div>
              </div>

              <div className="small text-uppercase fw-semibold text-muted mb-2">Step 2</div>

              <div className="find-sched-step-card mb-4">
                <div className="find-sched-pref-card mb-4">
                  <div className="text-center mb-2">
                    <span className="small fw-semibold text-secondary text-uppercase letter-spacing-wide">
                      Select Weekdays
                    </span>
                  </div>
                  <div className="d-flex flex-wrap justify-content-center gap-2">
                    {DAYS.map((d, idx) => {
                      const on = weekdays.includes(idx)
                      return (
                        <Button
                          key={d}
                          type="button"
                          size="sm"
                          variant={on ? 'success' : 'outline-secondary'}
                          className="find-sched-weekday-btn px-3"
                          onClick={() => toggleWeekday(idx)}
                          aria-pressed={on}
                        >
                          {d}
                        </Button>
                      )
                    })}
                  </div>
                </div>

                <div className="find-sched-pref-card">
                  <Row className="g-3 align-items-center justify-content-center">
                    <Col xs={12} sm="auto" className="text-center">
                      <Form.Label className="small text-muted mb-1">Start time after</Form.Label>
                      <Form.Control
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="find-sched-time-input"
                      />
                    </Col>
                    <Col xs={12} sm="auto" className="d-flex flex-column gap-2 align-items-center">
                      <Form.Check
                        type="checkbox"
                        id="findsched-rrsc"
                        label="Include RRSC"
                        checked={rrsc}
                        onChange={(e) => setRrsc(e.target.checked)}
                      />
                      <Form.Check
                        type="checkbox"
                        id="findsched-proj"
                        label="Include Projects Blocking"
                        checked={projectsBlocking}
                        onChange={(e) => setProjectsBlocking(e.target.checked)}
                      />
                    </Col>
                  </Row>
                </div>
              </div>

              <Button type="button" variant="primary" size="lg" className="w-100" onClick={submit} disabled={loading}>
                {loading ? 'Computing…' : 'Find Dates'}
              </Button>
            </Card.Body>
          </div>
        </Collapse>
      </Card>

      {paramsCollapsed && (
        <div className="mb-3">
          <Button type="button" variant="primary" onClick={submit} disabled={loading}>
            {loading ? 'Computing…' : 'Re-run search'}
          </Button>
        </div>
      )}

      {error && (
        <Alert variant="danger" className="mt-4">
          {error}
        </Alert>
      )}

      {result != null && (
        <Card className={`app-surface-card mt-4 ${loading ? 'find-sched-results-loading' : ''}`}>
          <Card.Header className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <span className="fw-semibold">Results</span>
            <div className="d-flex align-items-center gap-2">
              {loading && (
                <span className="d-inline-flex align-items-center gap-2 small text-muted">
                  <Spinner animation="border" size="sm" role="status" />
                  Refreshing…
                </span>
              )}
              <Badge bg="secondary">
                {((result as ComputeResult).candidate_blocks || []).length} option(s)
              </Badge>
            </div>
          </Card.Header>
          <Card.Body>
            {((result as ComputeResult).candidate_blocks || []).length === 0 ? (
              <Alert variant="warning" className="mb-0">
                No candidate blocks found for this configuration.
              </Alert>
            ) : (
              <div className="d-flex flex-column gap-3">
                {((result as ComputeResult).candidate_blocks || []).map((block, idx) => (
                  <Card key={idx} className="find-sched-result-card">
                    <Card.Body className="p-3 p-md-4">
                      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
                        <div className="fw-semibold">{fmtDate(block.start_date)}</div>
                        <div className="small text-muted">
                          {fmtDate(block.start_date)} - {fmtDate(block.end_date)}
                        </div>
                      </div>

                      <div className="d-flex flex-column gap-2">
                        {Object.entries(block.assignments || {}).map(([rowIdx, assignments]) => (
                          <div key={rowIdx} className="find-sched-result-row rounded-3 border p-2 p-md-3">
                            <div className="d-flex flex-column gap-2">
                              {(assignments || []).map((a, ai) => (
                                <div
                                  key={ai}
                                  className="d-flex justify-content-between align-items-start flex-wrap gap-2"
                                >
                                  <div>
                                    <div className="fw-semibold">{a.tech || 'Unknown tech'}</div>
                                    <div className="small text-muted">
                                      {(a.span_dates || []).map((d) => fmtDate(d)).join(', ') || 'No dates'}
                                    </div>
                                  </div>
                                  <div className="small">
                                    <Badge bg="light" text="dark" className="border">
                                      {(a.total_hours ?? 0).toFixed(2)} hrs total
                                    </Badge>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card.Body>
                  </Card>
                ))}
              </div>
            )}
          </Card.Body>
        </Card>
      )}

      <Accordion className="mt-5 find-sched-admin-accordion">
        <Accordion.Item eventKey="0">
          <Accordion.Header>Technician types (admin)</Accordion.Header>
          <Accordion.Body>
            <p className="text-muted small mb-3">
              Adjust grouping for each technician (saved to the database).
            </p>
            {Object.entries(grouped).map(([type, techs]) => (
              <div key={type} className="border rounded-3 p-3 mb-3 bg-white">
                <h3 className="h6 mb-2">{type}</h3>
                <ul className="list-unstyled mb-0">
                  {techs.map((t) => (
                    <li key={t.id} className="d-flex align-items-center gap-2 py-1 flex-wrap">
                      <span className="flex-grow-1">{t.name}</span>
                      <Form.Select
                        size="sm"
                        style={{ maxWidth: 220 }}
                        value={t.type || type}
                        onChange={(e) => patchTechType(t.id, e.target.value)}
                      >
                        {[
                          'Senior Tech',
                          'Mid-Level Tech',
                          'Junior Tech',
                          'Trainee Tech',
                          'Sprinkler Tech',
                          'Unassigned',
                        ].map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </Form.Select>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
      </div>
    </div>
  )
}
