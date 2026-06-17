import { type ReactNode, useMemo } from 'react'
import { Card, OverlayTrigger, Tooltip } from 'react-bootstrap'
import { Chart } from 'react-chartjs-2'
import type { ActiveElement, ChartEvent } from 'chart.js'
import { registerCharts } from '../../lib/chartRegister'
import SlaBucketModals from './SlaBucketModals'
import {
  DEFICIENCIES_REPAIRED_TOOLTIP,
  DEFICIENCY_COHORT_TOOLTIP,
  formatExclusionSubline,
  formatPct,
  PIPELINE_EXCLUSION_TOOLTIP,
} from './serviceMetricShared'
import type { ServiceMetrics } from './serviceMetricsTypes'
import ServiceStackedBarChart from './ServiceStackedBarChart'
import {
  buildApprovedQuotesBucketsStackedBar,
  buildDeficiencyFunnelChart,
  buildRepairedDoughnutChart,
  buildScheduledBucketsStackedBar,
  buildSlaSchedulingDoughnutChart,
} from './serviceVisualChartBuilders'
import type { ScheduledWithinSlaGoal } from './ScheduledWithinSlaGoalTile'
import type { SlaModalView } from './ScheduledWithinSlaGoalTile'
import { useSlaBucketModals } from './useSlaBucketModals'

registerCharts()

function setChartCursor(event: ChartEvent, elements: ActiveElement[]) {
  const canvas = event.native?.target as HTMLCanvasElement | undefined
  if (canvas) canvas.style.cursor = elements.length ? 'pointer' : 'default'
}

function ChartInfoButton({ id, label, tooltip }: { id: string; label: string; tooltip: string }) {
  return (
    <OverlayTrigger
      placement="top"
      trigger={['hover', 'focus']}
      overlay={
        <Tooltip id={id} className="monday-meeting-sla-info-tooltip">
          {tooltip}
        </Tooltip>
      }
    >
      <button type="button" className="monday-meeting-sla-info-btn" aria-label={`About ${label}`}>
        <i className="bi bi-info-circle" aria-hidden />
      </button>
    </OverlayTrigger>
  )
}

function VisualChartCard({
  title,
  tooltip,
  status,
  children,
  footer,
}: {
  title: string
  tooltip?: string
  status?: 'good' | 'warn' | 'neutral'
  children: ReactNode
  footer?: ReactNode
}) {
  const statusClass =
    status === 'good'
      ? 'monday-meeting-service-chart-card--good'
      : status === 'warn'
        ? 'monday-meeting-service-chart-card--warn'
        : 'monday-meeting-service-chart-card--neutral'

  return (
    <Card className={`app-surface-card monday-meeting-service-chart-card h-100 ${statusClass}`}>
      <Card.Body className="monday-meeting-service-chart-card__body">
        <div className="monday-meeting-service-chart-card__header">
          <h3 className="monday-meeting-service-chart-card__title">{title}</h3>
          {tooltip ? <ChartInfoButton id={`chart-${title}`} label={title} tooltip={tooltip} /> : null}
        </div>
        {children}
        {footer ? <div className="monday-meeting-service-chart-card__footer">{footer}</div> : null}
      </Card.Body>
    </Card>
  )
}

function DoughnutCenter({
  primary,
  secondary,
  tone,
}: {
  primary: string
  secondary: string
  tone: 'good' | 'warn'
}) {
  return (
    <div className={`monday-meeting-service-doughnut-center monday-meeting-service-doughnut-center--${tone}`}>
      <div className="monday-meeting-service-doughnut-center__primary">{primary}</div>
      <div className="monday-meeting-service-doughnut-center__secondary">{secondary}</div>
    </div>
  )
}

function EmptyChartMessage() {
  return <p className="monday-meeting-service-chart-empty text-muted small mb-0">No data for this quarter.</p>
}

type Props = {
  data: ServiceMetrics
  onOpenExcludedModal: () => void
}

