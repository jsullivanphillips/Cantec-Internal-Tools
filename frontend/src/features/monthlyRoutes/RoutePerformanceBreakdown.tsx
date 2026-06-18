import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Form, OverlayTrigger, Spinner, Table, Tooltip } from 'react-bootstrap'
import { Link } from 'react-router-dom'

import { apiJson, isAbortError } from '../../lib/apiClient'
import { formatCurrencyCad } from '../../lib/formatCurrencyCad'
import {
  addCalendarMonths,
  monthFirstIsoPacificToday,
  type RoutePerformanceBreakdownPayload,
  type RoutePerformanceBreakdownStop,
  type RoutePerformanceBreakdownSummary,
  type RoutePerformanceStopOutcome,
} from './monthlyRoutesShared'

type Props = {
  routeId: number
  /** Route detail testing + run months; merged with API ``available_months`` for the picker. */
  monthCandidates?: string[]
  hideTitle?: boolean
  onSummaryChange?: (summary: {
    monthLabel: string
    revenue: number
    net: number | null
  }) => void
}

function formatMonthHeading(monthIso: string): string {
  const [y, m] = monthIso.split('-').map(Number)
  if (!y || !m) return monthIso
  return new Intl.DateTimeFormat('en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)))
}

/** Prefer the previous Pacific calendar month when this route has data for it. */
export function pickDefaultPerformanceMonth(monthOptions: string[]): string | null {
  if (monthOptions.length === 0) return null
  const previousMonth = addCalendarMonths(monthFirstIsoPacificToday(), -1)
  if (previousMonth && monthOptions.includes(previousMonth)) {
    return previousMonth
  }
  if (previousMonth) {
    const atOrBeforePrevious = monthOptions.filter((iso) => iso <= previousMonth)
    if (atOrBeforePrevious.length > 0) {
      return atOrBeforePrevious.sort().reverse()[0]
    }
  }
  return monthOptions[0] ?? null
}

import { formatNetPct } from './routePerformanceDisplay'
function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h <= 0) return `${m} min`
  if (m === 0) return `${h} hr`
  return `${h} hr ${m} min`
}

/** Route start time for the performance table totals row (ServiceTrade clock-in, else first stop in). */
export function performanceTableRouteStartTime(
  summary: RoutePerformanceBreakdownSummary,
  stops: RoutePerformanceBreakdownStop[],
): string | null {
  const routeIn = summary.route_clock_in?.trim()
  if (routeIn) return routeIn

  let earliest: { order: number; timeIn: string } | null = null
  for (const stop of stops) {
    const timeIn = stop.time_in?.trim()
    if (!timeIn) continue
    const order = stop.stop_order ?? Number.MAX_SAFE_INTEGER
    if (earliest == null || order < earliest.order) {
      earliest = { order, timeIn }
    }
  }
  return earliest?.timeIn ?? null
}

/** Route end time for the performance table totals row (ServiceTrade clock-out, else last stop out). */
export function performanceTableRouteEndTime(
  summary: RoutePerformanceBreakdownSummary,
  stops: RoutePerformanceBreakdownStop[],
): string | null {
  const routeOut = summary.route_clock_out?.trim()
  if (routeOut) return routeOut

  let latest: { order: number; timeOut: string } | null = null
  for (const stop of stops) {
    const timeOut = stop.time_out?.trim()
    if (!timeOut) continue
    const order = stop.stop_order ?? Number.MAX_SAFE_INTEGER
    if (latest == null || order > latest.order) {
      latest = { order, timeOut }
    }
  }
  return latest?.timeOut ?? null
}

function outcomeLabel(outcome: RoutePerformanceStopOutcome): string {
  if (outcome === 'tested') return 'Tested'
  if (outcome === 'skipped_annual') return 'Annual skip'
  if (outcome === 'skipped_non_annual') return 'Skipped'
  return 'Pending'
}

