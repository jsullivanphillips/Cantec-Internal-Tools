import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch, apiJson, isAbortError } from '../lib/apiClient'
import LimboJobTrackerPanel from '../components/LimboJobTrackerPanel'
import { Button, Card, Col, Collapse, Form, Modal, Nav, Row, Tab, Table } from 'react-bootstrap'
import { Chart } from 'react-chartjs-2'
import type { ChartData, ChartOptions } from 'chart.js'

function properFormat(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** e.g. `service_call` → `Service call` (first word sentence-case, later words lowercase). */
function formatJobTypeSentence(raw: string): string {
  const s = raw.trim()
  if (!s) return '—'
  return s
    .replace(/_/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) =>
      i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase(),
    )
    .join(' ')
}

/** Last completed onsite job date for pink-folder modal; Pacific, e.g. Apr-07-2026. */
function formatPinkFolderJobDateMmmDdYyyy(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Vancouver',
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  }).formatToParts(d)
  const month = (parts.find((p) => p.type === 'month')?.value ?? '').replace(/\.$/, '')
  const day = parts.find((p) => p.type === 'day')?.value ?? ''
  const year = parts.find((p) => p.type === 'year')?.value ?? ''
  if (!month || !day || !year) return ''
  return `${month}-${day}-${year}`
}

/** Thresholds for KPI good (green) vs needs attention (red). Tune as operations evolve. */
const KPI_TARGETS = {
  jobsToCompleteMax: 50,
  jobsToInvoiceMax: 30,
  reportConversionJobsMax: 10,
  pinkFolderJobsMax: 10,
  /** Oldest incomplete job: OK when age in whole weeks is at most this */
  oldestJobWeeksMax: 6,
  /** Earliest report-conversion visit must be *after* this many calendar days from today (not within the window) */
  earliestConversionWindowDays: 14,
} as const

/** Row from weekly or daily processing KPI history endpoints (oldest first). */
type ProcessingStatusHistoryRow = {
  week_start?: string | null
  snapshot_date?: string | null
  oldest_job_date?: string | null
  earliest_job_to_be_converted_date?: string | null
  jobs_to_be_marked_complete?: number | null
  jobs_to_be_invoiced?: number | null
  jobs_to_be_converted?: number | null
  number_of_pink_folder_jobs?: number | null
  hit_goal?: boolean | null
  hit_goal_jobs_to_be_invoiced?: boolean | null
  hit_goal_jobs_to_be_converted?: boolean | null
  hit_goal_oldest_job?: boolean | null
  hit_goal_earliest_job_to_be_converted?: boolean | null
  hit_goal_pink_folder?: boolean | null
}

function previousWeekMondayYmd(mondayYmd: string): string {
  const [y, m, d] = mondayYmd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() - 7)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function historyRowForMonday(rows: ProcessingStatusHistoryRow[], mondayYmd: string): ProcessingStatusHistoryRow | null {
  const p = mondayYmd.slice(0, 10)
  const hit = rows.find((r) => (r.week_start ?? '').slice(0, 10) === p)
  return hit ?? null
}

type WowTrend = 'better' | 'worse' | 'same' | 'unknown'

