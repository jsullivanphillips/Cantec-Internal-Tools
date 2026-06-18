import { useEffect, useState, type ReactNode } from 'react'
import OverlayTrigger from 'react-bootstrap/OverlayTrigger'
import Tooltip from 'react-bootstrap/Tooltip'
import { apiJson, isAbortError } from '../../lib/apiClient'
import { formatDistanceMeters } from './routeDistanceDisplay'
import { formatNetPct } from './routePerformanceDisplay'
import {
  readRouteHeroSummaryCache,
  writeRouteHeroSummaryCache,
} from './routeHeroSummaryCache'
import {
  DEFAULT_ROUTE_TECH_COUNT,
} from './RouteTechCountCard'
import type {
  MonthlyRouteCalculatedPathPayload,
  MonthlyRouteHeroSummary,
  MonthlySpecialistTechRow,
} from './monthlyRoutesShared'

function HeroColumn({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="monthly-location-detail-hero-column">
      <div className="monthly-location-detail-hero-column__label">{label}</div>
      <div className="monthly-location-detail-hero-column__content">{children}</div>
    </div>
  )
}

function HeroContentLine({ children }: { children: ReactNode }) {
  return <div className="monthly-location-detail-hero-line">{children}</div>
}

function HeroSkeletonBar({
  width,
  height = 12,
  className = '',
  inline = false,
}: {
  width: string
  height?: number
  className?: string
  inline?: boolean
}) {
  return (
    <span
      className={`home-skeleton-bar ${inline ? 'd-inline-block align-middle' : 'd-block'} ${className}`.trim()}
      style={{ width, height }}
      aria-hidden
    />
  )
}

const SPECIALIST_SKELETON_WIDTHS = ['9rem', '7.5rem', '8.25rem', '6.5rem'] as const

const AVG_NET_PCT_TOOLTIP =
  'Average margin on tested revenue after labour and truck expense. Each month: (tested revenue − expense) ÷ tested revenue; labour uses ServiceTrade run timing when available.'

function HeroMetricInfoTooltip({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <OverlayTrigger
      placement="top"
      trigger={['hover', 'focus']}
      overlay={
        <Tooltip id={id} className="monthly-route-detail-hero__metric-tooltip">
          {children}
        </Tooltip>
      }
    >
      <button
        type="button"
        className="monthly-route-detail-hero__metric-info"
        aria-label={label}
      >
        <i className="bi bi-info-circle" aria-hidden />
      </button>
    </OverlayTrigger>
  )
}

function specialistTechLabel(t: MonthlySpecialistTechRow): string {
  return (t.tech_name || t.name || '').trim() || '—'
}

function specialistTechJobs(t: MonthlySpecialistTechRow): number {
  return typeof t.jobs === 'number' ? t.jobs : 0
}

function specialistBadgeClass(jobs: number) {
  if (jobs >= 15) return 'monthly-tech-badge--diamond'
  if (jobs > 10) return 'monthly-tech-badge--gold'
  if (jobs > 5) return 'monthly-tech-badge--silver'
  return 'monthly-tech-badge--bronze'
}

function specialistBadgeTier(jobs: number) {
  if (jobs >= 15) return 'Diamond'
  if (jobs > 10) return 'Gold'
  if (jobs > 5) return 'Silver'
  return 'Bronze'
}