function outcomePillClass(outcome: RoutePerformanceStopOutcome): string {
  if (outcome === 'tested') return 'monthly-route-detail-performance__outcome-pill--tested'
  if (outcome === 'skipped_annual') return 'monthly-route-detail-performance__outcome-pill--annual'
  if (outcome === 'skipped_non_annual') return 'monthly-route-detail-performance__outcome-pill--skipped'
  return 'monthly-route-detail-performance__outcome-pill--pending'
}

type KpiTone = 'default' | 'positive' | 'negative'

const ROUTE_TIMING_TOOLTIP =
  'Route hours and revenue per route hour use ServiceTrade run timing when per-stop visit times are missing or partial.'

function KpiInfoTooltip({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <OverlayTrigger
      placement="top"
      trigger={['hover', 'focus']}
      overlay={
        <Tooltip id={id} className="monthly-route-detail-performance__kpi-tooltip">
          {children}
        </Tooltip>
      }
    >
      <button
        type="button"
        className="monthly-route-detail-performance__kpi-info"
        aria-label={label}
      >
        <i className="bi bi-info-circle" aria-hidden />
      </button>
    </OverlayTrigger>
  )
}

function KpiMetric({
  label,
  value,
  tone = 'default',
  infoTooltip,
  infoLabel,
}: {
  label: string
  value: string
  tone?: KpiTone
  infoTooltip?: string
  infoLabel?: string
}) {
  return (
    <div
      className={`monthly-route-detail-performance__kpi${tone !== 'default' ? ` monthly-route-detail-performance__kpi--${tone}` : ''}`}
    >
      <span className="monthly-route-detail-performance__kpi-label">
        {label}
        {infoTooltip ? (
          <KpiInfoTooltip id={`perf-kpi-${label.replace(/\W+/g, '-').toLowerCase()}`} label={infoLabel ?? label}>
            {infoTooltip}
          </KpiInfoTooltip>
        ) : null}
      </span>
      <span className="monthly-route-detail-performance__kpi-value tabular-nums">{value}</span>
    </div>
  )
}

function PerformanceSummaryPanel({ summary }: { summary: RoutePerformanceBreakdownSummary }) {
  const netTone: KpiTone =
    summary.monthly_net != null && summary.monthly_net < 0
      ? 'negative'
      : summary.monthly_net != null && summary.monthly_net > 0
        ? 'positive'
        : 'default'
  const showRouteTimingTooltip =
    summary.visit_time_coverage !== 'full' && summary.route_duration_source === 'servicetrade'
  const routeTimingTooltip = showRouteTimingTooltip ? ROUTE_TIMING_TOOLTIP : undefined

  return (
    <div className="monthly-route-detail-performance__kpi-panel">
      <div className="monthly-route-detail-performance__kpi-grid">
        <KpiMetric
          label="Revenue"
          value={formatCurrencyCad(summary.tested_revenue_total)}
          tone="positive"
        />
        <KpiMetric label="Expense" value={formatCurrencyCad(summary.monthly_expense)} />
        <KpiMetric
          label="Net"
          value={summary.monthly_net != null ? formatCurrencyCad(summary.monthly_net) : '—'}
          tone={netTone}
        />
        <KpiMetric label="Net %" value={formatNetPct(summary.monthly_net_pct)} tone={netTone} />
        <KpiMetric
          label="Route hours"
          value={summary.route_hours != null ? `${summary.route_hours} hr` : '—'}
          infoTooltip={routeTimingTooltip}
          infoLabel="How route hours are calculated"
        />
        <KpiMetric
          label="Rev / route hr"
          value={
            summary.revenue_per_route_hour != null
              ? formatCurrencyCad(summary.revenue_per_route_hour)
              : '—'
          }
          infoTooltip={routeTimingTooltip}
          infoLabel="How revenue per route hour is calculated"
        />
      </div>
    </div>
  )
}