/** Compare two numbers; `lowerIsBetter` for backlog-style metrics. */
function wowNumeric(
  current: number | null | undefined,
  previous: number | null | undefined,
  lowerIsBetter: boolean,
  kind: 'count' | 'hours',
): { trend: WowTrend; delta: number | null; line: string } {
  if (
    current == null ||
    previous == null ||
    !Number.isFinite(Number(current)) ||
    !Number.isFinite(Number(previous))
  ) {
    return { trend: 'unknown', delta: null, line: 'No snapshot for previous week to compare.' }
  }
  const c = Number(current)
  const p = Number(previous)
  const delta = c - p
  const eps = kind === 'hours' ? 0.05 : 0.5
  const unit = kind === 'hours' ? 'hrs' : 'jobs'
  if (Math.abs(delta) < eps) {
    const flat =
      kind === 'hours' ? `0.0 ${unit} vs previous week` : `0 ${unit} vs previous week`
    return { trend: 'same', delta: 0, line: flat }
  }
  const improved = lowerIsBetter ? delta < 0 : delta > 0
  const trend: WowTrend = improved ? 'better' : 'worse'
  const deltaStr =
    kind === 'hours'
      ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)} ${unit}`
      : `${delta > 0 ? '+' : ''}${Math.round(delta)} ${unit}`
  return { trend, delta, line: `${deltaStr} vs previous week` }
}

function ProcessingHistoryTrendLine({ trend, children }: { trend: WowTrend; children: ReactNode }) {
  const cls =
    trend === 'better'
      ? 'text-success'
      : trend === 'worse'
        ? 'text-danger'
        : trend === 'same'
          ? 'text-muted'
          : 'text-muted'
  return <div className={`small mt-2 fw-medium ${cls}`}>{children}</div>
}

const TARGET_HISTORY_MAX = 7
const HISTORY_PLACEHOLDER_WEEKS = TARGET_HISTORY_MAX
const INTRADAY_DAILY_HISTORY_DAYS = 7

function KpiHitWeekStrip({
  hits = null,
  labels = null,
  emptyMessage = 'No snapshots yet.',
  unsupportedMessage,
  greySlots = HISTORY_PLACEHOLDER_WEEKS,
}: {
  hits?: (boolean | null)[] | null
  labels?: string[] | null
  emptyMessage?: string
  unsupportedMessage?: string
  greySlots?: number
}) {
  const limitedGreySlots = Math.max(0, Math.min(greySlots, TARGET_HISTORY_MAX))

  if (unsupportedMessage) {
    return (
      <div className="processing-kpi-strip" role="img" aria-label={unsupportedMessage}>
        <div className="processing-kpi-strip__track processing-kpi-strip__track--end">
          {Array.from({ length: limitedGreySlots }, (_, i) => (
            <span key={`g-${i}`} className="processing-kpi-strip__cell processing-kpi-strip__cell--empty" />
          ))}
        </div>
      </div>
    )
  }
  if (!hits || hits.length === 0) {
    return (
      <div className="processing-kpi-strip" role="img" aria-label={emptyMessage}>
        <div className="processing-kpi-strip__track processing-kpi-strip__track--end">
          {Array.from({ length: limitedGreySlots }, (_, i) => (
            <span key={`e-${i}`} className="processing-kpi-strip__cell processing-kpi-strip__cell--empty" />
          ))}
        </div>
      </div>
    )
  }
  const limitedHits = hits.slice(-TARGET_HISTORY_MAX)
  const limitedLabels = labels?.slice(-TARGET_HISTORY_MAX) ?? null
  const on = limitedHits.filter((h) => h === true).length
  const off = limitedHits.filter((h) => h === false).length
  const unknown = limitedHits.filter((h) => h === null).length
  const aria = `Target met ${on} of ${limitedHits.length} snapshots, missed ${off}, no data ${unknown}. Newest left, oldest right.`
  return (
    <div className="processing-kpi-strip" role="img" aria-label={aria}>
      <div className="processing-kpi-strip__track processing-kpi-strip__track--end">
        {[...limitedHits].reverse().map((h, i) => {
          const labelIndex = limitedHits.length - 1 - i
          return (
          <span
            key={`w-${i}`}
            className={
              h === true
                ? 'processing-kpi-strip__cell processing-kpi-strip__cell--hit'
                : h === false
                  ? 'processing-kpi-strip__cell processing-kpi-strip__cell--miss'
                  : 'processing-kpi-strip__cell processing-kpi-strip__cell--empty'
            }
            title={limitedLabels?.[labelIndex] || `Snapshot ${labelIndex + 1}`}
          >
            {h === true ? '✓' : h === false ? '✕' : '·'}
          </span>
          )
        })}
      </div>
    </div>
  )
}

function KpiTrendViz({
  weekLabels,
  sparkValues,
  referenceY,
  hits,
  preferSparkline = false,
  unsupported,
  unsupportedMessage,
  greySlots,
  compact,
  emptyMessage,
}: {
  weekLabels: string[]
  sparkValues?: (number | null)[] | null
  referenceY?: number
  hits?: (boolean | null)[] | null
  preferSparkline?: boolean
  unsupported?: boolean
  unsupportedMessage?: string
  greySlots?: number
  compact?: boolean
  emptyMessage?: string
}) {
  const chartData = useMemo((): ChartData<'line'> | null => {
    if (!sparkValues?.length) return null
    const hasNumeric = sparkValues.some((v) => v != null && Number.isFinite(Number(v)))
    if (!hasNumeric) return null
    const labels =
      weekLabels.length === sparkValues.length
        ? weekLabels
        : sparkValues.map((_, i) => `Pt ${i + 1}`)
    const data = sparkValues.map((v) =>
      v != null && Number.isFinite(Number(v)) ? Number(v) : null,
    ) as (number | null)[]
    const datasets: ChartData<'line'>['datasets'] = [
      {
        label: 'Value',
        data,
        borderColor: referenceY != null ? '#1f9d55' : '#164b7c',
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.35,
        spanGaps: false,
        segment:
          referenceY != null
            ? {
                borderColor: (ctx) => {
                  const y0 = ctx.p0.parsed.y
                  const y1 = ctx.p1.parsed.y
                  if (y0 == null || y1 == null) return '#164b7c'
                  return y0 <= referenceY && y1 <= referenceY ? '#1f9d55' : '#c0392b'
                },
              }
            : undefined,
      },
    ]
    if (referenceY != null && data.length > 0) {
      datasets.push({
        label: 'Target',
        data: data.map(() => referenceY),
        borderColor: 'rgba(68, 68, 68, 0.9)',
        borderDash: [4, 4],
        fill: false,
        pointRadius: 0,
        tension: 0,
      })
    }
    return { labels, datasets }
  }, [weekLabels, sparkValues, referenceY])

  const yAxisMarkerValues = useMemo(() => {
    const numericValues = (sparkValues ?? [])
      .map((v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null))
      .filter((v): v is number => v != null)
    const highestValue = numericValues.length ? Math.max(...numericValues) : 0
    const markers = [0, highestValue]
    if (referenceY != null && Number.isFinite(Number(referenceY))) {
      markers.push(Number(referenceY))
    }
    return [...new Set(markers)].sort((a, b) => a - b)
  }, [sparkValues, referenceY])

  const chartOptions = useMemo(
    (): ChartOptions<'line'> => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { top: 4, bottom: 2, left: 0, right: 2 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
        tooltip: {
          filter: (item) => item.dataset.label !== 'Target',
          callbacks: {
            title: (items) => {
              const i = items[0]?.dataIndex ?? 0
              return weekLabels[i] || undefined
            },
            label: (item) => {
              const ds = item.dataset.label || ''
              if (item.parsed.y == null) return `${ds}: —`
              return `${ds}: ${item.parsed.y}`
            },
          },
        },
      },
      scales: {
        x: {
          display: true,
          grid: {
            drawTicks: true,
            tickLength: 4,
            color: 'transparent',
          },
          border: { display: false },
          ticks: {
            display: false,
            autoSkip: false,
          },
        },
        y: {
          display: true,
          beginAtZero: true,
          min: 0,
          max: yAxisMarkerValues[yAxisMarkerValues.length - 1] ?? 0,
          afterBuildTicks: (axis) => {
            axis.ticks = yAxisMarkerValues.map((value) => ({ value }))
          },
          grid: {
            drawTicks: false,
            color: (ctx) => {
              const value = Number(ctx.tick.value)
              if (value === 0) return 'rgba(68, 68, 68, 0.35)'
              if (referenceY != null && value === Number(referenceY)) return 'rgba(68, 68, 68, 0.28)'
              if (value === (yAxisMarkerValues[yAxisMarkerValues.length - 1] ?? 0)) {
                return 'rgba(15, 23, 42, 0.14)'
              }
              return 'transparent'
            },
          },
          border: { display: false },
          ticks: {
            padding: 4,
            callback: (value) => {
              const n = Number(value)
              if (n === 0) return '0'
              if (referenceY != null && n === Number(referenceY)) return `${n}`
              if (n === (yAxisMarkerValues[yAxisMarkerValues.length - 1] ?? 0)) return `${n}`
              return ''
            },
          },
        },
      },
      elements: {
        line: { borderWidth: 2 },
        point: { radius: 0, hoverRadius: 3 },
      },
    }),
    [referenceY, weekLabels, yAxisMarkerValues],
  )

  const wrapClass = compact ? 'processing-kpi-sparkline-wrap processing-kpi-sparkline-wrap--compact' : 'processing-kpi-sparkline-wrap'
  const numericPointCount = Array.isArray(sparkValues)
    ? sparkValues.filter((v) => v != null && Number.isFinite(Number(v))).length
    : 0

  if (unsupported) {
    return (
      <div className={compact ? 'processing-kpi-viz-fallback processing-kpi-viz-fallback--compact' : 'processing-kpi-viz-fallback'}>
        <KpiHitWeekStrip
          unsupportedMessage={
            unsupportedMessage ?? 'Intraday only — not stored in Monday weekly snapshots.'
          }
          labels={weekLabels}
          greySlots={greySlots ?? HISTORY_PLACEHOLDER_WEEKS}
        />
      </div>
    )
  }

  // In compact KPI cards, prefer the sparkline once we have enough numeric history
  // to draw a meaningful trend. Fall back to hit/miss squares for sparse history.
  if (compact && Array.isArray(hits) && hits.length > 0 && (!preferSparkline || numericPointCount < 3)) {
    return (
      <div className="processing-kpi-viz-fallback processing-kpi-viz-fallback--compact">
        <KpiHitWeekStrip
          hits={hits}
          labels={weekLabels}
          greySlots={greySlots ?? HISTORY_PLACEHOLDER_WEEKS}
          emptyMessage={emptyMessage}
        />
      </div>
    )
  }

  if (chartData) {
    return (
      <div className={wrapClass}>
        <Chart type="line" data={chartData} options={chartOptions} />
      </div>
    )
  }

  return (
    <div className={compact ? 'processing-kpi-viz-fallback processing-kpi-viz-fallback--compact' : 'processing-kpi-viz-fallback'}>
      <KpiHitWeekStrip
        hits={hits ?? null}
        labels={weekLabels}
        greySlots={greySlots ?? HISTORY_PLACEHOLDER_WEEKS}
        emptyMessage={emptyMessage}
      />
    </div>
  )
}

function ProcessingKpiDualTrend({
  weeklyLabels,
  dailyLabels,
  weeklySpark,
  dailySpark,
  referenceY,
  weeklyHits,
  dailyHits,
  preferSparkline = false,
  weeklyUnsupported,
  dailyUnsupported,
  weeklyUnsupportedMessage,
  dailyUnsupportedMessage,
  weeklyEmptyMessage,
  dailyEmptyMessage,
}: {
  weeklyLabels: string[]
  dailyLabels: string[]
  weeklySpark?: (number | null)[] | null
  dailySpark?: (number | null)[] | null
  referenceY?: number
  weeklyHits?: (boolean | null)[] | null
  dailyHits?: (boolean | null)[] | null
  preferSparkline?: boolean
  weeklyUnsupported?: boolean
  dailyUnsupported?: boolean
  weeklyUnsupportedMessage?: string
  dailyUnsupportedMessage?: string
  weeklyEmptyMessage?: string
  dailyEmptyMessage?: string
}) {
  const weeklyCount = weeklyLabels.length
  const weeklyDaysLabel = `Past ${weeklyCount} Week${weeklyCount === 1 ? '' : 's'}`
  const dailyCount = dailyLabels.length
  const dailyDaysLabel = `Past ${dailyCount} Day${dailyCount === 1 ? '' : 's'}`

  return (
    <div
      className={`processing-kpi-dual-viz${
        preferSparkline ? ' processing-kpi-dual-viz--spark-emphasis' : ' processing-kpi-dual-viz--strip-layout'
      }`}
    >
      <div className="processing-kpi-dual-viz__lane processing-kpi-dual-viz__lane--weekly">
        <span className="processing-kpi-dual-viz__grain">{weeklyDaysLabel}</span>
        <div className="processing-kpi-dual-viz__chart">
          <KpiTrendViz
            weekLabels={weeklyLabels}
            sparkValues={weeklySpark}
            referenceY={referenceY}
            hits={weeklyHits}
            preferSparkline={preferSparkline}
            unsupported={weeklyUnsupported}
            unsupportedMessage={weeklyUnsupportedMessage}
            emptyMessage={weeklyEmptyMessage ?? 'No weekly snapshots yet.'}
            compact
          />
        </div>
      </div>
      <div className="processing-kpi-dual-viz__lane processing-kpi-dual-viz__lane--daily">
        <span className="processing-kpi-dual-viz__grain">{dailyDaysLabel}</span>
        <div className="processing-kpi-dual-viz__chart">
          <KpiTrendViz
            weekLabels={dailyLabels}
            sparkValues={dailySpark}
            referenceY={referenceY}
            hits={dailyHits}
            preferSparkline={preferSparkline}
            unsupported={dailyUnsupported}
            unsupportedMessage={dailyUnsupportedMessage}
            emptyMessage={dailyEmptyMessage ?? 'No weekday snapshots yet.'}
            compact
          />
        </div>
      </div>
    </div>
  )
}

function ProcessingKpiCardGrid({
  title,
  value,
  viz,
  target,
  vizUsesParentRows = false,
  vizCompact = false,
}: {
  title: ReactNode
  value: ReactNode
  /** Omit for KPIs with no weekly/daily history (e.g. live intraday only). */
  viz?: ReactNode
  target: ReactNode
  vizUsesParentRows?: boolean
  vizCompact?: boolean
}) {
  const showViz = viz != null
  return (
    <div
      className={`processing-kpi-grid${vizUsesParentRows ? ' processing-kpi-grid--split-viz' : ''}${
        vizCompact ? ' processing-kpi-grid--compact-viz' : ''
      }`}
    >
      <div className="processing-kpi-grid__title">{title}</div>
      <div className="processing-kpi-grid__value">{value}</div>
      {showViz ? (
        <div className="processing-kpi-grid__viz">
          {viz}
        </div>
      ) : null}
      <div className="processing-kpi-grid__target">{target}</div>
    </div>
  )
}

function ProcessingKpiHeroVizColumn({
  label,
  children,
}: {
  label?: string
  children: ReactNode
}) {
  return (
    <div className="processing-kpi-hero-viz-column">
      {label ? <span className="processing-kpi-hero-viz-column__label">{label}</span> : null}
      <div className="processing-kpi-hero-viz-column__body">{children}</div>
    </div>
  )
}

function ProcessingKpiTileSkeleton({ hero = false }: { hero?: boolean }) {
  return (
    <Card className={`app-kpi-nested processing-tile h-100 ${hero ? 'processing-tile--hero' : ''}`}>
      <Card.Body className="processing-kpi-card-body p-3">
        <div className="processing-kpi-grid">
          <span className="home-skeleton-bar d-block" style={{ width: hero ? 'min(52%, 14rem)' : '70%' }} />
          <span
            className="home-skeleton-bar d-block"
            style={{
              width: hero ? 'min(28%, 8rem)' : '45%',
              height: hero ? '2.75rem' : '1.5rem',
              marginTop: '0.35rem',
              borderRadius: '0.5rem',
            }}
          />
          <div className="processing-kpi-skeleton-dual pt-1">
            <span
              className="home-skeleton-bar d-block w-100"
              style={{ height: '2.5rem', borderRadius: '0.35rem' }}
            />
            <span
              className="home-skeleton-bar d-block w-100 mt-1"
              style={{ height: '2.5rem', borderRadius: '0.35rem' }}
            />
          </div>
          <span className="home-skeleton-bar d-block mt-1" style={{ width: '82%' }} />
        </div>
      </Card.Body>
    </Card>
  )
}

/** Status tab layout while initial `/processing_attack/*` bundle is loading. */
function ProcessingStatusTabSkeleton() {
  return (
    <div className="home-skeleton d-flex flex-column" aria-busy="true" aria-label="Loading jobs backlog">
      <Card className="app-surface-card processing-status-card">
        <Card.Body className="p-3">
          <Row className="g-3">
            <Col lg={12}>
              <ProcessingKpiTileSkeleton hero />
            </Col>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Col md={4} key={i}>
                <ProcessingKpiTileSkeleton />
              </Col>
            ))}
          </Row>
        </Card.Body>
      </Card>
      <Card className="app-surface-card mb-3 mt-4">
        <Card.Header className="border-0 pb-0 pt-3 px-3">
          <span className="home-skeleton-bar d-block" style={{ width: '18rem', height: '1rem' }} />
        </Card.Header>
        <Card.Body className="pt-3 pb-3">
          <div className="processing-job-type-bar-wrap" style={{ height: 280 }}>
            {Array.from({ length: 7 }, (_, r) => (
              <div key={r} className="d-flex align-items-center gap-3 mb-3">
                <span className="home-skeleton-bar flex-shrink-0" style={{ width: '7.5rem', height: 11 }} />
                <span className="home-skeleton-bar flex-grow-1" style={{ height: 16, borderRadius: 6 }} />
              </div>
            ))}
          </div>
        </Card.Body>
      </Card>
    </div>
  )
}

type ConversionJob = {
  id?: number
  scheduledDate?: number
  type?: string
  location?: { address?: { street?: string } }
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfDayAfterDays(from: Date, days: number): Date {
  const d = new Date(from)
  d.setDate(d.getDate() + days)
  d.setHours(23, 59, 59, 999)
  return d
}

function parseLocalCalendarDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const ymd = String(value).slice(0, 10)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) {
    const parsed = new Date(String(value))
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  const d = new Date(year, month - 1, day)
  d.setHours(0, 0, 0, 0)
  return Number.isNaN(d.getTime()) ? null : d
}

function toLocalYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function weeksSinceDate(iso: string | undefined): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const ms = Date.now() - d.getTime()
  return Math.max(0, Math.floor(ms / (7 * 24 * 60 * 60 * 1000)))
}

