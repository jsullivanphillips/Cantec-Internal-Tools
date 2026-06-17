import { memo } from 'react'
import { Chart, type ChartProps } from 'react-chartjs-2'

const TechnicianMeetingChart = memo(function TechnicianMeetingChart(props: ChartProps) {
  return <Chart {...props} redraw={false} />
})

export default TechnicianMeetingChart
