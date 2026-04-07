import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch, apiJson } from '../lib/apiClient'
import {
  buildHoursDatasets,
  buildJobsDatasets,
  type MetricsPayload,
} from '../lib/schedulingForecastCharts'
import {
  Button,
  Card,
  Col,
  Form,
  Nav,
  Row,
  Spinner,
  Tab,
  Table,
} from 'react-bootstrap'
import { Chart } from 'react-chartjs-2'

type V2Row = {
  id: number
  location_id: number
  address: string
  matched_on: string
  scheduled: boolean
  scheduled_date: string | null
  confirmed: boolean
  reached_out: boolean
  completed: boolean
  canceled: boolean
  notes: string
}

function currentMonthYm() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function isCanceled(r: V2Row) {
  return !!r.canceled
}
function isScheduledLike(r: V2Row) {
  return !!r.scheduled || !!r.completed
}
function isConfirmed(r: V2Row) {
  return !!r.confirmed
}
function isReachedOut(r: V2Row) {
  return !!r.reached_out
}

export default function SchedulingAttackPage() {
  const [metrics, setMetrics] = useState<MetricsPayload | null>(null)
  const [includeTravel, setIncludeTravel] = useState(true)
  const [metricsLoading, setMetricsLoading] = useState(true)

  const [month, setMonth] = useState(currentMonthYm)
  const [v2rows, setV2rows] = useState<V2Row[]>([])
  const [v2loading, setV2loading] = useState(false)
  const [kpis, setKpis] = useState<{ confirmed_pct?: number } | null>(null)

  const loadMetrics = useCallback(async () => {
    setMetricsLoading(true)
    try {
      const q = new URLSearchParams({ include_travel: includeTravel ? 'true' : 'false' })
      const r = await apiFetch(`/scheduling_attack/metrics?${q}`)
      setMetrics(await r.json())
    } catch (e) {
      console.error(e)
      setMetrics(null)
    } finally {
      setMetricsLoading(false)
    }
  }, [includeTravel])

  useEffect(() => {
    loadMetrics()
  }, [loadMetrics])

  const loadV2 = useCallback(async () => {
    setV2loading(true)
    try {
      const j = await apiJson<{ rows: V2Row[] }>(`/scheduling_attack/v2?month=${encodeURIComponent(month)}`)
      setV2rows(j.rows || [])
    } catch (e) {
      console.error(e)
      setV2rows([])
    } finally {
      setV2loading(false)
    }
  }, [month])

  useEffect(() => {
    loadV2()
  }, [loadV2])

  useEffect(() => {
    apiJson<{ confirmed_pct: number }>('/scheduling_attack/v2/kpis')
      .then(setKpis)
      .catch(console.error)
  }, [])

  const currentMonthNum = new Date().getMonth() + 1
  const hoursPack = useMemo(() => {
    if (!metrics) return null
    return buildHoursDatasets(metrics, includeTravel, currentMonthNum)
  }, [metrics, includeTravel, currentMonthNum])

  const jobsPack = useMemo(() => {
    if (!metrics) return null
    return buildJobsDatasets(metrics, currentMonthNum)
  }, [metrics, currentMonthNum])

  const hoursChartData = useMemo(() => {
    if (!hoursPack) return null
    return {
      labels: hoursPack.labels,
      datasets: [...hoursPack.hoursDatasets, hoursPack.capacityDataset],
    }
  }, [hoursPack])

  const jobsChartData = useMemo(() => {
    if (!jobsPack) return null
    return { labels: jobsPack.labels, datasets: jobsPack.jobsDatasets }
  }, [jobsPack])

  const stackOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true },
      datalabels: { display: false },
      tooltip: {
        mode: 'index' as const,
        intersect: false,
        callbacks: {
          afterBody: (items: { dataIndex: number }[]) => {
            try {
              const i = items[0]?.dataIndex
              if (i == null || !hoursPack) return ''
              const cap = Number(hoursPack.capacityByMonth[i] ?? 0)
              if (!cap) return ''
              const used = hoursPack.hoursDatasets.reduce((sum, ds) => {
                const v = ds.data[i]
                return sum + (typeof v === 'number' ? v : 0)
              }, 0)
              const pct = used ? (used / cap) * 100 : 0
              return `Utilization: ${pct.toFixed(1)}%`
            } catch {
              return ''
            }
          },
        },
      },
    },
    scales: {
      x: { stacked: true },
      y: {
        stacked: true,
        beginAtZero: true,
        ticks: {
          callback: (v: string | number) =>
            Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 }),
        },
      },
    },
  }

  const jobsOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: true }, datalabels: { display: false } },
    scales: {
      x: { stacked: true },
      y: { stacked: true, beginAtZero: true },
    },
  }

  const unscheduled = v2rows.filter((r) => !isCanceled(r) && !isScheduledLike(r))
  const canceled = v2rows.filter((r) => isCanceled(r))
  const needsOutreach = v2rows.filter((r) => {
    if (isCanceled(r)) return false
    if (!isScheduledLike(r)) return false
    if (isConfirmed(r)) return false
    if (isReachedOut(r)) return false
    return true
  })

  const postReachedOut = async (id: number) => {
    await apiJson('/scheduling_attack/v2/reached_out', {
      method: 'POST',
      body: JSON.stringify({ id, reached_out: true }),
    })
    await loadV2()
  }

  const saveNotes = async (id: number, notes: string) => {
    await apiJson('/scheduling_attack/v2/notes', {
      method: 'POST',
      body: JSON.stringify({ id, notes }),
    })
    await loadV2()
  }

  return (
    <div className="container-fluid py-3 px-2">
      <h1 className="h3 mb-3">Scheduling Attack</h1>
      <Tab.Container defaultActiveKey="status">
        <Nav variant="tabs" className="mb-3">
          <Nav.Item>
            <Nav.Link eventKey="status">Scheduling Attack</Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link eventKey="forecast">Forecast</Nav.Link>
          </Nav.Item>
        </Nav>
        <Tab.Content>
          <Tab.Pane eventKey="forecast">
            <Form.Check
              type="switch"
              id="sa-travel"
              className="mb-3"
              label="Include travel time"
              checked={includeTravel}
              onChange={(e) => setIncludeTravel(e.target.checked)}
            />
            {metrics && (
              <Row className="g-2 mb-2">
                <Col md={6}>
                  <div className="border rounded p-2 bg-light">
                    <div className="small text-muted">Active techs</div>
                    <div className="fs-5">{metrics.num_active_techs ?? '—'}</div>
                  </div>
                </Col>
              </Row>
            )}
            {metricsLoading && (
              <div className="text-center py-4">
                <Spinner />
              </div>
            )}
            {!metricsLoading && hoursChartData && (
              <Card className="mb-4">
                <Card.Header>
                  {includeTravel ? 'Tech hours per month (incl. travel)' : 'Tech hours per month (onsite only)'}
                </Card.Header>
                <Card.Body style={{ minHeight: 360 }}>
                  <Chart type="bar" data={hoursChartData} options={stackOpts} />
                </Card.Body>
              </Card>
            )}
            {!metricsLoading && jobsChartData && (
              <Card>
                <Card.Header>Job counts per month</Card.Header>
                <Card.Body style={{ minHeight: 360 }}>
                  <Chart type="bar" data={jobsChartData} options={jobsOpts} />
                </Card.Body>
              </Card>
            )}
          </Tab.Pane>

          <Tab.Pane eventKey="status">
            <Row className="g-2 mb-3 align-items-end">
              <Col xs="auto">
                <Form.Label className="small">Month</Form.Label>
                <Form.Control type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
              </Col>
              <Col xs="auto">
                <Button size="sm" onClick={loadV2} disabled={v2loading}>
                  Refresh
                </Button>
              </Col>
              {kpis && (
                <Col>
                  <span className="text-muted small">
                    Confirmed (next 2 weeks): <strong>{kpis.confirmed_pct ?? '—'}%</strong>
                  </span>
                </Col>
              )}
            </Row>
            {v2loading && (
              <div className="text-center py-3">
                <Spinner size="sm" />
              </div>
            )}
            <p className="text-muted small">
              {unscheduled.length} unscheduled · {canceled.length} canceled · {needsOutreach.length} need outreach
            </p>

            <h2 className="h6 mt-3">Unscheduled</h2>
            <Table size="sm" striped bordered responsive>
              <thead>
                <tr>
                  <th>Address</th>
                  <th>Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {!unscheduled.length && (
                  <tr>
                    <td colSpan={3} className="text-muted">
                      No unscheduled jobs
                    </td>
                  </tr>
                )}
                {unscheduled.map((r) => (
                  <V2NotesRow key={r.id} row={r} onSave={saveNotes} />
                ))}
              </tbody>
            </Table>

            <h2 className="h6 mt-4">Needs outreach</h2>
            <Table size="sm" striped bordered responsive>
              <thead>
                <tr>
                  <th>Address</th>
                  <th>Scheduled</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {!needsOutreach.length && (
                  <tr>
                    <td colSpan={3} className="text-muted">
                      None
                    </td>
                  </tr>
                )}
                {needsOutreach.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a
                        href={`https://app.servicetrade.com/locations/${r.location_id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {r.address}
                      </a>
                    </td>
                    <td>{r.scheduled_date ? new Date(r.scheduled_date).toLocaleString() : '—'}</td>
                    <td>
                      <Button size="sm" variant="outline-primary" onClick={() => postReachedOut(r.id)}>
                        Mark reached out
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>

            <h2 className="h6 mt-4">Canceled</h2>
            <Table size="sm" striped bordered responsive>
              <thead>
                <tr>
                  <th>Address</th>
                </tr>
              </thead>
              <tbody>
                {!canceled.length && (
                  <tr>
                    <td className="text-muted">None</td>
                  </tr>
                )}
                {canceled.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a
                        href={`https://app.servicetrade.com/locations/${r.location_id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {r.address}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Tab.Pane>
        </Tab.Content>
      </Tab.Container>
    </div>
  )
}

function V2NotesRow({ row, onSave }: { row: V2Row; onSave: (id: number, notes: string) => Promise<void> }) {
  const [notes, setNotes] = useState(() => {
    const n = (row.notes || '').trim()
    return row.matched_on === 'planned_maintenance' ? `Planned Maintenance.\n${n}` : n
  })
  const [saving, setSaving] = useState(false)

  return (
    <tr>
      <td>
        <a href={`https://app.servicetrade.com/locations/${row.location_id}`} target="_blank" rel="noreferrer">
          {row.address}
        </a>
      </td>
      <td>
        <Form.Control
          as="textarea"
          rows={2}
          size="sm"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </td>
      <td>
        <Button
          size="sm"
          variant="outline-secondary"
          disabled={saving}
          onClick={async () => {
            setSaving(true)
            try {
              await onSave(row.id, notes)
            } finally {
              setSaving(false)
            }
          }}
        >
          Save
        </Button>
      </td>
    </tr>
  )
}
