import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/apiClient'
import { Alert, Button, Col, Form, Nav, Row, Spinner, Tab } from 'react-bootstrap'
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
    borderColor: '#add8e6',
    backgroundColor: '#add8e6',
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
    borderColor: '#add8e6',
    backgroundColor: '#add8e6',
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

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const p = params(start, end)
    try {
      const [lu, d, t, q] = await Promise.all([
        apiFetch(`/api/last_updated${p}`).then((r) => r.json()),
        apiFetch(`/api/performance/deficiencies${p}`).then((r) => r.json()),
        apiFetch(`/api/performance/technicians${p}`).then((r) => r.json()),
        apiFetch(`/api/performance/quotes${p}`).then((r) => r.json()),
      ])
      setLastUpdated(lu.last_updated || lu.latest || JSON.stringify(lu))
      setDefData(d)
      setTechData(t)
      setQuotesData(q)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [start, end])

  useEffect(() => {
    load()
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
            backgroundColor: ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2'],
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
          { label: 'No quote', data: svcData.map((d) => d.no_quote), backgroundColor: '#4e79a7' },
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
          { label: 'Submitted', data: quoteStats.map((d) => d.submitted), backgroundColor: '#4e79a7' },
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
            backgroundColor: 'rgba(12, 98, 166, 0.65)',
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

  return (
    <div className="container my-4">
      <h1 className="mb-4">Performance Summary</h1>
      <Row className="mb-3 g-2">
        <Col md={3}>
          <Form.Label>Start date</Form.Label>
          <Form.Control type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Col>
        <Col md={3}>
          <Form.Label>End date</Form.Label>
          <Form.Control type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Col>
        <Col md={3} className="d-flex align-items-end">
          <Button onClick={load} disabled={loading}>
            Apply
          </Button>
        </Col>
      </Row>
      <p className="text-muted small">Data last updated: {String(lastUpdated)}</p>
      {error && <Alert variant="danger">{error}</Alert>}
      {loading && (
        <div className="text-center py-5">
          <Spinner />
        </div>
      )}
      {!loading && (
        <Tab.Container defaultActiveKey="def">
          <Nav variant="tabs" className="mb-3">
            <Nav.Item>
              <Nav.Link eventKey="def">Deficiencies and quotes</Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link eventKey="tech">Technician metrics</Nav.Link>
            </Nav.Item>
          </Nav>
          <Tab.Content>
            <Tab.Pane eventKey="def">
              <Row className="g-3 mb-3">
                <Col md={6}>
                  <div className="border rounded p-3 bg-light">
                    <div className="small text-muted">Avg days (deficiency → quote)</div>
                    <div className="fs-5">{timeMetrics?.avg_days_deficiency_to_quote ?? '—'} days</div>
                  </div>
                </Col>
                <Col md={6}>
                  <div className="border rounded p-3 bg-light">
                    <div className="small text-muted">Avg days (quote → job)</div>
                    <div className="fs-5">{timeMetrics?.avg_days_quote_to_job ?? '—'} days</div>
                  </div>
                </Col>
              </Row>
              {funnelChart && (
                <div className="mb-4" style={{ maxHeight: 420 }}>
                  <h2 className="h5">Deficiency funnel</h2>
                  <Chart {...funnelChart} />
                </div>
              )}
              {svcLineChart && (
                <div className="mb-4" style={{ maxHeight: 480 }}>
                  <h2 className="h5">By service line</h2>
                  <Chart {...svcLineChart} />
                </div>
              )}
              {quoteUserChart && (
                <div className="mb-4" style={{ maxHeight: 440 }}>
                  <h2 className="h5">Quote activity by user</h2>
                  <Chart {...quoteUserChart} />
                </div>
              )}
              <h2 className="h5">Quote cost comparison (raw)</h2>
              <pre className="bg-white border rounded p-3 small" style={{ maxHeight: 240, overflow: 'auto' }}>
                {JSON.stringify(quotesData?.quote_cost_comparison_by_job_type ?? {}, null, 2)}
              </pre>
            </Tab.Pane>
            <Tab.Pane eventKey="tech">
              <Form.Select
                className="mb-3"
                style={{ maxWidth: 200 }}
                value={techTopN === 'all' ? 'all' : String(techTopN)}
                onChange={(e) => {
                  const v = e.target.value
                  setTechTopN(v === 'all' ? 'all' : Number(v))
                }}
              >
                <option value="5">Top 5 techs</option>
                <option value="10">Top 10</option>
                <option value="25">Top 25</option>
                <option value="all">All</option>
              </Form.Select>
              {revenueChart && (
                <div className="mb-4" style={{ maxHeight: 400 }}>
                  <h2 className="h5">Revenue per hour</h2>
                  <Chart {...revenueChart} />
                </div>
              )}
              {jobItemsChart && (
                <div className="mb-4" style={{ maxHeight: 360 }}>
                  <h2 className="h5">Job items created</h2>
                  <Chart {...jobItemsChart} />
                </div>
              )}
              {jobsCompletedChart && (
                <div className="mb-4" style={{ maxHeight: 420 }}>
                  <h2 className="h5">Jobs completed by type</h2>
                  <Chart {...jobsCompletedChart} />
                </div>
              )}
              {defsTechChart && (
                <div className="mb-4" style={{ maxHeight: 420 }}>
                  <h2 className="h5">Deficiencies by service line (by tech)</h2>
                  <Chart type="bar" data={defsTechChart.data} options={defsTechChart.options} />
                </div>
              )}
              {attachmentsChart && (
                <div className="mb-4" style={{ maxHeight: 400 }}>
                  <h2 className="h5">Attachments on deficiencies</h2>
                  <Chart {...attachmentsChart} />
                </div>
              )}
            </Tab.Pane>
          </Tab.Content>
        </Tab.Container>
      )}
    </div>
  )
}
