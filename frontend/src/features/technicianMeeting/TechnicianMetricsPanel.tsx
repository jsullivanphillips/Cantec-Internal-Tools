import { useState } from 'react'
import { Card, Form, Spinner } from 'react-bootstrap'
import { Chart } from 'react-chartjs-2'
import { type TopN } from './technicianMetricsCharts'
import { useTechnicianMetricsCharts } from './useTechnicianMetricsCharts'

type TechnicianMetricsPanelProps = {
  techData: Record<string, unknown> | null
  loading: boolean
}

export default function TechnicianMetricsPanel({ techData, loading }: TechnicianMetricsPanelProps) {
  const [techTopN, setTechTopN] = useState<TopN>(5)
  const { revenueChart, jobItemsChart, jobsCompletedChart, defsTechChart, attachmentsChart } =
    useTechnicianMetricsCharts(techData, techTopN)

  if (loading) {
    return (
      <div className="text-center py-5" aria-busy="true" aria-label="Loading technician metrics">
        <Spinner />
      </div>
    )
  }

  return (
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
    </>
  )
}