function formatAvgSkips(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

type Props = {
  routeTitle: string
  routeId: number
  techCount: number | null | undefined
  heroTopSpecialists: MonthlySpecialistTechRow[]
  routeStopTotal: number
  monitoringSiteCount: number
  detailLoading?: boolean
  actions: ReactNode
}

export default function MonthlyRouteDetailHero({
  routeTitle,
  routeId,
  techCount,
  heroTopSpecialists,
  routeStopTotal,
  monitoringSiteCount,
  detailLoading = false,
  actions,
}: Props) {
  const [distanceMeters, setDistanceMeters] = useState<number | null>(null)
  const [distanceLoading, setDistanceLoading] = useState(true)
  const [heroSummary, setHeroSummary] = useState<MonthlyRouteHeroSummary | null>(null)
  const [heroSummaryLoading, setHeroSummaryLoading] = useState(true)

  useEffect(() => {
    if (!Number.isFinite(routeId)) {
      setHeroSummary(null)
      setHeroSummaryLoading(false)
      return
    }

    const cached = readRouteHeroSummaryCache(routeId)
    if (cached) {
      setHeroSummary(cached)
      setHeroSummaryLoading(false)
    } else {
      setHeroSummary(null)
      setHeroSummaryLoading(true)
    }

    const controller = new AbortController()
    apiJson<{ hero_summary: MonthlyRouteHeroSummary }>(
      `/api/monthly_routes/routes/${routeId}/hero_summary`,
      { signal: controller.signal },
    )
      .then((payload) => {
        if (controller.signal.aborted) return
        const summary = payload.hero_summary ?? null
        setHeroSummary(summary)
        if (summary) writeRouteHeroSummaryCache(routeId, summary)
      })
      .catch((e) => {
        if (isAbortError(e) || controller.signal.aborted) return
        if (!cached) setHeroSummary(null)
      })
      .finally(() => {
        if (!controller.signal.aborted) setHeroSummaryLoading(false)
      })

    return () => controller.abort()
  }, [routeId])

  useEffect(() => {
    if (detailLoading || !Number.isFinite(routeId) || routeStopTotal === 0) {
      setDistanceMeters(null)
      setDistanceLoading(false)
      return
    }

    const controller = new AbortController()
    setDistanceLoading(true)
    apiJson<MonthlyRouteCalculatedPathPayload>(
      `/api/monthly_routes/routes/${routeId}/calculated_path`,
      { signal: controller.signal },
    )
      .then((payload) => {
        if (controller.signal.aborted) return
        setDistanceMeters(payload.distance_meters ?? null)
      })
      .catch((e) => {
        if (isAbortError(e) || controller.signal.aborted) return
        setDistanceMeters(null)
      })
      .finally(() => {
        if (!controller.signal.aborted) setDistanceLoading(false)
      })

    return () => controller.abort()
  }, [routeId, routeStopTotal, detailLoading])

  const effectiveTechCount = techCount ?? DEFAULT_ROUTE_TECH_COUNT
  const techCountUsesDefault = techCount == null

  return (
    <section
      className={`monthly-route-detail-hero monthly-location-detail-hero monthly-location-detail-surface${
        detailLoading || heroSummaryLoading || distanceLoading ? ' home-skeleton' : ''
      }`}
    >
      <div className="monthly-location-detail-hero-title-row">
        <div className="monthly-location-detail-hero-title-group">
          <h1 className="monthly-location-detail-title">
            {routeTitle.trim() || 'Route'}
          </h1>
        </div>
        <div className="monthly-location-detail-hero-actions monthly-route-detail-hero__actions">
          {actions}
        </div>
      </div>

      <div className="monthly-location-detail-hero-columns monthly-route-detail-hero-columns">
        <HeroColumn label="Specialists">
          {detailLoading ? (
            <>
              {SPECIALIST_SKELETON_WIDTHS.map((width) => (
                <HeroContentLine key={width}>
                  <HeroSkeletonBar width={width} height={22} className="rounded-pill" />
                </HeroContentLine>
              ))}
            </>
          ) : heroTopSpecialists.length > 0 ? (
            heroTopSpecialists.map((tech, index) => (
              <HeroContentLine key={`${specialistTechLabel(tech)}:${index}`}>
                <span
                  className={`monthly-route-detail-hero__specialist-chip monthly-tech-badge ${specialistBadgeClass(specialistTechJobs(tech))}`}
                  title={`${specialistBadgeTier(specialistTechJobs(tech))} tier`}
                >
                  {specialistTechLabel(tech)}
                  <span className="tabular-nums">({specialistTechJobs(tech)})</span>
                </span>
              </HeroContentLine>
            ))
          ) : (
            <HeroContentLine>—</HeroContentLine>
          )}
        </HeroColumn>

        <HeroColumn label="Locations">
          <HeroContentLine>
            <span className="monthly-location-detail-hero-muted-label">Stops</span>{' '}
            {detailLoading ? (
              <HeroSkeletonBar width="2rem" height={12} inline />
            ) : (
              <span className="tabular-nums">{routeStopTotal}</span>
            )}
          </HeroContentLine>
          <HeroContentLine>
            <span className="monthly-location-detail-hero-muted-label">Distance</span>{' '}
            {detailLoading || distanceLoading ? (
              <HeroSkeletonBar width="4.5rem" height={12} inline />
            ) : (
              formatDistanceMeters(distanceMeters)
            )}
          </HeroContentLine>
          <HeroContentLine>
            <span className="monthly-location-detail-hero-muted-label">Monitoring</span>{' '}
            {detailLoading ? (
              <HeroSkeletonBar width="3.5rem" height={12} inline />
            ) : (
              <>
                <span className="tabular-nums">{monitoringSiteCount}</span>
                {monitoringSiteCount === 1 ? ' site' : ' sites'}
              </>
            )}
          </HeroContentLine>
        </HeroColumn>

        <HeroColumn label="Performance">
          <HeroContentLine>
            <span className="monthly-location-detail-hero-muted-label">Techs required</span>{' '}
            <span className="tabular-nums">{effectiveTechCount}</span>
            {techCountUsesDefault ? (
              <span className="monthly-route-detail-hero__default-hint text-muted"> (default)</span>
            ) : null}
          </HeroContentLine>
          <HeroContentLine>
            <span className="monthly-location-detail-hero-muted-label">Median end</span>{' '}
            {heroSummaryLoading ? (
              <HeroSkeletonBar width="5rem" height={12} inline />
            ) : (
              <>
                {heroSummary?.typical_end_time ?? '—'}
                {heroSummary && heroSummary.typical_end_time_runs_sampled > 0 ? (
                  <span className="monthly-route-detail-hero__sample-hint text-muted">
                    {' '}
                    ({heroSummary.typical_end_time_runs_sampled} run
                    {heroSummary.typical_end_time_runs_sampled === 1 ? '' : 's'})
                  </span>
                ) : null}
              </>
            )}
          </HeroContentLine>
          <HeroContentLine>
            <span className="monthly-location-detail-hero-muted-label">Avg Net %</span>{' '}
            {heroSummaryLoading ? (
              <HeroSkeletonBar width="3rem" height={12} inline />
            ) : (
              <>
                {formatNetPct(heroSummary?.avg_net_pct)}
                {heroSummary && heroSummary.net_pct_months_sampled > 0 ? (
                  <span className="monthly-route-detail-hero__sample-hint text-muted">
                    {' '}
                    ({heroSummary.net_pct_months_sampled} mo)
                  </span>
                ) : null}
                <HeroMetricInfoTooltip id="route-hero-avg-net-pct" label="About avg net percent">
                  {AVG_NET_PCT_TOOLTIP}
                </HeroMetricInfoTooltip>
              </>
            )}
          </HeroContentLine>
          <HeroContentLine>
            <span className="monthly-location-detail-hero-muted-label">Avg sites skipped</span>{' '}
            {heroSummaryLoading ? (
              <HeroSkeletonBar width="2.25rem" height={12} inline />
            ) : (
              <>
                {formatAvgSkips(heroSummary?.avg_skipped_non_annual)}
                {heroSummary && heroSummary.skipped_months_sampled > 0 ? (
                  <span className="monthly-route-detail-hero__sample-hint text-muted">
                    {' '}
                    ({heroSummary.skipped_months_sampled} mo)
                  </span>
                ) : null}
              </>
            )}
          </HeroContentLine>
        </HeroColumn>
      </div>
    </section>
  )
}
