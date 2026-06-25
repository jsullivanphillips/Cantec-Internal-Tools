import { Card } from 'react-bootstrap'
import { useLocation } from 'react-router-dom'
import { MondayMeetingPageSuspenseFallback } from '../features/mondayMeeting/MondayMeetingTabSkeletons'
import {
  MonthlyDashboardKpiStripSkeleton,
  MonthlyDashboardTabsSkeleton,
} from '../pages/MonthlyHomePageSkeleton'
import { PROCESSING_PAGE_TITLE_COMPACT_CLASS } from '../styles/pageTypography'

function MonthlyHomePageSuspenseFallback() {
  return (
    <div className="monthlies-dashboard-page d-flex flex-column gap-3" aria-busy="true" aria-label="Loading monthlies">
      <Card className="app-surface-card monthly-hero-card monthlies-dashboard-hero">
        <Card.Body className="monthly-hero-card__body">
          <div className="monthly-hero-card__row">
            <div className="monthlies-dashboard-hero__title-line">
              <h1 className={`${PROCESSING_PAGE_TITLE_COMPACT_CLASS} m-0`}>Monthlies</h1>
            </div>
          </div>
          <MonthlyDashboardKpiStripSkeleton />
        </Card.Body>
      </Card>
      <MonthlyDashboardTabsSkeleton />
    </div>
  )
}

function DefaultRouteSuspenseFallback() {
  return (
    <div className="d-flex justify-content-center align-items-center py-5">
      <div className="spinner-border text-primary" role="status">
        <span className="visually-hidden">Loading…</span>
      </div>
    </div>
  )
}

/** Shown while a lazy route chunk is loading (React Suspense). */
export default function AppRouteSuspenseFallback() {
  const { pathname } = useLocation()
  const isMonthliesDashboard = pathname === '/monthlies' || pathname === '/monthlies/'
  const isMondayMeeting = pathname === '/monday_meeting' || pathname === '/monday_meeting/'

  if (isMonthliesDashboard) {
    return <MonthlyHomePageSuspenseFallback />
  }

  if (isMondayMeeting) {
    return <MondayMeetingPageSuspenseFallback />
  }

  return <DefaultRouteSuspenseFallback />
}