function scheduledJobDate(job: ConversionJob | undefined): Date | null {
  const ts = job?.scheduledDate
  if (ts == null) return null
  const sec = ts > 1e12 ? ts / 1000 : ts
  const d = new Date(sec * 1000)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Whole weeks from start-of-today to start of `target` (negative if target is before today). */
function wholeWeeksFromTodayToCalendarDay(target: Date): number | null {
  if (Number.isNaN(target.getTime())) return null
  const todayStart = startOfToday()
  const targetDay = new Date(target)
  targetDay.setHours(0, 0, 0, 0)
  const ms = targetDay.getTime() - todayStart.getTime()
  return Math.floor(ms / (7 * 24 * 60 * 60 * 1000))
}

function generateMondayOptions(): { value: string; label: string }[] {
  const now = new Date()
  const day = now.getDay()
  let mondayThisWeek = new Date(now)
  mondayThisWeek.setDate(now.getDate() - ((day + 6) % 7))
  const fridayThisWeek = new Date(mondayThisWeek)
  fridayThisWeek.setDate(mondayThisWeek.getDate() + 4)
  const friday5pm = new Date(fridayThisWeek)
  friday5pm.setHours(17, 0, 0, 0)
  let lastCompletedMonday: Date
  if (now > friday5pm) {
    lastCompletedMonday = mondayThisWeek
  } else {
    lastCompletedMonday = new Date(mondayThisWeek)
    lastCompletedMonday.setDate(mondayThisWeek.getDate() - 7)
  }
  const oneYearAgo = new Date(now)
  oneYearAgo.setFullYear(now.getFullYear() - 1)
  const options: { value: string; label: string }[] = []
  let currentMonday = new Date(lastCompletedMonday)
  while (currentMonday >= oneYearAgo) {
    const currentFriday = new Date(currentMonday)
    currentFriday.setDate(currentMonday.getDate() + 4)
    const fmt: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
    const mondayStr = currentMonday.toLocaleDateString('en-US', fmt)
    const fridayStr = currentFriday.toLocaleDateString('en-US', fmt)
    const year = currentMonday.getFullYear()
    const value = `${currentMonday.getFullYear()}-${String(currentMonday.getMonth() + 1).padStart(2, '0')}-${String(currentMonday.getDate()).padStart(2, '0')}`
    options.push({ value, label: `${mondayStr} - ${fridayStr}, ${year}` })
    currentMonday.setDate(currentMonday.getDate() - 7)
  }
  return options
}

type ProcessingTabKey = 'status' | 'weekly' | 'limbo'

type ProcessingIntradayRow = {
  snapshot_date: string
  captured_at: string
  captured_at_local: string
  jobs_to_be_marked_complete: number
}

function parseProcessingTab(tab: string | null): ProcessingTabKey {
  return tab === 'weekly' || tab === 'limbo' || tab === 'status' ? tab : 'status'
}

type ProcessingStatusCachePayload = {
  ts: number
  jobsToday: { jobs_processed_today?: number; incoming_jobs_today?: number } | null
  pink: {
    number_of_pink_folder_jobs?: number
    time_in_pink_folder?: number
    pink_folder_detailed_info?: Record<
      string,
      {
        job_address?: string
        job_url?: string
        is_paperwork_uploaded?: boolean
        job_date?: string | null
      }[]
    >
  } | null
  toInvoice: number | null
  numComplete: number | null
  complete: {
    job_type_count?: Record<string, number>
    oldest_jobs_to_be_marked_complete?: {
      job_id: number
      oldest_job_date: string
      oldest_job_address: string
      oldest_job_type: string
    }[]
    num_locations_to_be_converted?: number
    jobs_to_be_converted?: ConversionJob[]
  } | null
  statusHistory: ProcessingStatusHistoryRow[]
  statusHistoryDaily: ProcessingStatusHistoryRow[]
  intradayHistory: ProcessingIntradayRow[]
}

const PROCESSING_STATUS_CACHE_KEY = 'processingAttack.statusCache.v1'

function readProcessingStatusCache(): ProcessingStatusCachePayload | null {
  try {
    const raw = localStorage.getItem(PROCESSING_STATUS_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ProcessingStatusCachePayload>
    if (!parsed || typeof parsed !== 'object') return null
    return {
      ts: Number(parsed.ts) || Date.now(),
      jobsToday: parsed.jobsToday ?? null,
      pink: parsed.pink ?? null,
      toInvoice: parsed.toInvoice ?? null,
      numComplete: parsed.numComplete ?? null,
      complete: parsed.complete ?? null,
      statusHistory: Array.isArray(parsed.statusHistory) ? parsed.statusHistory : [],
      statusHistoryDaily: Array.isArray(parsed.statusHistoryDaily) ? parsed.statusHistoryDaily : [],
      intradayHistory: Array.isArray(parsed.intradayHistory) ? parsed.intradayHistory : [],
    }
  } catch {
    return null
  }
}

function writeProcessingStatusCache(payload: Omit<ProcessingStatusCachePayload, 'ts'>) {
  try {
    localStorage.setItem(
      PROCESSING_STATUS_CACHE_KEY,
      JSON.stringify({
        ts: Date.now(),
        ...payload,
      } satisfies ProcessingStatusCachePayload),
    )
  } catch {
    // Ignore cache write errors (private mode / quota).
  }
}

export default function ProcessingAttackPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = parseProcessingTab(searchParams.get('tab'))

  const handleTabSelect = (key: string | null) => {
    const k = parseProcessingTab(key)
    if (k === 'status') {
      setSearchParams({}, { replace: true })
    } else {
      setSearchParams({ tab: k }, { replace: true })
    }
  }

  const weekOptions = useMemo(() => generateMondayOptions(), [])
  const [selectedMonday, setSelectedMonday] = useState(weekOptions[0]?.value || '')

  const [jobsToday, setJobsToday] = useState<{ jobs_processed_today?: number; incoming_jobs_today?: number } | null>(
    null,
  )
  const [pink, setPink] = useState<{
    number_of_pink_folder_jobs?: number
    time_in_pink_folder?: number
    pink_folder_detailed_info?: Record<
      string,
      {
        job_address?: string
        job_url?: string
        is_paperwork_uploaded?: boolean
        job_date?: string | null
      }[]
    >
  } | null>(null)
  const [toInvoice, setToInvoice] = useState<number | null>(null)
  const [numComplete, setNumComplete] = useState<number | null>(null)
  const [complete, setComplete] = useState<{
    job_type_count?: Record<string, number>
    oldest_jobs_to_be_marked_complete?: {
      job_id: number
      oldest_job_date: string
      oldest_job_address: string
      oldest_job_type: string
    }[]
    num_locations_to_be_converted?: number
    jobs_to_be_converted?: ConversionJob[]
  } | null>(null)
  const [processed, setProcessed] = useState<{
    total_jobs_processed?: number
    total_tech_hours_processed?: number
    total_jobs_processed_previous_week?: number
    total_tech_hours_processed_previous_week?: number
    jobs_by_type?: Record<string, number>
    hours_by_type?: Record<string, number>
    error?: string
  } | null>(null)
  const [byProcessor, setByProcessor] = useState<{
    jobs_processed_by_processor?: Record<string, number>
    jobs_processed_by_processor_previous_week?: Record<string, number>
    hours_processed_by_processor?: Record<string, number>
    hours_processed_by_processor_previous_week?: Record<string, number>
  } | null>(null)
  /** Latest history fetch for Processing History tab (falls back to statusHistory until loaded). */
  const [weeklyTabHistory, setWeeklyTabHistory] = useState<ProcessingStatusHistoryRow[]>([])
  const [statusHistory, setStatusHistory] = useState<ProcessingStatusHistoryRow[]>([])
  const [statusHistoryDaily, setStatusHistoryDaily] = useState<ProcessingStatusHistoryRow[]>([])
  const [intradayHistory, setIntradayHistory] = useState<ProcessingIntradayRow[]>([])
  const [oldestJobsModalOpen, setOldestJobsModalOpen] = useState(false)
  const [pinkFolderModalOpen, setPinkFolderModalOpen] = useState(false)
  const [reportConversionModalOpen, setReportConversionModalOpen] = useState(false)
  const [pinkTechExpanded, setPinkTechExpanded] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)

  const refreshStatus = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    const cached = readProcessingStatusCache()
    try {
      try {
        await apiFetch('/processing_attack/refresh_daily_snapshot_if_stale', {
          method: 'POST',
          signal,
        })
      } catch (e) {
        if (isAbortError(e)) return
        console.warn('[Jobs Backlog] refresh_daily_snapshot_if_stale failed:', e)
      }

      try {
        await apiFetch('/processing_attack/capture_intraday_jobs_to_be_marked_complete', {
          method: 'POST',
          signal,
        })
      } catch (e) {
        if (isAbortError(e)) return
        console.warn('[Jobs Backlog] capture_intraday_jobs_to_be_marked_complete failed:', e)
      }

      // Use allSettled so one slow/failing endpoint does not block history + KPI updates
      // (empty history was leaving all strip cells gray when e.g. complete_jobs timed out).
      const settled = await Promise.allSettled([
        apiFetch('/processing_attack/jobs_today', { signal }).then(async (r) => {
          if (!r.ok) throw new Error(`jobs_today ${r.status}`)
          return r.json()
        }),
        apiFetch('/processing_attack/pink_folder_data', { signal }).then(async (r) => {
          if (!r.ok) throw new Error(`pink_folder_data ${r.status}`)
          return r.json()
        }),
        apiFetch('/processing_attack/jobs_to_be_invoiced', { signal }).then(async (r) => {
          if (!r.ok) throw new Error(`jobs_to_be_invoiced ${r.status}`)
          return r.json()
        }),
        apiFetch('/processing_attack/num_jobs_to_be_marked_complete', { signal }).then(async (r) => {
          if (!r.ok) throw new Error(`num_jobs ${r.status}`)
          return r.json()
        }),
        apiJson<typeof complete>('/processing_attack/complete_jobs', { method: 'POST', body: '{}', signal }),
        apiFetch('/processing_attack/history_jobs_to_be_marked_complete', { signal }).then(async (r) => {
          if (!r.ok) throw new Error(`history weekly ${r.status}`)
          const j = await r.json()
          if (!Array.isArray(j)) throw new Error('history weekly not an array')
          return j as ProcessingStatusHistoryRow[]
        }),
        apiFetch('/processing_attack/history_processing_status_daily', { signal }).then(async (r) => {
          if (!r.ok) return []
          try {
            const j = await r.json()
            return Array.isArray(j) ? (j as ProcessingStatusHistoryRow[]) : []
          } catch {
            return []
          }
        }),
        apiFetch('/processing_attack/history_jobs_to_be_marked_complete_intraday', { signal }).then(async (r) => {
          if (!r.ok) return []
          try {
            const j = await r.json()
            return Array.isArray(j) ? (j as ProcessingIntradayRow[]) : []
          } catch {
            return []
          }
        }),
      ])

      if (signal?.aborted) return

      const logRejected = (label: string, i: number) => {
        const s = settled[i]
        if (s.status === 'rejected') console.warn(`[Jobs Backlog] ${label} failed:`, s.reason)
      }

      logRejected('jobs_today', 0)
      logRejected('pink_folder_data', 1)
      logRejected('jobs_to_be_invoiced', 2)
      logRejected('num_jobs_to_be_marked_complete', 3)
      logRejected('complete_jobs', 4)
      logRejected('history_jobs_to_be_marked_complete', 5)
      logRejected('history_processing_status_daily', 6)
      logRejected('history_jobs_to_be_marked_complete_intraday', 7)

      let jobsTodayNext = cached?.jobsToday ?? null
      let pinkNext = cached?.pink ?? null
      let toInvoiceNext = cached?.toInvoice ?? null
      let numCompleteNext = cached?.numComplete ?? null
      let completeNext = cached?.complete ?? null
      let statusHistoryNext = cached?.statusHistory ?? []
      let statusHistoryDailyNext = cached?.statusHistoryDaily ?? []
      let intradayHistoryNext = cached?.intradayHistory ?? []

      if (settled[0].status === 'fulfilled') {
        jobsTodayNext = settled[0].value
        setJobsToday(jobsTodayNext)
      }
      if (settled[1].status === 'fulfilled') {
        pinkNext = settled[1].value
        setPink(pinkNext)
      }
      if (settled[2].status === 'fulfilled') {
        const inv = settled[2].value as { jobs_to_be_invoiced?: number }
        toInvoiceNext = inv.jobs_to_be_invoiced ?? null
        setToInvoice(toInvoiceNext)
      }
      if (settled[3].status === 'fulfilled') {
        const nc = settled[3].value as { jobs_to_be_marked_complete?: number; count?: number }
        numCompleteNext = nc.jobs_to_be_marked_complete ?? nc.count ?? null
        setNumComplete(numCompleteNext)
      }
      if (settled[4].status === 'fulfilled') {
        completeNext = settled[4].value
        setComplete(completeNext)
      }
      if (settled[5].status === 'fulfilled') {
        statusHistoryNext = settled[5].value
        setStatusHistory(statusHistoryNext)
      }
      if (settled[6].status === 'fulfilled') {
        statusHistoryDailyNext = settled[6].value
        setStatusHistoryDaily(statusHistoryDailyNext)
      }
      if (settled[7].status === 'fulfilled') {
        intradayHistoryNext = settled[7].value
        setIntradayHistory(intradayHistoryNext)
      }

      writeProcessingStatusCache({
        jobsToday: jobsTodayNext,
        pink: pinkNext,
        toInvoice: toInvoiceNext,
        numComplete: numCompleteNext,
        complete: completeNext,
        statusHistory: statusHistoryNext,
        statusHistoryDaily: statusHistoryDailyNext,
        intradayHistory: intradayHistoryNext,
      })
    } catch (e) {
      if (isAbortError(e)) return
      console.error(e)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const cached = readProcessingStatusCache()
    if (cached) {
      setJobsToday(cached.jobsToday)
      setPink(cached.pink)
      setToInvoice(cached.toInvoice)
      setNumComplete(cached.numComplete)
      setComplete(cached.complete)
      setStatusHistory(cached.statusHistory)
      setStatusHistoryDaily(cached.statusHistoryDaily)
      setIntradayHistory(cached.intradayHistory)
      setLoading(false)
    }
    const controller = new AbortController()
    void refreshStatus(controller.signal)
    return () => controller.abort()
  }, [refreshStatus])

  const loadWeekly = useCallback(async (signal?: AbortSignal) => {
    if (!selectedMonday) return
    const [prRes, bpRes, histRes] = await Promise.allSettled([
      apiJson<typeof processed>('/processing_attack/processed_data', {
        method: 'POST',
        body: JSON.stringify({ selectedMonday }),
        signal,
      }),
      apiJson<typeof byProcessor>('/processing_attack/processed_data_by_processor', {
        method: 'POST',
        body: JSON.stringify({ selectedMonday }),
        signal,
      }),
      apiFetch('/processing_attack/history_jobs_to_be_marked_complete', { signal }).then((r) => r.json()),
    ])
    if (signal?.aborted) return
    if (prRes.status === 'fulfilled') setProcessed(prRes.value)
    else {
      if (!isAbortError(prRes.reason)) console.error(prRes.reason)
      setProcessed(null)
    }
    if (bpRes.status === 'fulfilled') setByProcessor(bpRes.value)
    else {
      if (!isAbortError(bpRes.reason)) console.error(bpRes.reason)
      setByProcessor(null)
    }
    if (histRes.status === 'fulfilled' && Array.isArray(histRes.value)) {
      setWeeklyTabHistory(histRes.value)
    } else {
      if (histRes.status === 'rejected' && !isAbortError(histRes.reason)) console.error(histRes.reason)
      setWeeklyTabHistory([])
    }
  }, [selectedMonday])

  useEffect(() => {
    const controller = new AbortController()
    void loadWeekly(controller.signal)
    return () => controller.abort()
  }, [loadWeekly])

  const historyRowsForWeekly = useMemo(
    () => (weeklyTabHistory.length > 0 ? weeklyTabHistory : statusHistory),
    [weeklyTabHistory, statusHistory],
  )

  const jobsToProcess24WeekTrend = useMemo(() => {
    const points = historyRowsForWeekly
      .map((r) => {
        const ws = r.week_start ? new Date(r.week_start) : null
        const v = r.jobs_to_be_marked_complete
        if (!ws || Number.isNaN(ws.getTime())) return null
        if (v == null || !Number.isFinite(Number(v))) return null
        return { weekStart: ws, value: Number(v) }
      })
      .filter((p): p is { weekStart: Date; value: number } => p != null)
      .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime())
      .slice(-24)

    if (!points.length) return null

    const labels = points.map((p) =>
      p.weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    )
    const chartData: ChartData<'line'> = {
      labels,
      datasets: [
        {
          label: 'Jobs to be processed',
          data: points.map((p) => p.value),
          borderColor: '#164b7c',
          backgroundColor: 'rgba(22, 75, 124, 0.12)',
          fill: true,
          tension: 0.34,
          pointRadius: 0,
          pointHoverRadius: 3,
        },
      ],
    }

    const options: ChartOptions<'line'> = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: 8 },
        },
        y: {
          beginAtZero: true,
          ticks: { precision: 0 },
          grid: { color: 'rgba(15, 23, 42, 0.08)' },
        },
      },
    }

    return {
      chartData,
      options,
      windowText:
        points.length >= 24
          ? 'Past 24 weeks'
          : `Past ${points.length} week${points.length === 1 ? '' : 's'}`,
    }
  }, [historyRowsForWeekly])

  const jobsProcessedWow = useMemo(() => {
    if (!processed) {
      return { trend: 'unknown' as WowTrend, line: 'Weekly totals could not be loaded.' }
    }
    if (processed.error) {
      return { trend: 'unknown' as WowTrend, line: processed.error }
    }
    return wowNumeric(
      processed.total_jobs_processed,
      processed.total_jobs_processed_previous_week,
      false,
      'count',
    )
  }, [processed])

  const techHoursWow = useMemo(() => {
    if (!processed) {
      return { trend: 'unknown' as WowTrend, line: 'Weekly totals could not be loaded.' }
    }
    if (processed.error) {
      return { trend: 'unknown' as WowTrend, line: processed.error }
    }
    return wowNumeric(
      processed.total_tech_hours_processed,
      processed.total_tech_hours_processed_previous_week,
      false,
      'hours',
    )
  }, [processed])

  const jobsToCompleteSnapshotWow = useMemo(() => {
    if (!selectedMonday) {
      return { trend: 'unknown' as WowTrend, line: 'Select a week.' }
    }
    const prevMon = previousWeekMondayYmd(selectedMonday)
    const curRow = historyRowForMonday(historyRowsForWeekly, selectedMonday)
    const prevRow = historyRowForMonday(historyRowsForWeekly, prevMon)
    const cur = curRow?.jobs_to_be_marked_complete
    if (cur == null || !Number.isFinite(Number(cur))) {
      return { trend: 'unknown' as WowTrend, line: 'No snapshot for this week in history.' }
    }
    const prev = prevRow?.jobs_to_be_marked_complete
    if (prev == null || !Number.isFinite(Number(prev))) {
      return {
        trend: 'unknown' as WowTrend,
        line: `${Number(cur)} jobs — no snapshot for the previous week to compare.`,
      }
    }
    return wowNumeric(cur, prev, true, 'count')
  }, [historyRowsForWeekly, selectedMonday])

  const procJobsByProcessorChart = useMemo(() => {
    if (!byProcessor?.jobs_processed_by_processor) return null
    const cur = byProcessor.jobs_processed_by_processor
    const prev = byProcessor.jobs_processed_by_processor_previous_week || {}
    const names = [...new Set([...Object.keys(cur), ...Object.keys(prev)])]
    if (names.length === 0) return null
    const rows = names
      .map((name) => ({
        name,
        cur: Number(cur[name] ?? 0) || 0,
        prev: Number(prev[name] ?? 0) || 0,
      }))
      .sort((a, b) => b.cur - a.cur)
    const labels = rows.map((r) => properFormat(r.name))
    const chartData: ChartData<'bar'> = {
      labels,
      datasets: [
        {
          label: 'This week',
          data: rows.map((r) => r.cur),
          backgroundColor: 'rgba(12, 98, 166, 0.85)',
          borderRadius: 6,
        },
        {
          label: 'Previous week',
          data: rows.map((r) => r.prev),
          backgroundColor: 'rgba(180, 188, 198, 0.9)',
          borderRadius: 6,
        },
      ],
    }
    const options: ChartOptions<'bar'> = {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      devicePixelRatio:
        typeof globalThis.window !== 'undefined'
          ? Math.min(Math.max(globalThis.window.devicePixelRatio || 1, 2), 3)
          : 2,
      plugins: {
        datalabels: { display: false },
        legend: { display: true, position: 'top' },
        tooltip: {
          callbacks: {
            label(ctx) {
              const v = Number(ctx.raw) || 0
              return ` ${ctx.dataset.label ?? ''}: ${v} job${v !== 1 ? 's' : ''}`
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          stacked: false,
          ticks: { precision: 0 },
          title: { display: true, text: 'Jobs' },
          grid: { color: 'rgba(15, 23, 42, 0.06)' },
        },
        y: {
          reverse: true,
          stacked: false,
          grid: { display: false },
          ticks: { autoSkip: false },
        },
      },
    }
    const minHeightPx = Math.round(Math.max(260, rows.length * 40 + 100))
    return { chartData, options, minHeightPx }
  }, [byProcessor])

  const procHoursByProcessorChart = useMemo(() => {
    if (!byProcessor?.hours_processed_by_processor) return null
    const cur = byProcessor.hours_processed_by_processor
    const prev = byProcessor.hours_processed_by_processor_previous_week || {}
    const names = [...new Set([...Object.keys(cur), ...Object.keys(prev)])]
    if (names.length === 0) return null
    const rows = names
      .map((name) => ({
        name,
        cur: Number(cur[name] ?? 0) || 0,
        prev: Number(prev[name] ?? 0) || 0,
      }))
      .sort((a, b) => b.cur - a.cur)
    const labels = rows.map((r) => properFormat(r.name))
    const chartData: ChartData<'bar'> = {
      labels,
      datasets: [
        {
          label: 'This week',
          data: rows.map((r) => r.cur),
          backgroundColor: 'rgba(25, 135, 84, 0.75)',
          borderRadius: 6,
        },
        {
          label: 'Previous week',
          data: rows.map((r) => r.prev),
          backgroundColor: 'rgba(180, 188, 198, 0.9)',
          borderRadius: 6,
        },
      ],
    }
    const options: ChartOptions<'bar'> = {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      devicePixelRatio:
        typeof globalThis.window !== 'undefined'
          ? Math.min(Math.max(globalThis.window.devicePixelRatio || 1, 2), 3)
          : 2,
      plugins: {
        datalabels: { display: false },
        legend: { display: true, position: 'top' },
        tooltip: {
          callbacks: {
            label(ctx) {
              const v = Number(ctx.raw) || 0
              return ` ${ctx.dataset.label ?? ''}: ${v.toFixed(1)} hrs`
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          stacked: false,
          ticks: { precision: 1 },
          title: { display: true, text: 'Tech hours' },
          grid: { color: 'rgba(15, 23, 42, 0.06)' },
        },
        y: {
          reverse: true,
          stacked: false,
          grid: { display: false },
          ticks: { autoSkip: false },
        },
      },
    }
    const minHeightPx = Math.round(Math.max(260, rows.length * 40 + 100))
    return { chartData, options, minHeightPx }
  }, [byProcessor])

  const jobsToCompleteByTypeBar = useMemo(() => {
    const raw = complete?.job_type_count
    if (!raw || Object.keys(raw).length === 0) return null
    const entries = Object.entries(raw)
      .map(([key, val]) => ({ key, count: Number(val) || 0 }))
      .filter((e) => e.count > 0)
      .sort((a, b) => b.count - a.count)
    if (entries.length === 0) return null
    const labels = entries.map((e) => properFormat(e.key))
    const data = entries.map((e) => e.count)
    const total = entries.reduce((s, e) => s + e.count, 0)
    const chartData: ChartData<'bar'> = {
      labels,
      datasets: [
        {
          label: 'Jobs to be marked complete',
          data,
          backgroundColor: 'rgba(22, 75, 124, 0.78)',
          borderRadius: 6,
          maxBarThickness: 28,
        },
      ],
    }
    const options: ChartOptions<'bar'> = {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      // Canvas sharpness: default DPR is window.devicePixelRatio; fractional DPR (e.g. Windows 125%)
      // + CSS size rounding often softens bars/text. Use at least 2×, cap to avoid huge bitmaps.
      devicePixelRatio:
        typeof globalThis.window !== 'undefined'
          ? Math.min(Math.max(globalThis.window.devicePixelRatio || 1, 2), 3)
          : 2,
      plugins: {
        datalabels: {
          display: true,
          anchor: 'start',
          align: 'left',
          offset: 8,
          clamp: true,
          clip: false,
          color: '#164b7c',
          font: { weight: 700, size: 11 },
          formatter(value) {
            const v = Number(value) || 0
            return `${Math.round(v)}`
          },
        },
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(ctx) {
              const v = Number(ctx.raw) || 0
              const pct = total > 0 ? Math.round((v / total) * 100) : 0
              return ` ${v} job${v !== 1 ? 's' : ''} (${pct}% of total)`
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { precision: 0 },
          title: { display: true, text: 'Jobs' },
          grid: { color: 'rgba(15, 23, 42, 0.12)' },
        },
        y: {
          reverse: false,
          grid: { display: false },
          ticks: { autoSkip: false, padding: 28 },
        },
      },
    }
    const minHeightPx = Math.round(Math.max(220, entries.length * 36 + 80))
    return { chartData, options, total, minHeightPx, typeCount: entries.length }
  }, [complete?.job_type_count])

  const statusHistoryDerived = useMemo(() => {
    const rows = statusHistory
    const parseIso = (s: string | null | undefined): Date | null => {
      if (!s) return null
      const d = new Date(s)
      return Number.isNaN(d.getTime()) ? null : d
    }
    const daysBetween = (later: Date, earlier: Date) =>
      Math.round((later.getTime() - earlier.getTime()) / 86400000)

    if (!rows.length) {
      return {
        weekLabels: [] as string[],
        hits: null as null | {
          complete: (boolean | null)[]
          oldest: (boolean | null)[]
          pink: (boolean | null)[]
          invoiced: (boolean | null)[]
          reportConv: (boolean | null)[]
          earliest: (boolean | null)[]
        },
        series: null as null | {
          complete: (number | null)[]
          invoiced: (number | null)[]
          reportConv: (number | null)[]
          pink: (number | null)[]
          oldestDays: (number | null)[]
          earliestLeadDays: (number | null)[]
        },
      }
    }

    const weekLabels = rows.map((r) => {
      const d = parseIso(r.week_start ?? null)
      return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''
    })

    const hits = {
      complete: rows.map((r) => r.hit_goal ?? null),
      oldest: rows.map((r) => r.hit_goal_oldest_job ?? null),
      pink: rows.map((r) => r.hit_goal_pink_folder ?? null),
      invoiced: rows.map((r) => r.hit_goal_jobs_to_be_invoiced ?? null),
      reportConv: rows.map((r) => r.hit_goal_jobs_to_be_converted ?? null),
      earliest: rows.map((r) => r.hit_goal_earliest_job_to_be_converted ?? null),
    }

    const series = {
      complete: rows.map((r) =>
        r.jobs_to_be_marked_complete != null ? Number(r.jobs_to_be_marked_complete) : null,
      ),
      invoiced: rows.map((r) => (r.jobs_to_be_invoiced != null ? Number(r.jobs_to_be_invoiced) : null)),
      reportConv: rows.map((r) => (r.jobs_to_be_converted != null ? Number(r.jobs_to_be_converted) : null)),
      pink: rows.map((r) =>
        r.number_of_pink_folder_jobs != null ? Number(r.number_of_pink_folder_jobs) : null,
      ),
      oldestDays: rows.map((r) => {
        const ws = parseIso(r.week_start ?? null)
        const od = parseIso(r.oldest_job_date ?? null)
        if (!ws || !od) return null
        return Math.max(0, daysBetween(ws, od))
      }),
      earliestLeadDays: rows.map((r) => {
        const ws = parseIso(r.week_start ?? null)
        const ed = parseIso(r.earliest_job_to_be_converted_date ?? null)
        if (!ws || !ed) return null
        return daysBetween(ed, ws)
      }),
    }

    return { weekLabels, hits, series }
  }, [statusHistory])

  const dailyHistoryDerived = useMemo(() => {
    const rows = statusHistoryDaily
    const daysBetween = (later: Date, earlier: Date) =>
      Math.round((later.getTime() - earlier.getTime()) / 86400000)

    if (!rows.length) {
      return {
        dayLabels: [] as string[],
        hits: null as null | {
          complete: (boolean | null)[]
          oldest: (boolean | null)[]
          pink: (boolean | null)[]
          invoiced: (boolean | null)[]
          reportConv: (boolean | null)[]
          earliest: (boolean | null)[]
        },
        series: null as null | {
          complete: (number | null)[]
          invoiced: (number | null)[]
          reportConv: (number | null)[]
          pink: (number | null)[]
          oldestDays: (number | null)[]
          earliestLeadDays: (number | null)[]
        },
      }
    }

    const dayLabels = rows.map((r) => {
      const d = parseLocalCalendarDate(r.snapshot_date ?? null)
      return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''
    })

    const hits = {
      complete: rows.map((r) => r.hit_goal ?? null),
      oldest: rows.map((r) => r.hit_goal_oldest_job ?? null),
      pink: rows.map((r) => r.hit_goal_pink_folder ?? null),
      invoiced: rows.map((r) => r.hit_goal_jobs_to_be_invoiced ?? null),
      reportConv: rows.map((r) => r.hit_goal_jobs_to_be_converted ?? null),
      earliest: rows.map((r) => r.hit_goal_earliest_job_to_be_converted ?? null),
    }

    const series = {
      complete: rows.map((r) =>
        r.jobs_to_be_marked_complete != null ? Number(r.jobs_to_be_marked_complete) : null,
      ),
      invoiced: rows.map((r) => (r.jobs_to_be_invoiced != null ? Number(r.jobs_to_be_invoiced) : null)),
      reportConv: rows.map((r) => (r.jobs_to_be_converted != null ? Number(r.jobs_to_be_converted) : null)),
      pink: rows.map((r) =>
        r.number_of_pink_folder_jobs != null ? Number(r.number_of_pink_folder_jobs) : null,
      ),
      oldestDays: rows.map((r) => {
        const sd = parseLocalCalendarDate(r.snapshot_date ?? null)
        const od = parseLocalCalendarDate(r.oldest_job_date ?? null)
        if (!sd || !od) return null
        return Math.max(0, daysBetween(sd, od))
      }),
      earliestLeadDays: rows.map((r) => {
        const sd = parseLocalCalendarDate(r.snapshot_date ?? null)
        const ed = parseLocalCalendarDate(r.earliest_job_to_be_converted_date ?? null)
        if (!sd || !ed) return null
        return daysBetween(ed, sd)
      }),
    }

    return { dayLabels, hits, series }
  }, [statusHistoryDaily])

  const pinkFolderByTech = useMemo(() => {
    const info = pink?.pink_folder_detailed_info
    if (!info || typeof info !== 'object') return []
    return Object.entries(info)
      .map(([name, jobs]) => ({
        name,
        jobs: (Array.isArray(jobs) ? jobs : []).map((j) => ({
          job_address: typeof j?.job_address === 'string' ? j.job_address : '',
          job_url: typeof j?.job_url === 'string' ? j.job_url : '',
          is_paperwork_uploaded: Boolean(j?.is_paperwork_uploaded),
          job_date: j?.job_date != null && j.job_date !== '' ? String(j.job_date) : null,
        })),
      }))
      .filter((t) => t.jobs.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [pink?.pink_folder_detailed_info])

  const hasCachedStatusData =
    jobsToday != null ||
    pink != null ||
    toInvoice != null ||
    numComplete != null ||
    complete != null ||
    statusHistory.length > 0 ||
    statusHistoryDaily.length > 0 ||
    intradayHistory.length > 0
  const statusBootloading = loading && !jobsToday
  const statusRefreshingWithCachedData = loading && hasCachedStatusData

  const conversionJobs = complete?.jobs_to_be_converted ?? []
  const reportConversionCount = conversionJobs.length
  const earliestConversionJob = conversionJobs[0]
  const earliestConversionDate = scheduledJobDate(earliestConversionJob)
  const earliestConversionAddress =
    earliestConversionJob?.location?.address?.street?.trim() || '—'
  const earliestConversionWeeksAway = earliestConversionDate
    ? wholeWeeksFromTodayToCalendarDay(earliestConversionDate)
    : null

  const oldestRow = complete?.oldest_jobs_to_be_marked_complete?.[0]
  const oldestWeeks = weeksSinceDate(oldestRow?.oldest_job_date)

  const completeOk =
    numComplete != null ? numComplete <= KPI_TARGETS.jobsToCompleteMax : true
  const invoicedOk = toInvoice != null ? toInvoice < KPI_TARGETS.jobsToInvoiceMax : true
  const reportConvOk = reportConversionCount < KPI_TARGETS.reportConversionJobsMax

  const processedToday = jobsToday?.jobs_processed_today ?? 0
  const incoming = jobsToday?.incoming_jobs_today ?? 0
  /** Target: more processed than new */
  const jobsTodayOk = processedToday > incoming
  /** Processed minus new: positive when you are ahead (processed more than new). */
  const jobsTodayNet =
    jobsToday?.jobs_processed_today != null && jobsToday?.incoming_jobs_today != null
      ? jobsToday.jobs_processed_today - jobsToday.incoming_jobs_today
      : null

  const jobsToCompleteIntradayChart = useMemo<{
    chartData: ChartData<'line'> | null
    options: ChartOptions<'line'> | null
    emptyMessage: string | null
  }>(() => {
    const toLocalYmdInVancouver = (iso: string) => {
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return null
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Vancouver',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(d)
      const y = parts.find((p) => p.type === 'year')?.value
      const m = parts.find((p) => p.type === 'month')?.value
      const day = parts.find((p) => p.type === 'day')?.value
      if (!y || !m || !day) return null
      return `${y}-${m}-${day}`
    }

    const toLocalMinute = (iso: string) => {
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return null
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Vancouver',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(d)
      const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN)
      const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? NaN)
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
      return hh * 60 + mm
    }

    const fmtMinuteLabel = (minuteOfDay: number) => {
      const hour24 = Math.floor(minuteOfDay / 60)
      const minute = minuteOfDay % 60
      const suffix = hour24 >= 12 ? 'PM' : 'AM'
      const hour12 = hour24 % 12 || 12
      return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`
    }

    const windowStartMinute = 8 * 60 + 30
    const endMinute = 16 * 60 + 30
    const now = new Date()
    const todayVancouverKey = toLocalYmdInVancouver(now.toISOString())
    const nowMinute = toLocalMinute(now.toISOString()) ?? endMinute
    const maxMinute = Math.min(Math.max(nowMinute, windowStartMinute), endMinute)

    const perMinuteLatest = new Map<number, { x: number; y: number; capturedAtMs: number }>()
    for (const row of intradayHistory) {
      const rowDay = toLocalYmdInVancouver(row.captured_at_local)
      if (!todayVancouverKey || rowDay !== todayVancouverKey) continue
      const x = toLocalMinute(row.captured_at_local)
      const y = Number(row.jobs_to_be_marked_complete)
      const capturedAtMs = new Date(row.captured_at_local).getTime()
      if (
        x == null ||
        x < windowStartMinute ||
        x > endMinute ||
        !Number.isFinite(y) ||
        !Number.isFinite(capturedAtMs)
      ) {
        continue
      }
      const existing = perMinuteLatest.get(x)
      if (!existing || capturedAtMs > existing.capturedAtMs) {
        perMinuteLatest.set(x, { x, y, capturedAtMs })
      }
    }
    const points = Array.from(perMinuteLatest.values())
      .map(({ x, y }) => ({ x, y }))
      .sort((a, b) => a.x - b.x)

    if (Number.isFinite(Number(numComplete)) && maxMinute >= windowStartMinute) {
      const nowY = Number(numComplete)
      const existingNowIdx = points.findIndex((p) => p.x === maxMinute)
      if (existingNowIdx >= 0) {
        points[existingNowIdx] = { x: maxMinute, y: nowY }
      } else {
        points.push({ x: maxMinute, y: nowY })
        points.sort((a, b) => a.x - b.x)
      }
    }

    if (!points.length) {
      return {
        chartData: null,
        options: null,
        emptyMessage:
          maxMinute <= windowStartMinute
            ? 'Intraday chart begins at 8:30 AM Vancouver time.'
            : 'No intraday changes captured yet today.',
      }
    }

    const minMinute = points[0]?.x ?? windowStartMinute

    const chartData: ChartData<'line'> = {
      datasets: [
        {
          label: 'Jobs to be marked complete',
          data: points,
          parsing: false,
          borderColor: '#b42318',
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.2,
          pointRadius: 2.5,
          pointHoverRadius: 4,
          pointBackgroundColor: '#b42318',
          pointBorderColor: '#b42318',
        },
      ],
    }

    const options: ChartOptions<'line'> = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const x = Number(items[0]?.parsed.x ?? NaN)
              return Number.isFinite(x) ? fmtMinuteLabel(x) : ''
            },
            label: (item) => ` Jobs to be marked complete: ${item.parsed.y}`,
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          min: minMinute,
          max: maxMinute,
          grid: { color: 'rgba(15, 23, 42, 0.08)' },
          ticks: {
            autoSkip: false,
            minRotation: 0,
            maxRotation: 0,
            callback: (value, index, ticks) => {
              const last = ticks.length - 1
              const middle = Math.round(last / 2)
              if (index !== 0 && index !== middle && index !== last) return ''
              return fmtMinuteLabel(Number(value))
            },
          },
        },
        y: {
          beginAtZero: true,
          ticks: { precision: 0 },
          grid: { color: 'rgba(15, 23, 42, 0.08)' },
        },
      },
    }

    return { chartData, options, emptyMessage: null }
  }, [intradayHistory, numComplete])

  const jobsToCompletePastDaysChart = useMemo<{
    chartData: ChartData<'line'> | null
    options: ChartOptions<'line'> | null
    emptyMessage: string | null
    dayCount: number
  }>(() => {
    type TimelinePoint = { x: number; y: number; dayKey: string; fallback: boolean }
    const coarseByDay = new Map<string, number>()
    statusHistoryDaily.forEach((row) => {
      const key = row.snapshot_date?.slice(0, 10)
      const val = row.jobs_to_be_marked_complete
      if (!key || val == null || !Number.isFinite(Number(val))) return
      coarseByDay.set(key, Number(val))
    })

    const intradayPoints: TimelinePoint[] = []
    for (const row of intradayHistory) {
      const xDate = new Date(row.captured_at_local)
      const y = Number(row.jobs_to_be_marked_complete)
      if (Number.isNaN(xDate.getTime()) || !Number.isFinite(y)) continue
      intradayPoints.push({
        x: xDate.getTime(),
        y,
        dayKey: toLocalYmd(xDate),
        fallback: false,
      })
    }

    const today = startOfToday()
    const todayKey = toLocalYmd(today)
    const latestStart = new Date(today)
    latestStart.setDate(latestStart.getDate() - (INTRADAY_DAILY_HISTORY_DAYS - 1))
    const latestStartMs = latestStart.getTime()
    const endOfToday = new Date(today)
    endOfToday.setHours(23, 59, 59, 999)

    const availableDayStarts = [
      ...Array.from(coarseByDay.keys()).map((key) => parseLocalCalendarDate(key)).filter((d): d is Date => d != null),
      ...intradayPoints.map((p) => parseLocalCalendarDate(p.dayKey)).filter((d): d is Date => d != null),
    ].filter((d) => d.getTime() <= today.getTime())
    if (!availableDayStarts.length) {
      return {
        chartData: null,
        options: null,
        emptyMessage: 'No daily or intraday history available yet.',
        dayCount: 0,
      }
    }

    const earliestAvailable = new Date(Math.min(...availableDayStarts.map((d) => d.getTime())))
    const rangeStart = earliestAvailable.getTime() > latestStartMs ? earliestAvailable : latestStart

    const dayKeys: string[] = []
    const dayHasIntraday = new Set<string>()
    for (let d = new Date(rangeStart); d.getTime() <= today.getTime(); d.setDate(d.getDate() + 1)) {
      dayKeys.push(toLocalYmd(d))
    }

    const points: TimelinePoint[] = intradayPoints
      .filter((p) => p.x >= rangeStart.getTime() && p.x <= endOfToday.getTime())
      .sort((a, b) => a.x - b.x)
      .map((p) => {
        dayHasIntraday.add(p.dayKey)
        return p
      })

    for (const dayKey of dayKeys) {
      if (dayHasIntraday.has(dayKey)) continue
      const day = parseLocalCalendarDate(dayKey)
      if (!day) continue
      const fallbackValue = coarseByDay.get(dayKey)
      const fallbackMidday = new Date(day)
      fallbackMidday.setHours(dayKey === todayKey ? new Date().getHours() : 12, dayKey === todayKey ? new Date().getMinutes() : 0, 0, 0)
      points.push({
        x: fallbackMidday.getTime(),
        y: fallbackValue ?? Number.NaN,
        dayKey,
        fallback: true,
      })
    }

    points.sort((a, b) => a.x - b.x)

    const minX = rangeStart.getTime()
    const maxX = Math.max(...points.map((p) => p.x), endOfToday.getTime())
    const fmtAxis = (ms: number) => {
      const d = new Date(ms)
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    }
    const fmtTooltip = (ms: number) => {
      const d = new Date(ms)
      return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    }

    const chartData: ChartData<'line'> = {
      datasets: [
        {
          label: 'Jobs to be marked complete',
          data: points,
          parsing: false,
          borderColor: '#b42318',
          backgroundColor: 'transparent',
          fill: false,
          spanGaps: false,
          tension: 0.1,
          pointRadius: 0,
          pointHoverRadius: 0,
          pointBackgroundColor: (ctx) => ((ctx.raw as { fallback?: boolean } | undefined)?.fallback ? '#667085' : '#b42318'),
          pointBorderColor: (ctx) => ((ctx.raw as { fallback?: boolean } | undefined)?.fallback ? '#667085' : '#b42318'),
        },
      ],
    }

    const options: ChartOptions<'line'> = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const x = Number(items[0]?.parsed.x ?? NaN)
              return Number.isFinite(x) ? fmtTooltip(x) : ''
            },
            label: (item) => {
              const raw = item.raw as { fallback?: boolean } | undefined
              const source = raw?.fallback ? ' (daily snapshot fallback)' : ''
              const y = Number(item.parsed.y)
              return Number.isFinite(y) ? ` Jobs to be marked complete: ${y}${source}` : ' No data'
            },
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          min: minX,
          max: maxX,
          grid: { color: 'rgba(15, 23, 42, 0.08)' },
          ticks: {
            callback: (value) => fmtAxis(Number(value)),
            maxTicksLimit: 7,
          },
        },
        y: {
          beginAtZero: true,
          ticks: { precision: 0 },
          grid: { color: 'rgba(15, 23, 42, 0.08)' },
        },
      },
    }

    return { chartData, options, emptyMessage: null, dayCount: dayKeys.length }
  }, [intradayHistory, statusHistoryDaily])

  const jobsToCompleteWeeklyLabel = `Past ${statusHistoryDerived.weekLabels.length} Week${
    statusHistoryDerived.weekLabels.length === 1 ? '' : 's'
  }`
  const jobsToCompleteDailyLabel = `Past ${jobsToCompletePastDaysChart.dayCount} Day${
    jobsToCompletePastDaysChart.dayCount === 1 ? '' : 's'
  }`
  const jobsToCompleteIntradayLabel = 'Today'

  const pinkJobs = pink?.number_of_pink_folder_jobs ?? 0
  const pinkOk = pinkJobs < KPI_TARGETS.pinkFolderJobsMax

  const oldestOk =
    oldestWeeks == null ? true : oldestWeeks <= KPI_TARGETS.oldestJobWeeksMax

  let earliestConversionOk = true
  if (reportConversionCount > 0 && earliestConversionDate) {
    const todayStart = startOfToday()
    const windowEnd = endOfDayAfterDays(
      todayStart,
      KPI_TARGETS.earliestConversionWindowDays - 1,
    )
    earliestConversionOk = earliestConversionDate > windowEnd
  }

  return (
    <div className="container-fluid py-3 px-2 processing-page d-flex flex-column gap-3">
      <Card className="app-surface-card">
        <Card.Body className="p-3 p-md-4">
          <h1 className="processing-page-title mb-1">Jobs Backlog</h1>
          <p className="processing-page-subtitle mb-0">
            Track backlog health, daily progress, and weekly output trends.
          </p>
        </Card.Body>
      </Card>
      <Tab.Container activeKey={activeTab} onSelect={handleTabSelect}>
        <div className="processing-tabs-shell app-surface-card">
          <Nav variant="tabs" className="mb-0 processing-tabs processing-tabs-shell__nav">
            <Nav.Item>
              <Nav.Link eventKey="status">Processing Attack</Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link eventKey="weekly">Processing History</Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link eventKey="limbo">Limbo jobs</Nav.Link>
            </Nav.Item>
          </Nav>
          <Tab.Content className="processing-tabs-shell__panel">
            <Tab.Pane eventKey="status">
            {statusBootloading ? (
              <ProcessingStatusTabSkeleton />
            ) : (
              <>
            {statusRefreshingWithCachedData ? (
              <div className="processing-refreshing-indicator" role="status" aria-live="polite">
                <span className="spinner-border spinner-border-sm" aria-hidden="true" />
                <span>Refreshing data</span>
              </div>
            ) : null}
            <Card className="app-surface-card processing-status-card">
              <Card.Body className="p-3">
                <Row className="g-3">
                  <Col lg={12}>
                    <Card
                      className={`app-kpi-nested processing-tile processing-tile--hero d-flex flex-column ${completeOk ? 'processing-tile--status-good' : 'processing-tile--status-warn'}`}
                    >
                      <Card.Body className="processing-kpi-card-body p-3 flex-grow-1">
                        <div className="processing-kpi-grid processing-kpi-grid--hero-quad">
                          <div className="processing-kpi-grid__title">
                            <span className="processing-kpi-label">Jobs To Be Marked Complete</span>
                          </div>
                          <div className="processing-kpi-grid__value">
                            <div
                              className={`processing-hero-value ${completeOk ? 'processing-hero-value--good' : 'processing-hero-value--warn'}`}
                            >
                              {numComplete ?? '—'}
                            </div>
                          </div>
                          <div className="processing-kpi-grid__target">
                            <div className="processing-kpi-target">
                              Target: {KPI_TARGETS.jobsToCompleteMax} or fewer jobs
                            </div>
                          </div>
                          <div className="processing-kpi-grid__hero-viz processing-kpi-grid__hero-viz--intraday">
                            <ProcessingKpiHeroVizColumn label={jobsToCompleteIntradayLabel}>
                              {jobsToCompleteIntradayChart.emptyMessage ? (
                                <div className="processing-intraday-chart processing-intraday-chart--empty">
                                  <span>{jobsToCompleteIntradayChart.emptyMessage}</span>
                                </div>
                              ) : (
                                <div className="processing-intraday-chart">
                                  <Chart
                                    type="line"
                                    data={jobsToCompleteIntradayChart.chartData!}
                                    options={jobsToCompleteIntradayChart.options!}
                                  />
                                </div>
                              )}
                            </ProcessingKpiHeroVizColumn>
                          </div>
                          <div className="processing-kpi-grid__hero-viz processing-kpi-grid__hero-viz--daily">
                            <ProcessingKpiHeroVizColumn label={jobsToCompleteDailyLabel}>
                              {jobsToCompletePastDaysChart.emptyMessage ? (
                                <div className="processing-intraday-chart processing-intraday-chart--empty">
                                  <span>{jobsToCompletePastDaysChart.emptyMessage}</span>
                                </div>
                              ) : (
                                <div className="processing-intraday-chart">
                                  <Chart
                                    type="line"
                                    data={jobsToCompletePastDaysChart.chartData!}
                                    options={jobsToCompletePastDaysChart.options!}
                                  />
                                </div>
                              )}
                            </ProcessingKpiHeroVizColumn>
                          </div>
                          <div className="processing-kpi-grid__hero-viz processing-kpi-grid__hero-viz--weekly">
                            <ProcessingKpiHeroVizColumn label={jobsToCompleteWeeklyLabel}>
                              <KpiTrendViz
                                weekLabels={statusHistoryDerived.weekLabels}
                                sparkValues={statusHistoryDerived.series?.complete}
                                referenceY={KPI_TARGETS.jobsToCompleteMax}
                                hits={statusHistoryDerived.hits?.complete}
                                preferSparkline
                                emptyMessage="No weekly snapshots yet."
                                compact
                              />
                            </ProcessingKpiHeroVizColumn>
                          </div>
                        </div>
                      </Card.Body>
                    </Card>
                  </Col>
                  <Col md={4}>
                    <Card
                      className={`app-kpi-nested processing-tile h-100 d-flex flex-column ${jobsTodayOk ? 'processing-tile--status-good' : 'processing-tile--status-warn'}`}
                    >
                      <Card.Body className="processing-kpi-card-body p-3 flex-grow-1">
                        <ProcessingKpiCardGrid
                          title={<span className="processing-kpi-label">Job processing progress today</span>}
                          value={
                            <div
                              className={`processing-jobs-today-change ${jobsTodayNet == null ? 'processing-jobs-today-change--neutral' : jobsTodayOk ? 'processing-stat--good' : 'processing-stat--warn'}`}
                            >
                              {jobsTodayNet == null
                                ? '—'
                                : `${jobsTodayNet > 0 ? '+' : ''}${jobsTodayNet}`}
                              <div
                                className="processing-jobs-today-detail fw-semibold mt-1"
                              >
                                <span className="text-danger">New: {incoming}</span>
                                <span className="mx-2 text-muted">|</span>
                                <span className="text-success">Processed: {processedToday}</span>
                              </div>
                            </div>
                          }
                          target={
                            <div className="processing-kpi-target">
                              Target: more processed than new (positive net)
                            </div>
                          }
                          viz={<div className="processing-kpi-grid__viz--empty" aria-hidden="true" />}
                        />
                      </Card.Body>
                    </Card>
                  </Col>
                  <Col md={4}>
                    <Card
                      className={`app-kpi-nested processing-tile processing-kpi-card--clickable h-100 d-flex flex-column ${oldestOk ? 'processing-tile--status-good' : 'processing-tile--status-warn'}`}
                      role="button"
                      tabIndex={0}
                      aria-haspopup="dialog"
                      aria-label="Open oldest jobs to be marked complete"
                      onClick={() => setOldestJobsModalOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setOldestJobsModalOpen(true)
                        }
                      }}
                    >
                      <Card.Body className="processing-kpi-card-body p-3 flex-grow-1">
                        <ProcessingKpiCardGrid
                          title={<span className="processing-kpi-label">Oldest Job</span>}
                          value={
                            <div
                              className={`processing-value processing-kpi-metric-single-line ${
                                !oldestRow
                                  ? 'processing-jobs-today-change--neutral'
                                  : oldestOk
                                    ? 'processing-value--good'
                                    : ''
                              }`}
                            >
                              {!oldestRow
                                ? '—'
                                : (
                                    <>
                                      <div>{oldestRow.oldest_job_address?.trim() || '—'}</div>
                                      <div className="small mt-1">
                                        {oldestWeeks != null ? `${oldestWeeks} week(s) old` : '—'}
                                      </div>
                                    </>
                                  )}
                            </div>
                          }
                          viz={
                            <ProcessingKpiDualTrend
                              weeklyLabels={statusHistoryDerived.weekLabels}
                              dailyLabels={dailyHistoryDerived.dayLabels}
                              weeklySpark={statusHistoryDerived.series?.oldestDays}
                              dailySpark={dailyHistoryDerived.series?.oldestDays}
                              referenceY={KPI_TARGETS.oldestJobWeeksMax * 7}
                              weeklyHits={statusHistoryDerived.hits?.oldest}
                              dailyHits={dailyHistoryDerived.hits?.oldest}
                            />
                          }
                          target={
                            <div className="processing-kpi-target">
                              Target: no older than {KPI_TARGETS.oldestJobWeeksMax} weeks
                            </div>
                          }
                        />
                      </Card.Body>
                    </Card>
                  </Col>
                  <Col md={4}>
                    <Card
                      className={`app-kpi-nested processing-tile processing-kpi-card--clickable h-100 d-flex flex-column ${pinkOk ? 'processing-tile--status-good' : 'processing-tile--status-warn'}`}
                      role="button"
                      tabIndex={0}
                      aria-haspopup="dialog"
                      aria-label="Open pink folder jobs by technician"
                      onClick={() => setPinkFolderModalOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setPinkFolderModalOpen(true)
                        }
                      }}
                    >
                      <Card.Body className="processing-kpi-card-body p-3 flex-grow-1">
                        <ProcessingKpiCardGrid
                          title={<span className="processing-kpi-label">PINK FOLDER JOBS</span>}
                          value={
                            <div className={`processing-value ${pinkOk ? 'processing-value--good' : ''}`}>
                              {pink?.number_of_pink_folder_jobs ?? '—'} jobs
                            </div>
                          }
                          viz={
                            <ProcessingKpiDualTrend
                              weeklyLabels={statusHistoryDerived.weekLabels}
                              dailyLabels={dailyHistoryDerived.dayLabels}
                              weeklySpark={statusHistoryDerived.series?.pink}
                              dailySpark={dailyHistoryDerived.series?.pink}
                              referenceY={KPI_TARGETS.pinkFolderJobsMax}
                              weeklyHits={statusHistoryDerived.hits?.pink}
                              dailyHits={dailyHistoryDerived.hits?.pink}
                            />
                          }
                          target={
                            <div className="processing-kpi-target">
                              Target: fewer than {KPI_TARGETS.pinkFolderJobsMax} jobs
                            </div>
                          }
                        />
                      </Card.Body>
                    </Card>
                  </Col>
                  <Col md={4}>
                    <Card
                      className={`app-kpi-nested processing-tile h-100 d-flex flex-column ${invoicedOk ? 'processing-tile--status-good' : 'processing-tile--status-warn'}`}
                    >
                      <Card.Body className="processing-kpi-card-body p-3 flex-grow-1">
                        <ProcessingKpiCardGrid
                          title={<span className="processing-kpi-label">Complete Jobs To Be Invoiced</span>}
                          value={
                            <div className={`processing-value ${invoicedOk ? 'processing-value--good' : ''}`}>
                              {toInvoice ?? '—'}
                            </div>
                          }
                          viz={
                            <ProcessingKpiDualTrend
                              weeklyLabels={statusHistoryDerived.weekLabels}
                              dailyLabels={dailyHistoryDerived.dayLabels}
                              weeklySpark={statusHistoryDerived.series?.invoiced}
                              dailySpark={dailyHistoryDerived.series?.invoiced}
                              referenceY={KPI_TARGETS.jobsToInvoiceMax}
                              weeklyHits={statusHistoryDerived.hits?.invoiced}
                              dailyHits={dailyHistoryDerived.hits?.invoiced}
                            />
                          }
                          target={
                            <div className="processing-kpi-target">
                              Target: fewer than {KPI_TARGETS.jobsToInvoiceMax} jobs
                            </div>
                          }
                        />
                      </Card.Body>
                    </Card>
                  </Col>
                  <Col md={4}>
                    <Card
                      className={`app-kpi-nested processing-tile processing-kpi-card--clickable h-100 d-flex flex-column ${reportConvOk ? 'processing-tile--status-good' : 'processing-tile--status-warn'}`}
                      role="button"
                      tabIndex={0}
                      aria-haspopup="dialog"
                      aria-label="Open list of scheduled jobs requiring report conversion"
                      onClick={() => setReportConversionModalOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setReportConversionModalOpen(true)
                        }
                      }}
                    >
                      <Card.Body className="processing-kpi-card-body p-3 flex-grow-1">
                        <ProcessingKpiCardGrid
                          title={
                            <span className="processing-kpi-label">Scheduled Jobs Requiring Report Conversion</span>
                          }
                          value={
                            <div className={`processing-value ${reportConvOk ? 'processing-value--good' : ''}`}>
                              {reportConversionCount}
                            </div>
                          }
                          viz={
                            <ProcessingKpiDualTrend
                              weeklyLabels={statusHistoryDerived.weekLabels}
                              dailyLabels={dailyHistoryDerived.dayLabels}
                              weeklySpark={statusHistoryDerived.series?.reportConv}
                              dailySpark={dailyHistoryDerived.series?.reportConv}
                              referenceY={KPI_TARGETS.reportConversionJobsMax}
                              weeklyHits={statusHistoryDerived.hits?.reportConv}
                              dailyHits={dailyHistoryDerived.hits?.reportConv}
                            />
                          }
                          target={
                            <div className="processing-kpi-target">
                              Target: fewer than {KPI_TARGETS.reportConversionJobsMax} jobs
                            </div>
                          }
                        />
                      </Card.Body>
                    </Card>
                  </Col>
                  <Col md={4}>
                    <Card
                      className={`app-kpi-nested processing-tile h-100 d-flex flex-column ${earliestConversionOk ? 'processing-tile--status-good' : 'processing-tile--status-warn'}`}
                    >
                      <Card.Body className="processing-kpi-card-body p-3 flex-grow-1">
                        <ProcessingKpiCardGrid
                          title={
                            <span className="processing-kpi-label">
                              Earliest Scheduled Job Requiring Report Conversion
                            </span>
                          }
                          value={
                            <div
                              className={`processing-value processing-kpi-metric-single-line ${
                                !reportConversionCount
                                  ? 'processing-jobs-today-change--neutral'
                                  : earliestConversionOk
                                    ? 'processing-value--good'
                                    : ''
                              }`}
                            >
                              {!reportConversionCount
                                ? '—'
                                : (
                                    <>
                                      <div>{earliestConversionAddress !== '—' ? earliestConversionAddress : '—'}</div>
                                      <div className="small mt-1">
                                        {earliestConversionWeeksAway != null
                                          ? `${Math.max(0, earliestConversionWeeksAway)} week(s) away`
                                          : '—'}
                                      </div>
                                    </>
                                  )}
                            </div>
                          }
                          viz={
                            <ProcessingKpiDualTrend
                              weeklyLabels={statusHistoryDerived.weekLabels}
                              dailyLabels={dailyHistoryDerived.dayLabels}
                              weeklySpark={statusHistoryDerived.series?.earliestLeadDays}
                              dailySpark={dailyHistoryDerived.series?.earliestLeadDays}
                              referenceY={KPI_TARGETS.earliestConversionWindowDays}
                              weeklyHits={statusHistoryDerived.hits?.earliest}
                              dailyHits={dailyHistoryDerived.hits?.earliest}
                            />
                          }
                          target={
                            <div className="processing-kpi-target">
                              Target: earliest visit more than 2 weeks from today
                            </div>
                          }
                        />
                      </Card.Body>
                    </Card>
                  </Col>
                </Row>
              </Card.Body>
            </Card>

            {jobsToCompleteByTypeBar && (
              <Card className="app-surface-card mb-3 mt-4">
                <Card.Header className="fw-semibold">Jobs To Be Marked Complete By Job Type</Card.Header>
                <Card.Body className="pt-3 pb-3">
                  <div
                    className="processing-job-type-bar-wrap"
                    style={{ height: jobsToCompleteByTypeBar.minHeightPx }}
                    role="img"
                    aria-label={`${jobsToCompleteByTypeBar.total} jobs to be marked complete across ${jobsToCompleteByTypeBar.typeCount} job types; bar chart sorted by count`}
                  >
                    <Chart type="bar" data={jobsToCompleteByTypeBar.chartData} options={jobsToCompleteByTypeBar.options} />
                  </div>
                </Card.Body>
              </Card>
            )}

            <Modal
              show={oldestJobsModalOpen}
              onHide={() => setOldestJobsModalOpen(false)}
              centered
              size="lg"
              contentClassName="app-surface-card"
            >
              <Modal.Header closeButton>
                <Modal.Title>Oldest job to be marked complete</Modal.Title>
              </Modal.Header>
              <Modal.Body>
                <Table size="sm" striped responsive className="mb-0 processing-modal-data-table">
                  <thead>
                    <tr>
                      <th>Address</th>
                      <th>Type</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(complete?.oldest_jobs_to_be_marked_complete || []).length === 0 ? (
                      <tr>
                        <td colSpan={3} className="text-muted">
                          No rows yet.
                        </td>
                      </tr>
                    ) : (
                      (complete?.oldest_jobs_to_be_marked_complete || []).map((j) => {
                        const jobHref =
                          j.job_id != null
                            ? `https://app.servicetrade.com/job/${j.job_id}`
                            : null
                        const dateShown = formatPinkFolderJobDateMmmDdYyyy(j.oldest_job_date)
                        return (
                          <tr
                            key={j.job_id}
                            className={`processing-oldest-jobs-row${jobHref ? ' processing-modal-data-table__row--interactive' : ' processing-oldest-jobs-row--disabled'}`}
                            role={jobHref ? 'button' : undefined}
                            tabIndex={jobHref ? 0 : undefined}
                            aria-label={
                              jobHref
                                ? `Open job in ServiceTrade: ${j.oldest_job_address || j.job_id}`
                                : undefined
                            }
                            onClick={() => {
                              if (jobHref) window.open(jobHref, '_blank', 'noopener,noreferrer')
                            }}
                            onKeyDown={(e) => {
                              if (!jobHref) return
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                window.open(jobHref, '_blank', 'noopener,noreferrer')
                              }
                            }}
                          >
                            <td>{j.oldest_job_address}</td>
                            <td>{formatJobTypeSentence(j.oldest_job_type || '')}</td>
                            <td>{dateShown || '—'}</td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </Table>
              </Modal.Body>
            </Modal>

            <Modal
              show={reportConversionModalOpen}
              onHide={() => setReportConversionModalOpen(false)}
              centered
              size="lg"
              contentClassName="app-surface-card"
            >
              <Modal.Header closeButton>
                <Modal.Title>Scheduled jobs requiring report conversion</Modal.Title>
              </Modal.Header>
              <Modal.Body>
                <Table size="sm" striped responsive className="mb-0 processing-modal-data-table">
                  <thead>
                    <tr>
                      <th>Address</th>
                      <th>Type</th>
                      <th>Scheduled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conversionJobs.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="text-muted">
                          No scheduled inspection jobs in report-conversion locations.
                        </td>
                      </tr>
                    ) : (
                      conversionJobs.map((j, idx) => {
                        const id = j.id
                        const when = scheduledJobDate(j)
                        const href = id != null ? `https://app.servicetrade.com/job/${id}` : undefined
                        const address = j.location?.address?.street?.trim() || ''
                        const linkLabel = address || (href ? 'Open job in ServiceTrade' : '')
                        return (
                          <tr
                            key={id ?? `rc-${idx}`}
                            className="processing-modal-data-table__row--interactive"
                          >
                            <td>
                              {href && linkLabel ? (
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="processing-pink-folder-tech__job-link"
                                >
                                  {linkLabel}
                                </a>
                              ) : (
                                address || '—'
                              )}
                            </td>
                            <td>{j.type ? properFormat(String(j.type)) : '—'}</td>
                            <td>{when ? when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </Table>
              </Modal.Body>
            </Modal>

            <Modal
              className="pink-folder-modal"
              show={pinkFolderModalOpen}
              onHide={() => {
                setPinkFolderModalOpen(false)
                setPinkTechExpanded({})
              }}
              centered
              size="lg"
              contentClassName="app-surface-card pink-folder-modal__content"
            >
              <Modal.Header closeButton className="pink-folder-modal__header">
                <Modal.Title className="pink-folder-modal__title">Pink folder jobs by technician</Modal.Title>
              </Modal.Header>
              <Modal.Body className="pink-folder-modal__body">
                <div className="d-flex flex-wrap justify-content-end gap-2 mb-3">
                  <Button
                    type="button"
                    variant="light"
                    size="sm"
                    className="pink-folder-modal__btn pink-folder-modal__btn--expand"
                    onClick={() => {
                      const next: Record<string, boolean> = {}
                      pinkFolderByTech.forEach((t) => {
                        next[t.name] = true
                      })
                      setPinkTechExpanded(next)
                    }}
                  >
                    Expand all
                  </Button>
                  <Button
                    type="button"
                    variant="light"
                    size="sm"
                    className="pink-folder-modal__btn pink-folder-modal__btn--collapse"
                    onClick={() => setPinkTechExpanded({})}
                  >
                    Collapse all
                  </Button>
                </div>
                {pinkFolderByTech.length === 0 ? (
                  <p className="pink-folder-modal__empty mb-0">No pink folder assignments.</p>
                ) : (
                  pinkFolderByTech.map((t) => {
                    const expanded = Boolean(pinkTechExpanded[t.name])
                    return (
                      <div key={t.name} className="processing-pink-folder-tech mb-2">
                        <button
                          type="button"
                          className="processing-pink-folder-tech__header d-flex w-100 align-items-center justify-content-between border-0 py-2 px-3 text-start"
                          onClick={() =>
                            setPinkTechExpanded((s) => ({
                              ...s,
                              [t.name]: !s[t.name],
                            }))
                          }
                          aria-expanded={expanded}
                        >
                          <span className="processing-pink-folder-tech__name">{t.name}</span>
                          <span className="processing-pink-folder-tech__meta d-flex align-items-center gap-2">
                            ({t.jobs.length} job{t.jobs.length !== 1 ? 's' : ''})
                            <i
                              className={`bi ${expanded ? 'bi-chevron-down' : 'bi-chevron-right'}`}
                              aria-hidden
                            />
                          </span>
                        </button>
                        <Collapse in={expanded}>
                          <div>
                            <ul className="list-unstyled mb-0 ps-3 pe-3 pb-3 pt-1">
                              {t.jobs.map((j, idx) => {
                                const jobDateLabel = formatPinkFolderJobDateMmmDdYyyy(j.job_date)
                                return (
                                  <li
                                    key={`${t.name}-${idx}`}
                                    className="processing-pink-folder-job-row d-flex flex-wrap align-items-baseline justify-content-between gap-2 mb-2"
                                  >
                                    <div className="flex-grow-1 min-w-0 d-flex flex-wrap align-items-baseline gap-2">
                                      {j.job_url ? (
                                        <a
                                          href={j.job_url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="processing-pink-folder-tech__job-link"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          {j.job_address || 'Open job in ServiceTrade'}
                                        </a>
                                      ) : (
                                        <span className="text-muted">{j.job_address || '—'}</span>
                                      )}
                                      {jobDateLabel ? (
                                        <span className="text-muted small text-nowrap">{jobDateLabel}</span>
                                      ) : null}
                                    </div>
                                    <div className="processing-pink-folder-job-row__upload small text-nowrap">
                                      <span
                                        className={
                                          j.is_paperwork_uploaded
                                            ? 'fw-semibold text-success'
                                            : 'fw-semibold text-danger'
                                        }
                                      >
                                        {j.is_paperwork_uploaded ? 'Uploaded' : 'Not uploaded'}
                                      </span>
                                    </div>
                                  </li>
                                )
                              })}
                            </ul>
                          </div>
                        </Collapse>
                      </div>
                    )
                  })
                )}
              </Modal.Body>
            </Modal>
              </>
            )}
          </Tab.Pane>
          <Tab.Pane eventKey="weekly">
            <Card className="app-surface-card mb-3">
              <Card.Header>Jobs to be processed trend</Card.Header>
              <Card.Body className="p-3">
                {jobsToProcess24WeekTrend ? (
                  <>
                    <div className="small text-muted mb-2">{jobsToProcess24WeekTrend.windowText}</div>
                    <div className="processing-history-trend-chart-wrap">
                      <Chart
                        type="line"
                        data={jobsToProcess24WeekTrend.chartData}
                        options={jobsToProcess24WeekTrend.options}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-muted small mb-0">No weekly snapshot history yet.</p>
                )}
              </Card.Body>
            </Card>
            <Card className="app-surface-card mb-3">
              <Card.Body>
                <Row className="g-2 align-items-end">
                  <Col xs="auto">
                    <Form.Label className="small">Week (Mon)</Form.Label>
                    <Form.Select
                      value={selectedMonday}
                      onChange={(e) => setSelectedMonday(e.target.value)}
                      style={{ minWidth: 220 }}
                    >
                      {weekOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Form.Select>
                  </Col>
                  <Col xs="auto">
                    <Button size="sm" onClick={() => void loadWeekly()}>
                      Reload week
                    </Button>
                  </Col>
                </Row>
              </Card.Body>
            </Card>
            <Row className="g-3 mb-3">
              <Col md={6} lg={4}>
                <Card className="h-100">
                  <Card.Header>Number of jobs processed</Card.Header>
                  <Card.Body>
                    <div className="fs-3">
                      {processed && !processed.error
                        ? (processed.total_jobs_processed ?? '—')
                        : '—'}
                    </div>
                    <div className="small text-muted">
                      Previous week:{' '}
                      {processed && !processed.error
                        ? (processed.total_jobs_processed_previous_week ?? '—')
                        : '—'}
                    </div>
                    <ProcessingHistoryTrendLine trend={jobsProcessedWow.trend}>
                      {jobsProcessedWow.line}
                    </ProcessingHistoryTrendLine>
                  </Card.Body>
                </Card>
              </Col>
              <Col md={6} lg={4}>
                <Card className="h-100">
                  <Card.Header>Tech hours processed</Card.Header>
                  <Card.Body>
                    <div className="fs-3">
                      {processed && !processed.error && processed.total_tech_hours_processed != null
                        ? Number(processed.total_tech_hours_processed).toFixed(1)
                        : '—'}
                    </div>
                    <div className="small text-muted">
                      Previous week:{' '}
                      {processed &&
                      !processed.error &&
                      processed.total_tech_hours_processed_previous_week != null
                        ? Number(processed.total_tech_hours_processed_previous_week).toFixed(1)
                        : '—'}
                    </div>
                    <ProcessingHistoryTrendLine trend={techHoursWow.trend}>{techHoursWow.line}</ProcessingHistoryTrendLine>
                  </Card.Body>
                </Card>
              </Col>
              <Col md={12} lg={4}>
                <Card className="h-100">
                  <Card.Header>Jobs to be marked complete (weekly snapshot)</Card.Header>
                  <Card.Body>
                    <div className="fs-3">
                      {(() => {
                        const row = selectedMonday
                          ? historyRowForMonday(historyRowsForWeekly, selectedMonday)
                          : null
                        const v = row?.jobs_to_be_marked_complete
                        return v != null && Number.isFinite(Number(v)) ? v : '—'
                      })()}
                    </div>
                    <div className="small text-muted">
                      Compared to the prior week&apos;s snapshot. A lower count means less backlog still waiting to be marked complete.
                    </div>
                    <ProcessingHistoryTrendLine trend={jobsToCompleteSnapshotWow.trend}>
                      {jobsToCompleteSnapshotWow.line}
                    </ProcessingHistoryTrendLine>
                  </Card.Body>
                </Card>
              </Col>
            </Row>
            <Card className="mb-3">
              <Card.Header>Jobs processed by processor</Card.Header>
              <Card.Body className="p-3">
                {!procJobsByProcessorChart ? (
                  <p className="text-muted small mb-0">No processor breakdown for this week.</p>
                ) : (
                  <div style={{ minHeight: procJobsByProcessorChart.minHeightPx }}>
                    <Chart type="bar" data={procJobsByProcessorChart.chartData} options={procJobsByProcessorChart.options} />
                  </div>
                )}
              </Card.Body>
            </Card>
            <Card className="mb-3">
              <Card.Header>Tech hours processed by processor</Card.Header>
              <Card.Body className="p-3">
                {!procHoursByProcessorChart ? (
                  <p className="text-muted small mb-0">No processor breakdown for this week.</p>
                ) : (
                  <div style={{ minHeight: procHoursByProcessorChart.minHeightPx }}>
                    <Chart
                      type="bar"
                      data={procHoursByProcessorChart.chartData}
                      options={procHoursByProcessorChart.options}
                    />
                  </div>
                )}
              </Card.Body>
            </Card>
          </Tab.Pane>
            <Tab.Pane eventKey="limbo">
              <LimboJobTrackerPanel />
            </Tab.Pane>
          </Tab.Content>
        </div>
      </Tab.Container>
    </div>
  )
}
