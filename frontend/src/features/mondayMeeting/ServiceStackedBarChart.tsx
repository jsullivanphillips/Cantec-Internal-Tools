import type { ChartData, ChartOptions } from 'chart.js'
import type { ActiveElement, ChartEvent } from 'chart.js'
import { Chart } from 'react-chartjs-2'
import type { SlaModalView } from './ScheduledWithinSlaGoalTile'
import type { SlaBucketSegment } from './serviceVisualChartBuilders'

function setChartCursor(event: ChartEvent, elements: ActiveElement[]) {
  const canvas = event.native?.target as HTMLCanvasElement | undefined
  if (canvas) canvas.style.cursor = elements.length ? 'pointer' : 'default'
}

function ServiceStackedBarLegend({
  segments,
  onSegmentClick,
}: {
  segments: SlaBucketSegment[]
  onSegmentClick?: (key: SlaModalView) => void
}) {
  return (
    <ul className="monday-meeting-service-chart-legend" aria-label="Chart legend">
      {segments.map((segment) => {
        const disabled = segment.count === 0
        const content = (
          <>
            <span
              className="monday-meeting-service-chart-legend__swatch"
              style={{ backgroundColor: segment.color }}
              aria-hidden
            />
            <span className="monday-meeting-service-chart-legend__label">{segment.label}</span>
            <span className="monday-meeting-service-chart-legend__count">{segment.count}</span>
          </>
        )

        return (
          <li key={segment.key} className="monday-meeting-service-chart-legend__item">
            {onSegmentClick && !disabled ? (
              <button
                type="button"
                className="monday-meeting-service-chart-legend__btn"
                onClick={() => onSegmentClick(segment.key)}
              >
                {content}
              </button>
            ) : (
              <span
                className={`monday-meeting-service-chart-legend__btn${
                  disabled ? ' monday-meeting-service-chart-legend__btn--disabled' : ''
                }`}
              >
                {content}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

type Props = {
  data: ChartData<'bar'>
  options: ChartOptions<'bar'>
  segments: SlaBucketSegment[]
  onSegmentClick?: (key: SlaModalView) => void
}

export default function ServiceStackedBarChart({ data, options, segments, onSegmentClick }: Props) {
  const chartOptions: ChartOptions<'bar'> = {
    ...options,
    onClick: (_event, elements) => {
      if (!elements.length || !onSegmentClick) return
      const segment = segments[elements[0]?.datasetIndex ?? -1]
      if (segment && segment.count > 0) onSegmentClick(segment.key)
    },
    onHover: setChartCursor,
  }

  return (
    <div className="monday-meeting-service-stacked-chart">
      <div className="monday-meeting-service-chart-wrap monday-meeting-service-chart-wrap--stacked-bar">
        <Chart type="bar" data={data} options={chartOptions} />
      </div>
      <ServiceStackedBarLegend segments={segments} onSegmentClick={onSegmentClick} />
    </div>
  )
}
