import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiFetch, isAbortError } from '../lib/apiClient'
import { Alert, Button, Card, Col, Form, Nav, Row, Spinner, Tab } from 'react-bootstrap'
import { Chart } from 'react-chartjs-2'

function params(start: string, end: string) {
  const q = new URLSearchParams()
  if (start) q.set('start_date', start)
  if (end) q.set('end_date', end)
  const s = q.toString()
  return s ? `?${s}` : ''
}

function formatLabelName(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function displayNameFromEmail(email: string) {
  const local = email.split('@')[0] || email
  const [first, last] = local.split('.')
  const initial = (first?.charAt(0) || '?').toUpperCase()
  const lastName = last ? last.charAt(0).toUpperCase() + last.slice(1) : ''
  return `${initial} ${lastName}`.trim()
}

type TopN = number | 'all'

function buildJobsCompletedDatasets(
  jobsPayload: {
    technicians?: string[]
    job_types?: string[]
    entries?: { technician: string; job_type: string; count: number }[]
  },
  topN: TopN,
) {
  const techsJobs = jobsPayload.technicians || []
  const jobTypes = jobsPayload.job_types || []
  const jobsEntries = jobsPayload.entries || []

  const lookupJobs: Record<string, Record<string, number>> = {}
  techsJobs.forEach((t) => {
    lookupJobs[t] = {}
  })
  jobsEntries.forEach(({ technician, job_type, count }) => {
    if (!lookupJobs[technician]) lookupJobs[technician] = {}
    lookupJobs[technician][job_type] = count
  })

  const totalsJobs = techsJobs
    .map((t) => ({
      tech: t,
      total: jobTypes.reduce((sum, jt) => sum + (lookupJobs[t]?.[jt] || 0), 0),
    }))
    .sort((a, b) => b.total - a.total)

  const N = topN === 'all' ? totalsJobs.length : topN
  const selectedTechsJ = totalsJobs.slice(0, N).map((d) => d.tech)

  const jobTypeTotals = jobTypes.map((jt) => ({
    jobType: jt,
    total: techsJobs.reduce((sum, tech) => sum + (lookupJobs[tech]?.[jt] || 0), 0),
  }))
  jobTypeTotals.sort((a, b) => b.total - a.total)
  const topJobTypes = jobTypeTotals.slice(0, 8).map((x) => x.jobType)
  const otherJobTypes = jobTypes.filter((jt) => !topJobTypes.includes(jt))
  const finalJobTypes = [...topJobTypes, 'Other']

  const paletteJobs = [
    '#c6d6ec',
    '#8eb0d6',
    '#4e79a7',
    '#2d527d',
    '#ffe0b3',
    '#f7b366',
    '#f28e2b',
    '#b6651a',
    '#678dbd',
    '#d1873d',
  ]

  const jobDatasets = finalJobTypes.map((jt, i) => {
    const data = selectedTechsJ.map((tech) => {
      if (jt === 'Other') {
        return otherJobTypes.reduce((sum, other) => sum + (lookupJobs[tech]?.[other] || 0), 0)
      }
      return lookupJobs[tech]?.[jt] || 0
    })
    return {
      label: formatLabelName(jt),
      data,
      type: 'bar' as const,
      backgroundColor: paletteJobs[i % paletteJobs.length],
    }
  })

  const jobTotalsByTech = selectedTechsJ.map((_, idx) =>
    jobDatasets.reduce((sum, ds) => sum + (ds.data[idx] as number), 0),
  )

  const totalJobsDataset = {
    label: 'Total Jobs',
    data: jobTotalsByTech,
    type: 'line' as const,
    yAxisID: 'y1',
    borderColor: '#164b7c',
    backgroundColor: '#164b7c',
    borderWidth: 2,
    fill: false,
    pointRadius: 4,
  }

  return {
    labels: selectedTechsJ,
    datasets: [...jobDatasets, totalJobsDataset],
    jobTotalsByTech,
  }
}

function buildDefsByTechDatasets(
  payload: {
    technicians?: string[]
    service_lines?: string[]
    entries?: { technician: string; service_line: string; count: number }[]
  },
  topN: TopN,
) {
  const techsDefs = payload.technicians || []
  const rawLines = payload.service_lines || []
  const defsEntries = payload.entries || []

  const lookupDefs: Record<string, Record<string, number>> = {}
  techsDefs.forEach((t) => {
    lookupDefs[t] = {}
  })
  defsEntries.forEach(({ technician, service_line, count }) => {
    if (!lookupDefs[technician]) lookupDefs[technician] = {}
    lookupDefs[technician][service_line] = count
  })

  const lineTotals = rawLines
    .map((sl) => ({
      line: sl,
      total: techsDefs.reduce((sum, t) => sum + (lookupDefs[t]?.[sl] || 0), 0),
    }))
    .sort((a, b) => b.total - a.total)
  const topLines = lineTotals.slice(0, 6).map((x) => x.line)
  const otherLines = rawLines.filter((sl) => !topLines.includes(sl))
  const finalLines = [...topLines, 'Other']

  const paletteDefs = [
    '#c6d6ec',
    '#8eb0d6',
    '#4e79a7',
    '#2d527d',
    '#ffe0b3',
    '#f7b366',
    '#f28e2b',
    '#b6651a',
    '#678dbd',
    '#d1873d',
  ]

  const defDatasets = finalLines.map((sl, idx) => {
    const data = techsDefs.map((tech) => {
      if (sl === 'Other') {
        return otherLines.reduce((sum, ol) => sum + (lookupDefs[tech]?.[ol] || 0), 0)
      }
      return lookupDefs[tech]?.[sl] || 0
    })
    return {
      label: sl,
      data,
      backgroundColor: paletteDefs[idx % paletteDefs.length],
    }
  })

  const totalsDefs = techsDefs
    .map((t) => ({
      tech: t,
      total: finalLines.reduce((sum, _sl, si) => {
        const ds = defDatasets[si]
        const idx = techsDefs.indexOf(t)
        return sum + (ds.data[idx] as number)
      }, 0),
    }))
    .sort((a, b) => b.total - a.total)

  const N = topN === 'all' ? totalsDefs.length : topN
  const selectedTechsD = totalsDefs.slice(0, N).map((d) => d.tech)

  const barDatasets = defDatasets.map((ds) => ({
    label: ds.label,
    data: selectedTechsD.map((tech) => ds.data[techsDefs.indexOf(tech)] as number),
    type: 'bar' as const,
    backgroundColor: ds.backgroundColor,
  }))

  const defTotalsByTech = selectedTechsD.map((_, i) =>
    barDatasets.reduce((sum, ds) => sum + (ds.data[i] as number), 0),
  )

  const totalDefsDataset = {
    label: 'Total Defs',
    data: defTotalsByTech,
    type: 'line' as const,
    yAxisID: 'y1',
    borderColor: '#164b7c',
    backgroundColor: '#164b7c',
    borderWidth: 2,
    fill: false,
    pointRadius: 4,
  }

  return { labels: selectedTechsD, datasets: [...barDatasets, totalDefsDataset], defTotalsByTech }
}

const noDatalabels = { datalabels: { display: false } }

export default function PerformanceSummaryPage() {
  const today = new Date()
  const defaultEnd = today.toISOString().slice(0, 10)
  const defaultStart = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10)

  const [start, setStart] = useState(defaultStart)
  const [end, setEnd] = useState(defaultEnd)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string>('—')
  const [defData, setDefData] = useState<Record<string, unknown> | null>(null)
  const [techData, setTechData] = useState<Record<string, unknown> | null>(null)
  const [quotesData, setQuotesData] = useState<Record<string, unknown> | null>(null)
  const [techTopN, setTechTopN] = useState<TopN>(5)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    const p = params(start, end)
    try {
      const [lu, d, t, q] = await Promise.all([
        apiFetch(`/api/last_updated${p}`, { signal }).then((r) => r.json()),
        apiFetch(`/api/performance/deficiencies${p}`, { signal }).then((r) => r.json()),
        apiFetch(`/api/performance/technicians${p}`, { signal }).then((r) => r.json()),
        apiFetch(`/api/performance/quotes${p}`, { signal }).then((r) => r.json()),
      ])
      if (signal?.aborted) return
      setLastUpdated(lu.last_updated || lu.latest || JSON.stringify(lu))
      setDefData(d)
      setTechData(t)
      setQuotesData(q)
    } catch (e) {
      if (isAbortError(e)) return
      console.error(e)
      setError('load_failed')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [start, end])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [])

  const deficiencyInsights = defData?.deficiency_insights as
    | {
        total_deficiencies?: number
        quoted_deficiencies?: number
        quoted_with_job?: number
        quoted_with_completed_job?: number
        percentages?: { quoted_pct?: number; job_created_pct?: number; job_completed_pct?: number }
      }
    | undefined

  const funnelChart = useMemo(() => {
    if (!deficiencyInsights) return null
    const total_d = deficiencyInsights.total_deficiencies ?? 0
    const p = deficiencyInsights.percentages || {}
    const funnelValues = [
      total_d,
      deficiencyInsights.quoted_deficiencies ?? 0,
      deficiencyInsights.quoted_with_job ?? 0,
      deficiencyInsights.quoted_with_completed_job ?? 0,
    ]
    const labels = [
      `Created (${total_d})`,
      `Quoted (${p.quoted_pct ?? 0}% of total)`,
      `Job created (${p.job_created_pct ?? 0}% of total)`,
      `Job completed (${p.job_completed_pct ?? 0}% of total)`,
    ]
    return {
      type: 'bar' as const,
      data: {
        labels,
        datasets: [
          {
            label: 'Funnel',
            data: funnelValues,
            backgroundColor: ['#164b7c', '#f58220', '#e15759', '#76b7b2'],
            borderRadius: 6,
          },
        ],
      },
      options: {
        indexAxis: 'y' as const,
        responsive: true,
        plugins: {
          legend: { display: false },
          datalabels: {
            color: '#fff',
            font: { weight: 'bold' as const, size: 11 },
            textStrokeColor: '#000',
            textStrokeWidth: 1,
            formatter: (v: number) => (typeof v === 'number' ? v.toLocaleString() : v),
          },
        },
        scales: {
          x: { beginAtZero: true },
        },
      },
    }
  }, [deficiencyInsights])

  const svcLineChart = useMemo(() => {
    const rows = defData?.deficiencies_by_service_line as
      | {
          service_line: string
          no_quote: number
          quoted_no_job: number
          quoted_to_job: number
          quoted_to_complete: number
        }[]
      | undefined
    if (!rows?.length) return null
    const svcData = [...rows].sort((a, b) => b.quoted_to_complete - a.quoted_to_complete)
    return {
      type: 'bar' as const,
      data: {
        labels: svcData.map((d) => d.service_line),
        datasets: [
          { label: 'No quote', data: svcData.map((d) => d.no_quote), backgroundColor: '#164b7c' },
          { label: 'Quoted, no job', data: svcData.map((d) => d.quoted_no_job), backgroundColor: '#f28e2b' },
          { label: 'Quoted → job', data: svcData.map((d) => d.quoted_to_job), backgroundColor: '#e15759' },
          { label: 'Job → completed', data: svcData.map((d) => d.quoted_to_complete), backgroundColor: '#76b7b2' },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'top' as const }, ...noDatalabels },
        scales: {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Deficiencies' } },
        },
      },
    }
  }, [defData])

  const timeMetrics = defData?.time_to_quote_metrics as
    | { avg_days_deficiency_to_quote?: number; avg_days_quote_to_job?: number }
    | undefined

  const quoteUserChart = useMemo(() => {
    const quoteStats = quotesData?.quote_statistics_by_user as
      | { user: string; submitted: number; accepted: number; canceled: number; rejected: number; draft: number }[]
      | undefined
    if (!quoteStats?.length) return null
    const displayNames = quoteStats.map((x) => displayNameFromEmail(x.user))
    return {
      type: 'bar' as const,
      data: {
        labels: displayNames,
        datasets: [
          { label: 'Submitted', data: quoteStats.map((d) => d.submitted), backgroundColor: '#164b7c' },
          { label: 'Accepted', data: quoteStats.map((d) => d.accepted), backgroundColor: '#59a14f' },
          { label: 'Canceled', data: quoteStats.map((d) => d.canceled), backgroundColor: '#e15759' },
          { label: 'Rejected', data: quoteStats.map((d) => d.rejected), backgroundColor: '#f28e2b' },
          { label: 'Draft', data: quoteStats.map((d) => d.draft), backgroundColor: '#bab0ac' },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'top' as const }, ...noDatalabels },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'Quotes' } },
        },
      },
    }
  }, [quotesData])

  const techMetrics = techData?.technician_metrics as
    | {
        revenue_per_hour?: Record<string, number>
        jobs_completed_by_tech?: Record<string, number>
        jobs_completed_by_tech_job_type?: {
          technicians?: string[]
          job_types?: string[]
          entries?: { technician: string; job_type: string; count: number }[]
        }
      }
    | undefined

  const revenueChart = useMemo(() => {
    const rev = techMetrics?.revenue_per_hour
    if (!rev || !Object.keys(rev).length) return null
    const pairs = Object.entries(rev).sort((a, b) => b[1] - a[1])
    const N = techTopN === 'all' ? pairs.length : techTopN
    const slice = pairs.slice(0, N)
    return {
      type: 'bar' as const,
      data: {
        labels: slice.map(([k]) => k),
        datasets: [
          {
            label: 'Revenue / hr',
            data: slice.map(([, v]) => v),
            backgroundColor: 'rgba(89, 161, 79, 0.75)',
            borderRadius: 6,
          },
        ],
      },
      options: {
        indexAxis: 'y' as const,
        responsive: true,
        plugins: { legend: { display: false }, ...noDatalabels },
        scales: {
          x: { beginAtZero: true, title: { display: true, text: '$ / hr' } },
        },
      },
    }
  }, [techMetrics, techTopN])

  const jobItemsChart = useMemo(() => {
    const ji = techData?.job_items_created_by_tech as
      | { technicians?: string[]; counts?: number[] }
      | undefined
    const techs = ji?.technicians || []
    const counts = ji?.counts || []
    if (!techs.length) return null
    const N = techTopN === 'all' ? techs.length : techTopN
    return {
      type: 'bar' as const,
      data: {
        labels: techs.slice(0, N),
        datasets: [
          {
            label: 'Job items',
            data: counts.slice(0, N),
            backgroundColor: 'rgba(22, 75, 124, 0.75)',
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: true }, ...noDatalabels },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    }
  }, [techData, techTopN])

  const jobsCompletedChart = useMemo(() => {
    const p = techMetrics?.jobs_completed_by_tech_job_type
    if (!p?.technicians?.length) return null
    const { labels, datasets, jobTotalsByTech } = buildJobsCompletedDatasets(p, techTopN)
    return {
      type: 'bar' as const,
      data: { labels, datasets },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top' as const },
          ...noDatalabels,
          tooltip: {
            mode: 'index' as const,
            intersect: false,
            callbacks: {
              title: (items: { label: string; dataIndex: number }[]) => {
                const tech = items[0]?.label
                const i = items[0]?.dataIndex
                const total = i != null ? jobTotalsByTech[i] : ''
                return `${tech} (total jobs: ${total})`
              },
            },
          },
        },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'Jobs' } },
          y1: {
            position: 'right' as const,
            beginAtZero: true,
            grid: { drawOnChartArea: false },
            title: { display: true, text: 'Total' },
          },
        },
      },
    }
  }, [techMetrics, techTopN])

  const defsTechChart = useMemo(() => {
    const p = techData?.deficiencies_by_tech_service_line as Parameters<typeof buildDefsByTechDatasets>[0] | undefined
    if (!p?.technicians?.length) return null
    const { labels, datasets, defTotalsByTech } = buildDefsByTechDatasets(p, techTopN)
    return {
      data: { labels, datasets },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top' as const },
          ...noDatalabels,
          tooltip: {
            mode: 'index' as const,
            intersect: false,
            callbacks: {
              title: (items: { label: string; dataIndex: number }[]) => {
                const tech = items[0]?.label
                const i = items[0]?.dataIndex
                const total = i != null ? defTotalsByTech[i] : ''
                return `${tech} (total defs: ${total})`
              },
            },
          },
        },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'Deficiencies' } },
          y1: {
            position: 'right' as const,
            beginAtZero: true,
            grid: { drawOnChartArea: false },
            title: { display: true, text: 'Total' },
          },
        },
      },
    }
  }, [techData, techTopN])

  const attachmentsChart = useMemo(() => {
    const attachments = techData?.attachments_by_tech as { technician: string; count: number }[] | undefined
    if (!attachments?.length) return null
    const sorted = [...attachments].sort((a, b) => b.count - a.count)
    const N = techTopN === 'all' ? sorted.length : techTopN
    const top = sorted.slice(0, N)
    return {
      type: 'bar' as const,
      data: {
        labels: top.map((d) => d.technician),
        datasets: [
          {
            label: 'Attachments',
            data: top.map((d) => d.count),
            backgroundColor: '#8eb0d6',
            borderRadius: 6,
          },
        ],
      },
      options: {
        indexAxis: 'y' as const,
        responsive: true,
        plugins: { legend: { display: false }, ...noDatalabels },
        scales: {
          x: { beginAtZero: true, title: { display: true, text: 'Attachments' } },
        },
      },
    }
  }, [techData, techTopN])

  const tabInner = (body: ReactNode) =>
    loading ? (
      <div className="text-center py-5" aria-busy="true" aria-label="Loading performance data">
        <Spinner />
      </div>
    ) : (
      body
    )

  return (
    <div className="performance-summary-page d-flex flex-column gap-3">
      <Card className="app-surface-card">
        <Card.Body className="p-3 p-md-4">
          <h1 className="processing-page-title mb-1">Performance Summary</h1>
          <p className="processing-page-subtitle mb-0">
            Deficiency and technician metrics for the date range you choose.
          </p>
        </Card.Body>
      </Card>

      <Card className="app-surface-card performance-filters-card">
        <Card.Body className="p-3 p-md-4">
          <Row className="g-3 align-items-end">
            <Col xs={12} sm={6} md={4} lg={3}>
              <Form.Group>
                <Form.Label className="small text-muted mb-1">Start date</Form.Label>
                <Form.Control type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </Form.Group>
            </Col>
            <Col xs={12} sm={6} md={4} lg={3}>
              <Form.Group>
                <Form.Label className="small text-muted mb-1">End date</Form.Label>
                <Form.Control type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </Form.Group>
            </Col>
            <Col xs={12} sm="auto">
              <Button
                type="button"
                variant="outline-secondary"
                className="performance-apply-btn"
                onClick={() => void load()}
                disabled={loading}
              >
                Apply
              </Button>
            </Col>
          </Row>
          <p className="text-muted small mt-3 mb-0">
            Data last updated: {String(lastUpdated)}
          </p>
          {error ? (
            <Alert variant="warning" className="mt-3 mb-0 py-2 small">
              Something went wrong loading this data. Try again, or pick a different range.
            </Alert>
          ) : null}
        </Card.Body>
      </Card>

      <Tab.Container defaultActiveKey="def">
        <div className="processing-tabs-shell app-surface-card">
          <Nav variant="tabs" className="mb-0 processing-tabs processing-tabs-shell__nav">
            <Nav.Item>
              <Nav.Link eventKey="def">Deficiencies and Quotes</Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link eventKey="tech">Technician Metrics</Nav.Link>
            </Nav.Item>
          </Nav>
          <Tab.Content className="processing-tabs-shell__panel">
            <Tab.Pane eventKey="def">
              {tabInner(
                <>
                  <Row className="g-3 mb-3">
                    <Col md={6}>
                      <Card className="app-surface-card h-100">
                        <Card.Body className="p-3">
                          <div className="small text-muted">Avg days (deficiency → quote)</div>
                          <div className="fs-5 fw-semibold text-dark">
                            {timeMetrics?.avg_days_deficiency_to_quote ?? '—'} days
                          </div>
                        </Card.Body>
                      </Card>
                    </Col>
                    <Col md={6}>
                      <Card className="app-surface-card h-100">
                        <Card.Body className="p-3">
                          <div className="small text-muted">Avg days (quote → job)</div>
                          <div className="fs-5 fw-semibold text-dark">
                            {timeMetrics?.avg_days_quote_to_job ?? '—'} days
                          </div>
                        </Card.Body>
                      </Card>
                    </Col>
                  </Row>
                  {funnelChart ? (
                    <Card className="app-surface-card performance-chart-card mb-3">
                      <Card.Header as="h2" className="h6 mb-0">
                        Deficiency funnel
                      </Card.Header>
                      <Card.Body className="p-3" style={{ minHeight: 360 }}>
                        <Chart {...funnelChart} />
                      </Card.Body>
                    </Card>
                  ) : null}
                  {svcLineChart ? (
                    <Card className="app-surface-card performance-chart-card mb-3">
                      <Card.Header as="h2" className="h6 mb-0">
                        By service line
                      </Card.Header>
                      <Card.Body className="p-3" style={{ minHeight: 400 }}>
                        <Chart {...svcLineChart} />
                      </Card.Body>
                    </Card>
                  ) : null}
                  {quoteUserChart ? (
                    <Card className="app-surface-card performance-chart-card mb-0">
                      <Card.Header as="h2" className="h6 mb-0">
                        Quote activity by user
                      </Card.Header>
                      <Card.Body className="p-3" style={{ minHeight: 360 }}>
                        <Chart {...quoteUserChart} />
                      </Card.Body>
                    </Card>
                  ) : null}
                </>,
              )}
            </Tab.Pane>
            <Tab.Pane eventKey="tech">
              {tabInner(
                <>
                  <Form.Group className="mb-3" style={{ maxWidth: 220 }}>
                    <Form.Label className="small text-muted mb-1">Top technicians</Form.Label>
                    <Form.Select
                      value={techTopN === 'all' ? 'all' : String(techTopN)}
                      onChange={(e) => {
                        const v = e.target.value
                        setTechTopN(v === 'all' ? 'all' : Number(v))
                      }}
                      aria-label="Number of technicians to show in charts"
                    >
                      <option value="5">Top 5</option>
                      <option value="10">Top 10</option>
                      <option value="25">Top 25</option>
                      <option value="all">All</option>
                    </Form.Select>
                  </Form.Group>
                  {revenueChart ? (
                    <Card className="app-surface-card performance-chart-card mb-3">
                      <Card.Header as="h2" className="h6 mb-0">
                        Revenue per hour
                      </Card.Header>
                      <Card.Body className="p-3" style={{ minHeight: 340 }}>
                        <Chart {...revenueChart} />
                      </Card.Body>
                    </Card>
                  ) : null}
                  {jobItemsChart ? (
                    <Card className="app-surface-card performance-chart-card mb-3">
                      <Card.Header as="h2" className="h6 mb-0">
                        Job items created
                      </Card.Header>
                      <Card.Body className="p-3" style={{ minHeight: 320 }}>
                        <Chart {...jobItemsChart} />
                      </Card.Body>
                    </Card>
                  ) : null}
                  {jobsCompletedChart ? (
                    <Card className="app-surface-card performance-chart-card mb-3">
                      <Card.Header as="h2" className="h6 mb-0">
                        Jobs completed by type
                      </Card.Header>
                      <Card.Body className="p-3" style={{ minHeight: 360 }}>
                        <Chart {...jobsCompletedChart} />
                      </Card.Body>
                    </Card>
                  ) : null}
                  {defsTechChart ? (
                    <Card className="app-surface-card performance-chart-card mb-3">
                      <Card.Header as="h2" className="h6 mb-0">
                        Deficiencies by service line (by tech)
                      </Card.Header>
                      <Card.Body className="p-3" style={{ minHeight: 360 }}>
                        <Chart type="bar" data={defsTechChart.data} options={defsTechChart.options} />
                      </Card.Body>
                    </Card>
                  ) : null}
                  {attachmentsChart ? (
                    <Card className="app-surface-card performance-chart-card mb-0">
                      <Card.Header as="h2" className="h6 mb-0">
                        Attachments on deficiencies
                      </Card.Header>
                      <Card.Body className="p-3" style={{ minHeight: 340 }}>
                        <Chart {...attachmentsChart} />
                      </Card.Body>
                    </Card>
                  ) : null}
                </>,
              )}
            </Tab.Pane>
          </Tab.Content>
        </div>
      </Tab.Container>
    </div>
  )
}