export default function MondayMeetingServiceVisualsView({ data, onOpenExcludedModal }: Props) {
  const slaGoal = data.goals.scheduled_within_10_business_days as ScheduledWithinSlaGoal | undefined
  const modalState = useSlaBucketModals(slaGoal)
  const { openModal } = modalState

  const repairedChart = useMemo(
    () => buildRepairedDoughnutChart(data.goals.deficiencies_repaired),
    [data.goals.deficiencies_repaired],
  )
  const slaChart = useMemo(() => buildSlaSchedulingDoughnutChart(slaGoal), [slaGoal])
  const funnelChart = useMemo(
    () => buildDeficiencyFunnelChart(data.deficiency_pipeline, data.goals.deficiencies_repaired.repaired_count),
    [data.deficiency_pipeline, data.goals.deficiencies_repaired.repaired_count],
  )
  const scheduledBar = useMemo(() => buildScheduledBucketsStackedBar(slaGoal), [slaGoal])
  const approvedBar = useMemo(() => buildApprovedQuotesBucketsStackedBar(slaGoal), [slaGoal])

  const exclusionSubline = formatExclusionSubline(data.deficiency_pipeline)
  const hasExcluded = (data.deficiency_pipeline.excluded_non_quoteable ?? 0) > 0

  const repairedOptions = useMemo(
    () => ({
      ...repairedChart.options,
      onClick: () => undefined,
    }),
    [repairedChart.options],
  )

  const slaOptions = useMemo(
    () => ({
      ...slaChart.options,
      onClick: (_event: ChartEvent, elements: ActiveElement[]) => {
        if (!elements.length) return
        const key = slaChart.modalKeys[elements[0]?.index ?? -1]
        if (key) openModal(key)
      },
      onHover: setChartCursor,
    }),
    [slaChart.options, slaChart.modalKeys, openModal],
  )

  const openSlaModal = (key: SlaModalView) => openModal(key)

  const slaCohortTooltip =
    'Counts deficiency repair quotes approved this quarter. SLA measures when office first scheduled the job (not the appointment date).'

  return (
    <>
      <div className="monday-meeting-service-visuals-grid">
        <div className="monday-meeting-service-visuals-grid__goal">
        <VisualChartCard
          title="Deficiencies repaired"
          tooltip={DEFICIENCIES_REPAIRED_TOOLTIP}
          status={repairedChart.slices.meetingGoal ? 'good' : 'warn'}
          footer={
            <div className="monday-meeting-service-detail-row">
              <span className="monday-meeting-service-tile__meta">
                {repairedChart.slices.repaired} of {data.goals.deficiencies_repaired.total_deficiencies}{' '}
                deficiencies repaired
              </span>
              {exclusionSubline ? (
                hasExcluded ? (
                  <button
                    type="button"
                    className="monday-meeting-service-tile__meta monday-meeting-service-tile__meta--link monday-meeting-excluded-link btn btn-link p-0"
                    onClick={onOpenExcludedModal}
                  >
                    {exclusionSubline}
                  </button>
                ) : (
                  <span className="monday-meeting-service-tile__meta monday-meeting-service-tile__meta--muted">
                    {exclusionSubline}
                  </span>
                )
              ) : null}
            </div>
          }
        >
          {repairedChart.slices.empty ? (
            <EmptyChartMessage />
          ) : (
            <div className="monday-meeting-service-chart-wrap monday-meeting-service-chart-wrap--doughnut">
              <Chart type="doughnut" data={repairedChart.data} options={repairedOptions} />
              <DoughnutCenter
                primary={`${formatPct(repairedChart.slices.actualPct)}%`}
                secondary={`Target ${repairedChart.slices.targetPct}%`}
                tone={repairedChart.slices.meetingGoal ? 'good' : 'warn'}
              />
            </div>
          )}
        </VisualChartCard>
        </div>

        <div className="monday-meeting-service-visuals-grid__goal">
        <VisualChartCard
          title={`Repairs scheduled within ${slaGoal?.business_day_limit ?? 10} business days`}
          tooltip={slaCohortTooltip}
          status={slaChart.meetingGoal ? 'good' : 'warn'}
          footer={
            <span className="monday-meeting-service-tile__meta">
              {slaChart.withinSla} of {slaChart.withinSla + slaChart.outsideSla} approved repair quotes
            </span>
          }
        >
          {slaChart.empty ? (
            <EmptyChartMessage />
          ) : (
            <div className="monday-meeting-service-chart-wrap monday-meeting-service-chart-wrap--doughnut">
              <Chart type="doughnut" data={slaChart.data} options={slaOptions} />
              <DoughnutCenter
                primary={`${formatPct(slaChart.actualPct)}%`}
                secondary={`Target ${slaChart.targetPct}%`}
                tone={slaChart.meetingGoal ? 'good' : 'warn'}
              />
            </div>
          )}
        </VisualChartCard>
        </div>

        <div className="monday-meeting-service-visuals-grid__pipeline">
          <VisualChartCard
            title="Deficiency pipeline"
            tooltip={`${DEFICIENCY_COHORT_TOOLTIP} ${PIPELINE_EXCLUSION_TOOLTIP}`}
            footer={
              exclusionSubline ? (
                hasExcluded ? (
                  <button
                    type="button"
                    className="monday-meeting-service-tile__meta monday-meeting-service-tile__meta--link monday-meeting-excluded-link btn btn-link p-0 text-start"
                    onClick={onOpenExcludedModal}
                  >
                    {exclusionSubline}
                  </button>
                ) : (
                  <span className="monday-meeting-service-tile__meta monday-meeting-service-tile__meta--muted">
                    {exclusionSubline}
                  </span>
                )
              ) : null
            }
          >
            {funnelChart.empty ? (
              <EmptyChartMessage />
            ) : (
              <div className="monday-meeting-service-chart-wrap monday-meeting-service-chart-wrap--funnel">
                <Chart type="bar" data={funnelChart.data} options={funnelChart.options} />
              </div>
            )}
          </VisualChartCard>
        </div>

        <div className="monday-meeting-service-visuals-grid__sla-half">
        <VisualChartCard title="Scheduled repair quotes">
          {scheduledBar.empty ? (
            <EmptyChartMessage />
          ) : (
            <ServiceStackedBarChart
              data={scheduledBar.data}
              options={scheduledBar.options}
              segments={scheduledBar.segments}
              onSegmentClick={openSlaModal}
            />
          )}
        </VisualChartCard>
        </div>

        <div className="monday-meeting-service-visuals-grid__sla-half">
        <VisualChartCard
          title="Unscheduled approved quotes"
          tooltip="Approved repair quotes from the selected quarter that do not yet have a scheduled repair job, grouped by SLA status."
        >
          {approvedBar.empty ? (
            <EmptyChartMessage />
          ) : (
            <ServiceStackedBarChart
              data={approvedBar.data}
              options={approvedBar.options}
              segments={approvedBar.segments}
              onSegmentClick={openSlaModal}
            />
          )}
        </VisualChartCard>
        </div>
      </div>

      <SlaBucketModals modalState={modalState} />
    </>
  )
}