function PerformanceMetaBar({ summary }: { summary: RoutePerformanceBreakdownSummary }) {
  const items: string[] = [
    `${summary.tested_count} tested`,
    `${summary.skipped_annual_count} annual skip`,
    `${summary.skipped_non_annual_count} skipped`,
    `${summary.pending_count} pending`,
  ]
  if (summary.sum_visit_minutes > 0) {
    items.push(`${formatDuration(summary.sum_visit_minutes)} on stops`)
  }
  if (summary.unaccounted_minutes != null && summary.unaccounted_minutes > 0) {
    items.push(`${formatDuration(summary.unaccounted_minutes)} unaccounted`)
  }

  return (
    <div className="monthly-route-detail-performance__meta-bar" aria-label="Stop counts and visit time">
      {items.map((item) => (
        <span key={item} className="monthly-route-detail-performance__meta-chip">
          {item}
        </span>
      ))}
    </div>
  )
}

function formatServiceTradeRunClockRange(summary: RoutePerformanceBreakdownSummary): string | null {
  const { route_clock_in: start, route_clock_out: end } = summary
  if (start && end) return `${start} – ${end}`
  if (start) return `Started ${start}`
  if (end) return `Ended ${end}`
  return null
}

function PerformanceRunTimingBar({ summary }: { summary: RoutePerformanceBreakdownSummary }) {
  const clockRange = formatServiceTradeRunClockRange(summary)
  if (!clockRange) return null

  return (
    <div className="monthly-route-detail-performance__run-timing" aria-label="ServiceTrade run clock times">
      <span className="monthly-route-detail-performance__run-timing-label">
        <i className="bi bi-clock-history" aria-hidden />
        ServiceTrade run
      </span>
      <span className="monthly-route-detail-performance__run-timing-value tabular-nums">{clockRange}</span>
    </div>
  )
}

const PERFORMANCE_MONTH_JUMP_THRESHOLD = 6

function PerformanceMonthToolbar({
  monthOptions,
  monthIso,
  loading,
  onChangeMonth,
}: {
  monthOptions: string[]
  monthIso: string | null
  loading: boolean
  onChangeMonth: (monthIso: string) => void
}) {
  const monthIndex = monthIso != null ? monthOptions.indexOf(monthIso) : -1
  const showJumpMenu = monthOptions.length > PERFORMANCE_MONTH_JUMP_THRESHOLD
  const canGoOlder = monthIndex >= 0 && monthIndex < monthOptions.length - 1
  const canGoNewer = monthIndex > 0
  const monthHeading = monthIso ? formatMonthHeading(monthIso) : '—'

  if (monthOptions.length <= 1) {
    return (
      <div className="monthly-route-detail-performance__month-toolbar monthly-route-detail-performance__month-toolbar--single">
        <span className="monthly-route-detail-performance__month-toolbar-label">Viewing</span>
        <span className="monthly-route-detail-performance__month-heading">{monthHeading}</span>
      </div>
    )
  }

  return (
    <div className="monthly-route-detail-performance__month-toolbar">
      <div
        className="monthly-route-year-toolbar monthly-route-year-toolbar--compact monthly-route-detail-performance__month-stepper"
        aria-label="Performance month"
      >
        <Button
          type="button"
          variant="outline-secondary"
          size="sm"
          className="monthly-route-year-toolbar__button"
          disabled={!canGoOlder || loading}
          aria-label="Previous month"
          onClick={() => {
            if (canGoOlder && monthIndex >= 0) {
              onChangeMonth(monthOptions[monthIndex + 1])
            }
          }}
        >
          <i className="bi bi-chevron-left" aria-hidden />
        </Button>
        <span
          className="monthly-route-year-toolbar__year monthly-route-detail-performance__month-heading tabular-nums"
          aria-live="polite"
        >
          {monthHeading}
          {loading && monthIso ? (
            <Spinner
              animation="border"
              size="sm"
              className="monthly-route-detail-performance__month-spinner"
              aria-label="Loading month"
            />
          ) : null}
        </span>
        <Button
          type="button"
          variant="outline-secondary"
          size="sm"
          className="monthly-route-year-toolbar__button"
          disabled={!canGoNewer || loading}
          aria-label="Next month"
          onClick={() => {
            if (canGoNewer && monthIndex >= 0) {
              onChangeMonth(monthOptions[monthIndex - 1])
            }
          }}
        >
          <i className="bi bi-chevron-right" aria-hidden />
        </Button>
      </div>
      {showJumpMenu ? (
        <div className="monthly-route-detail-performance__month-jump">
          <Form.Label htmlFor="route-performance-month-jump" className="monthly-route-detail-performance__month-jump-label">
            Jump to
          </Form.Label>
          <Form.Select
            id="route-performance-month-jump"
            size="sm"
            className="monthly-route-detail-performance__month-jump-select"
            value={monthIso ?? ''}
            onChange={(e) => {
              const next = e.target.value
              if (next) onChangeMonth(next)
            }}
            disabled={loading}
            aria-label="Jump to month"
          >
            {monthOptions.map((iso) => (
              <option key={iso} value={iso}>
                {formatMonthHeading(iso)}
              </option>
            ))}
          </Form.Select>
        </div>
      ) : null}
    </div>
  )
}

