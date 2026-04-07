import { useCallback, useMemo, useState } from 'react'
import { apiJson } from '../lib/apiClient'
import { Accordion, Button, ButtonGroup, Col, Form, Row, Spinner } from 'react-bootstrap'
import { Chart } from 'react-chartjs-2'

function addDays(d: Date, n: number) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

function iso(d: Date) {
  return d.toISOString().slice(0, 10)
}

function metric1RangeDates(range: string): { dateAfter: string; dateBefore: string } {
  const end = new Date()
  const start = new Date()
  if (range === '1month') start.setMonth(end.getMonth() - 1)
  else if (range === '6weeks') start.setDate(end.getDate() - 42)
  else if (range === '3months') start.setMonth(end.getMonth() - 3)
  else if (range === '6months') start.setMonth(end.getMonth() - 6)
  else start.setMonth(end.getMonth() - 1)
  return { dateAfter: iso(start), dateBefore: iso(end) }
}

export default function DataAnalyticsPage() {
  const [m1Range, setM1Range] = useState('1month')
  const [m1, setM1] = useState<{ topCompanies: [string, number][] } | null>(null)
  const [m1Loading, setM1Loading] = useState(false)

  const [m2, setM2] = useState<{ monthlyTotals: { month: string; total: number }[] } | null>(null)
  const [m2Loading, setM2Loading] = useState(false)

  const [m3After, setM3After] = useState(() => iso(addDays(new Date(), -42)))
  const [m3Before, setM3Before] = useState(() => iso(new Date()))
  const [m3, setM3] = useState<{ scheduledJobs: { interval: string; job_count: number }[] } | null>(null)
  const [m3Loading, setM3Loading] = useState(false)

  const [m4Range, setM4Range] = useState('1week')
  const [m4, setM4] = useState<{ jobsCompleted: { interval: string; jobs_completed: number }[] } | null>(null)
  const [m4Loading, setM4Loading] = useState(false)

  const loadM1 = useCallback(async () => {
    setM1Loading(true)
    try {
      const { dateAfter, dateBefore } = metric1RangeDates(m1Range)
      const q = new URLSearchParams({ dateAfter, dateBefore })
      setM1(await apiJson(`/data-analytics/metric1?${q}`))
    } catch (e) {
      console.error(e)
      setM1(null)
    } finally {
      setM1Loading(false)
    }
  }, [m1Range])

  const loadM2 = useCallback(async () => {
    setM2Loading(true)
    try {
      setM2(await apiJson('/data-analytics/metric2'))
    } catch (e) {
      console.error(e)
      setM2(null)
    } finally {
      setM2Loading(false)
    }
  }, [])

  const loadM3 = useCallback(async () => {
    setM3Loading(true)
    try {
      const q = new URLSearchParams({ dateAfter: m3After, dateBefore: m3Before })
      setM3(await apiJson(`/data-analytics/metric3?${q}`))
    } catch (e) {
      console.error(e)
      setM3(null)
    } finally {
      setM3Loading(false)
    }
  }, [m3After, m3Before])

  const loadM4 = useCallback(async () => {
    setM4Loading(true)
    try {
      const q = new URLSearchParams({ range: m4Range })
      setM4(await apiJson(`/data-analytics/metric4?${q}`))
    } catch (e) {
      console.error(e)
      setM4(null)
    } finally {
      setM4Loading(false)
    }
  }, [m4Range])

  const chartM1 = useMemo(() => {
    if (!m1?.topCompanies?.length) return null
    const labels = m1.topCompanies.map(([name]) => name)
    const data = m1.topCompanies.map(([, v]) => v)
    return {
      labels,
      datasets: [
        {
          label: 'Invoice $',
          data,
          backgroundColor: 'rgba(78, 121, 167, 0.75)',
          borderRadius: 6,
        },
      ],
    }
  }, [m1])

  const chartM2 = useMemo(() => {
    if (!m2?.monthlyTotals?.length) return null
    return {
      labels: m2.monthlyTotals.map((r) => r.month),
      datasets: [
        {
          label: 'Monthly total',
          data: m2.monthlyTotals.map((r) => r.total),
          backgroundColor: 'rgba(40, 167, 69, 0.6)',
          borderRadius: 6,
        },
      ],
    }
  }, [m2])

  const chartM3 = useMemo(() => {
    if (!m3?.scheduledJobs?.length) return null
    return {
      labels: m3.scheduledJobs.map((r) => r.interval),
      datasets: [
        {
          label: 'Jobs scheduled',
          data: m3.scheduledJobs.map((r) => r.job_count),
          backgroundColor: 'rgba(111, 66, 193, 0.65)',
          borderRadius: 6,
        },
      ],
    }
  }, [m3])

  const chartM4 = useMemo(() => {
    if (!m4?.jobsCompleted?.length) return null
    return {
      labels: m4.jobsCompleted.map((r) => r.interval),
      datasets: [
        {
          label: 'Jobs completed',
          data: m4.jobsCompleted.map((r) => r.jobs_completed),
          backgroundColor: 'rgba(242, 142, 43, 0.75)',
          borderRadius: 6,
        },
      ],
    }
  }, [m4])

  const barOpts = {
    responsive: true,
    plugins: {
      legend: { display: true },
      datalabels: { display: false },
    },
    scales: {
      y: { beginAtZero: true },
    },
  }

  return (
    <div className="container py-4">
      <h1 className="h3 mb-4">Data Analytics</h1>
      <Accordion defaultActiveKey="m1">
        <Accordion.Item eventKey="m1">
          <Accordion.Header>Top companies by invoice amount</Accordion.Header>
          <Accordion.Body>
            <ButtonGroup className="mb-3">
              {(['1month', '6weeks', '3months', '6months'] as const).map((r) => (
                <Button
                  key={r}
                  variant={m1Range === r ? 'primary' : 'outline-primary'}
                  size="sm"
                  onClick={() => setM1Range(r)}
                >
                  {r === '1month'
                    ? '1 mo'
                    : r === '6weeks'
                      ? '6 wk'
                      : r === '3months'
                        ? '3 mo'
                        : '6 mo'}
                </Button>
              ))}
            </ButtonGroup>
            <Button size="sm" className="ms-2 mb-3" onClick={loadM1}>
              Load
            </Button>
            {m1Loading && <Spinner size="sm" className="ms-2" />}
            {chartM1 && (
              <div style={{ maxHeight: 420 }}>
                <Chart type="bar" data={chartM1} options={barOpts} />
              </div>
            )}
          </Accordion.Body>
        </Accordion.Item>

        <Accordion.Item eventKey="m2">
          <Accordion.Header>Monthly invoice totals (last year)</Accordion.Header>
          <Accordion.Body>
            <Button size="sm" className="mb-3" onClick={loadM2}>
              Load
            </Button>
            {m2Loading && <Spinner size="sm" className="ms-2" />}
            {chartM2 && (
              <div style={{ maxHeight: 420 }}>
                <Chart type="bar" data={chartM2} options={barOpts} />
              </div>
            )}
          </Accordion.Body>
        </Accordion.Item>

        <Accordion.Item eventKey="m3">
          <Accordion.Header>Jobs scheduled per week</Accordion.Header>
          <Accordion.Body>
            <Row className="g-2 mb-3 align-items-end">
              <Col xs="auto">
                <Form.Label className="small">From</Form.Label>
                <Form.Control type="date" value={m3After} onChange={(e) => setM3After(e.target.value)} />
              </Col>
              <Col xs="auto">
                <Form.Label className="small">To</Form.Label>
                <Form.Control type="date" value={m3Before} onChange={(e) => setM3Before(e.target.value)} />
              </Col>
              <Col xs="auto">
                <Button size="sm" onClick={loadM3}>
                  Load
                </Button>
              </Col>
            </Row>
            {m3Loading && <Spinner size="sm" />}
            {chartM3 && (
              <div style={{ maxHeight: 420 }}>
                <Chart type="bar" data={chartM3} options={barOpts} />
              </div>
            )}
          </Accordion.Body>
        </Accordion.Item>

        <Accordion.Item eventKey="m4">
          <Accordion.Header>Jobs completed after scheduling</Accordion.Header>
          <Accordion.Body>
            <Form.Select
              className="mb-3"
              style={{ maxWidth: 200 }}
              value={m4Range}
              onChange={(e) => setM4Range(e.target.value)}
            >
              <option value="1week">1 week</option>
              <option value="4weeks">4 weeks</option>
              <option value="3months">3 months</option>
              <option value="6months">6 months</option>
            </Form.Select>
            <Button size="sm" className="mb-3" onClick={loadM4}>
              Load
            </Button>
            {m4Loading && <Spinner size="sm" className="ms-2" />}
            {chartM4 && (
              <div style={{ maxHeight: 420 }}>
                <Chart type="bar" data={chartM4} options={barOpts} />
              </div>
            )}
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
    </div>
  )
}
