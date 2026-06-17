import { memo, type ReactNode } from 'react'
import { Card } from 'react-bootstrap'
import TechnicianMeetingChart from './TechnicianMeetingChart'
import TechnicianTopKpiRow from './TechnicianTopKpiRow'
import { type TopN } from './technicianMetricsCharts'
import { useTechnicianMetricsCharts } from './useTechnicianMetricsCharts'
import { useTechnicianTopKpis } from './useTechnicianTopKpis'

type TechnicianMetricsPanelProps = {
  techData: Record<string, unknown> | null
  techTopN: TopN
}

const TechnicianChartCard = memo(function TechnicianChartCard({
  title,
  height,
  children,
}: {
  title: string
  height: number
  children: ReactNode
}) {
  return (
    <Card className="app-surface-card technician-meeting-chart-card">
      <Card.Body className="technician-meeting-chart-card__body">
        <h3 className="technician-meeting-chart-card__title">{title}</h3>
        <div className="technician-meeting-chart-wrap" style={{ height }}>
          {children}
        </div>
      </Card.Body>
    </Card>
  )
})

export default function TechnicianMetricsPanel({ techData, techTopN }: TechnicianMetricsPanelProps) {
  const topKpis = useTechnicianTopKpis(techData)
  const { jobItemsChart, jobsCompletedChart, defsCreatedChart, attachmentsChart } =
    useTechnicianMetricsCharts(techData, techTopN)

  const hasCharts = Boolean(jobItemsChart || jobsCompletedChart || defsCreatedChart || attachmentsChart)

  if (!hasCharts) {
    return (
      <p className="technician-meeting-empty mb-0">
        No technician metrics for this date range. Try widening the range or check that data has synced.
      </p>
    )
  }

  return (
    <>
      <TechnicianTopKpiRow kpis={topKpis} />

      <section className="technician-meeting-panel">
        <h2 className="technician-meeting-section-title">Productivity</h2>
        <div className="technician-meeting-charts-grid">
          {jobItemsChart ? (
            <TechnicianChartCard title="Job items added" height={jobItemsChart.height}>
              <TechnicianMeetingChart
                type={jobItemsChart.type}
                data={jobItemsChart.data}
                options={jobItemsChart.options}
              />
            </TechnicianChartCard>
          ) : null}
          {jobsCompletedChart ? (
            <TechnicianChartCard title="Jobs completed" height={jobsCompletedChart.height}>
              <TechnicianMeetingChart
                type={jobsCompletedChart.type}
                data={jobsCompletedChart.data}
                options={jobsCompletedChart.options}
              />
            </TechnicianChartCard>
          ) : null}
        </div>
      </section>

      {(defsCreatedChart || attachmentsChart) && (
        <section className="technician-meeting-panel">
          <h2 className="technician-meeting-section-title">Deficiencies</h2>
          <div className="technician-meeting-charts-grid">
            {defsCreatedChart ? (
              <TechnicianChartCard title="Deficiencies created" height={defsCreatedChart.height}>
                <TechnicianMeetingChart
                  type={defsCreatedChart.type}
                  data={defsCreatedChart.data}
                  options={defsCreatedChart.options}
                />
              </TechnicianChartCard>
            ) : null}
            {attachmentsChart ? (
              <TechnicianChartCard title="Attachments on deficiencies" height={attachmentsChart.height}>
                <TechnicianMeetingChart
                  type={attachmentsChart.type}
                  data={attachmentsChart.data}
                  options={attachmentsChart.options}
                />
              </TechnicianChartCard>
            ) : null}
          </div>
        </section>
      )}
    </>
  )
}