export default function RoutePerformanceBreakdown({
  routeId,
  monthCandidates = [],
  hideTitle = false,
  onSummaryChange,
}: Props) {
  const [monthIso, setMonthIso] = useState<string | null>(null)
  const [payload, setPayload] = useState<RoutePerformanceBreakdownPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const monthOptions = useMemo(() => {
    const merged = new Set<string>([
      ...(payload?.available_months ?? []),
      ...monthCandidates,
    ])
    if (merged.size > 0) {
      return Array.from(merged).sort().reverse()
    }
    return []
  }, [payload?.available_months, monthCandidates])

  useEffect(() => {
    if (monthOptions.length === 0) return
    const preferred = pickDefaultPerformanceMonth(monthOptions)
    if (monthIso == null) {
      setMonthIso(preferred)
      return
    }
    if (!monthOptions.includes(monthIso)) {
      setMonthIso(preferred)
    }
  }, [monthIso, monthOptions])

  const loadBreakdown = useCallback(
    async (targetMonth: string, signal?: AbortSignal) => {
      setLoading(true)
      setError(null)
      try {
        const qs = new URLSearchParams({ month_date: targetMonth })
        const data = await apiJson<RoutePerformanceBreakdownPayload>(
          `/api/monthly_routes/routes/${routeId}/performance_breakdown?${qs.toString()}`,
          { signal },
        )
        setPayload(data)
        onSummaryChange?.({
          monthLabel: formatMonthHeading(data.month_date),
          revenue: data.summary.tested_revenue_total,
          net: data.summary.monthly_net,
        })
      } catch (err) {
        if (isAbortError(err)) return
        setPayload(null)
        setError('Unable to load performance breakdown for this month.')
      } finally {
        setLoading(false)
      }
    },
    [routeId, onSummaryChange],
  )

  useEffect(() => {
    if (monthIso == null) return
    const controller = new AbortController()
    void loadBreakdown(monthIso, controller.signal)
    return () => controller.abort()
  }, [monthIso, loadBreakdown])

  if (monthOptions.length === 0) {
    return (
      <div className="monthly-route-detail-performance__empty-state">
        Performance breakdown appears when this route has testing history, a run, or ServiceTrade run
        timing for at least one month.
      </div>
    )
  }

  return (
    <div className="monthly-route-detail-performance">
      {hideTitle ? null : (
        <header className="monthly-route-detail-performance__header">
          <div className="monthly-route-detail-performance__header-copy">
            <h3 className="monthly-route-detail-performance__title">Month profitability</h3>
            <p className="monthly-route-detail-performance__subtitle">
              Billable revenue (Bill status only), route expense, and per-stop visit times for the
              selected month.
            </p>
          </div>
        </header>
      )}

      <PerformanceMonthToolbar
        monthOptions={monthOptions}
        monthIso={monthIso}
        loading={loading}
        onChangeMonth={setMonthIso}
      />

      {error ? <div className="monthly-route-detail-performance__alert">{error}</div> : null}

      {loading && !payload ? (
        <div className="monthly-route-detail-performance__loading">
          <Spinner animation="border" size="sm" aria-hidden />
          <span>Loading performance…</span>
        </div>
      ) : null}

      {payload ? (
        <div className={loading ? 'monthly-route-detail-performance__body monthly-route-detail-performance__body--loading' : 'monthly-route-detail-performance__body'}>
          <PerformanceSummaryPanel summary={payload.summary} />
          <PerformanceRunTimingBar summary={payload.summary} />
          <PerformanceMetaBar summary={payload.summary} />

          {payload.insights.length > 0 ? (
            <div className="monthly-route-detail-performance__insights" role="note">
              <div className="monthly-route-detail-performance__insights-title">Insights</div>
              <ul className="monthly-route-detail-performance__insights-list">
                {payload.insights.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="monthly-route-detail-performance__table-panel">
            <Table className="monthly-route-detail-performance__table mb-0 align-middle">
              <thead>
                <tr>
                  <th className="monthly-route-detail-performance__col-stop text-center">Stop</th>
                  <th className="monthly-route-detail-performance__col-site">Site</th>
                  <th className="monthly-route-detail-performance__col-outcome">Outcome</th>
                  <th className="monthly-route-detail-performance__col-time">In</th>
                  <th className="monthly-route-detail-performance__col-time">Out</th>
                  <th className="monthly-route-detail-performance__col-duration text-end">Duration</th>
                  <th className="monthly-route-detail-performance__col-money text-end">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {payload.stops.map((stop, index) => (
                  <tr key={stop.location_id}>
                    <td className="text-center tabular-nums monthly-route-detail-performance__col-stop">
                      {stop.stop_order ?? index + 1}
                    </td>
                    <td className="monthly-route-detail-performance__col-site">
                      <Link
                        className="monthly-route-detail-performance__site-link"
                        to={`/monthlies/locations/${stop.location_id}`}
                      >
                        {stop.label}
                      </Link>
                    </td>
                    <td className="monthly-route-detail-performance__col-outcome">
                      <span
                        className={`monthly-route-detail-performance__outcome-pill ${outcomePillClass(stop.outcome)}`}
                      >
                        {outcomeLabel(stop.outcome)}
                      </span>
                    </td>
                    <td className="tabular-nums monthly-route-detail-performance__col-time">
                      {stop.time_in ?? '—'}
                    </td>
                    <td className="tabular-nums monthly-route-detail-performance__col-time">
                      {stop.time_out ?? '—'}
                    </td>
                    <td className="text-end tabular-nums monthly-route-detail-performance__col-duration">
                      {formatDuration(stop.visit_minutes)}
                    </td>
                    <td className="text-end tabular-nums monthly-route-detail-performance__col-money">
                      {formatCurrencyCad(stop.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {payload.stops.length > 0 ? (
                <tfoot>
                  <tr className="monthly-route-detail-performance__table-totals">
                    <td
                      colSpan={3}
                      className="monthly-route-detail-performance__table-totals-label"
                    >
                      Total for {formatMonthHeading(payload.month_date)}
                    </td>
                    <td className="tabular-nums monthly-route-detail-performance__col-time">
                      {performanceTableRouteStartTime(payload.summary, payload.stops) ?? '—'}
                    </td>
                    <td className="tabular-nums monthly-route-detail-performance__col-time">
                      {performanceTableRouteEndTime(payload.summary, payload.stops) ?? '—'}
                    </td>
                    <td className="text-end tabular-nums monthly-route-detail-performance__col-duration">
                      {formatDuration(payload.summary.sum_visit_minutes)}
                    </td>
                    <td className="text-end tabular-nums monthly-route-detail-performance__col-money">
                      {formatCurrencyCad(payload.summary.tested_revenue_total)}
                    </td>
                  </tr>
                </tfoot>
              ) : null}
            </Table>
          </div>
        </div>
      ) : null}
    </div>
  )
}
