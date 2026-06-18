import { lazyWithChunkRetry } from './lib/lazyWithChunkRetry'
import { createBrowserRouter, Navigate, useParams, useSearchParams } from 'react-router-dom'
import AppRouteErrorPage from './components/AppRouteErrorPage'
import AppLayout from './layout/AppLayout'
import KeysPublicLayout from './layout/KeysPublicLayout'
import TechnicianPortalLayout from './layout/TechnicianPortalLayout'
import LoginPage from './pages/LoginPage'

const FindSchedulePage = lazyWithChunkRetry(() => import('./pages/FindSchedulePage'))
const KeysHomePage = lazyWithChunkRetry(() => import('./pages/KeysHomePage'))
const KeysAdminPage = lazyWithChunkRetry(() => import('./pages/KeysAdminPage'))
const KeyDetailPage = lazyWithChunkRetry(() => import('./pages/KeyDetailPage'))
const KeyByBarcodePage = lazyWithChunkRetry(() => import('./pages/KeyByBarcodePage'))
const TechnicianMeetingPage = lazyWithChunkRetry(() => import('./pages/TechnicianMeetingPage'))
const MonthlyHomePage = lazyWithChunkRetry(() => import('./pages/MonthlyHomePage'))
const MonthlyRoutesPage = lazyWithChunkRetry(() => import('./pages/MonthlyRoutesPage'))
const MonthlyRouteDetailPage = lazyWithChunkRetry(() => import('./pages/MonthlyRouteDetailPage'))
const MonthlyRoutePaperworkPage = lazyWithChunkRetry(() => import('./pages/MonthlyRoutePaperworkPage'))
const TechnicianWorksheetPage = lazyWithChunkRetry(() => import('./pages/TechnicianWorksheetPage'))
const MonthlyLocationDetailPage = lazyWithChunkRetry(() => import('./pages/MonthlyLocationDetailPage'))
const MonthlyRoutesMapPage = lazyWithChunkRetry(() => import('./pages/MonthlyRoutesMapPage'))
const MonitoringCompaniesPage = lazyWithChunkRetry(() => import('./pages/MonitoringCompaniesPage'))
const MonthlyBillingPage = lazyWithChunkRetry(() => import('./pages/MonthlyBillingPage'))
const KeyMetricsPage = lazyWithChunkRetry(() => import('./pages/KeyMetricsPage'))
const DeficiencyTrackerPage = lazyWithChunkRetry(() => import('./pages/DeficiencyTrackerPage'))
const MondayMeetingPage = lazyWithChunkRetry(() => import('./pages/MondayMeetingPage'))
const MondayMeetingServiceAdminPage = lazyWithChunkRetry(() => import('./pages/MondayMeetingServiceAdminPage'))
const LimboJobTrackerPage = lazyWithChunkRetry(() => import('./pages/LimboJobTrackerPage'))
const BatteryCapacityCalculatorPage = lazyWithChunkRetry(() => import('./pages/BatteryCapacityCalculatorPage'))
const QuotationToolPage = lazyWithChunkRetry(() => import('./pages/QuotationToolPage'))
const TechnicianPortalLockPage = lazyWithChunkRetry(() => import('./pages/TechnicianPortalLockPage'))
const TechnicianPortalTechPickerPage = lazyWithChunkRetry(() => import('./pages/TechnicianPortalTechPickerPage'))
const TechnicianPortalHubPage = lazyWithChunkRetry(() => import('./pages/TechnicianPortalHubPage'))
const TechnicianPortalStartPage = lazyWithChunkRetry(() => import('./pages/TechnicianPortalStartPage'))
const TechnicianPortalRoutePage = lazyWithChunkRetry(() => import('./pages/TechnicianPortalRoutePage'))
const TechnicianPortalWorksheetPage = lazyWithChunkRetry(() => import('./pages/TechnicianPortalWorksheetPage'))
const TechnicianPortalLocationPage = lazyWithChunkRetry(() => import('./pages/TechnicianPortalLocationPage'))
const RedirectPortalTrainingWorksheet = lazyWithChunkRetry(
  () => import('./pages/RedirectPortalTrainingWorksheet'),
)

/** Legacy Jobs Backlog URL → Monday Meeting (or related tab). */
function RedirectProcessingAttack() {
  const [searchParams] = useSearchParams()
  const tab = searchParams.get('tab')
  if (tab === 'weekly') return <Navigate to="/monday_meeting?tab=processing-history" replace />
  if (tab === 'limbo') return <Navigate to="/limbo_job_tracker" replace />
  return <Navigate to="/monday_meeting" replace />
}

/** Legacy mockup URL → live training route worksheet. */
function RedirectPortalWorksheetMockup() {
  return <RedirectPortalTrainingWorksheet />
}

function paperworkUrl(routeId: string, monthIso?: string | null): string {
  const base = `/monthlies/routes/${routeId}/paperwork`
  if (!monthIso?.trim()) return base
  return `${base}?month=${encodeURIComponent(monthIso.trim())}`
}

/** Old session-ledger URLs forward to Paperwork. */
function RedirectMonthlySessionToPaperwork() {
  const { routeId, monthIso } = useParams<{ routeId: string; monthIso: string }>()
  if (!routeId?.trim() || !monthIso?.trim()) return <Navigate to="/monthlies" replace />
  return <Navigate to={paperworkUrl(routeId, monthIso)} replace />
}

/** Legacy run-details URLs forward to Paperwork. */
function RedirectMonthlyRunToPaperwork() {
  const { routeId, monthIso } = useParams<{ routeId: string; monthIso: string }>()
  if (!routeId?.trim() || !monthIso?.trim()) return <Navigate to="/monthlies" replace />
  return <Navigate to={paperworkUrl(routeId, monthIso)} replace />
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, errorElement: <AppRouteErrorPage /> },
  {
    path: '/keys/metrics',
    element: <AppLayout />,
    errorElement: <AppRouteErrorPage />,
    children: [{ index: true, element: <KeyMetricsPage /> }],
  },
  {
    path: '/keys',
    element: <KeysPublicLayout />,
    errorElement: <AppRouteErrorPage />,
    children: [
      { index: true, element: <KeysHomePage /> },
      { path: 'by-barcode/:barcode', element: <KeyByBarcodePage /> },
      { path: ':keyId', element: <KeyDetailPage /> },
    ],
  },
  {
    path: '/tech',
    element: <TechnicianPortalLayout />,
    errorElement: <AppRouteErrorPage />,
    children: [
      { index: true, element: <TechnicianPortalLockPage /> },
      { path: 'technician', element: <TechnicianPortalTechPickerPage /> },
      { path: 'home', element: <TechnicianPortalHubPage /> },
      { path: 'start', element: <TechnicianPortalStartPage /> },
      { path: 'location/:locationId', element: <TechnicianPortalLocationPage /> },
      { path: 'route/:routeId', element: <TechnicianPortalRoutePage /> },
      { path: 'route/:routeId/worksheet/:monthIso', element: <TechnicianPortalWorksheetPage /> },
      { path: 'route/demo/worksheet/:monthIso', element: <RedirectPortalTrainingWorksheet /> },
      { path: 'worksheet-mockup', element: <RedirectPortalWorksheetMockup /> },
    ],
  },
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <AppRouteErrorPage />,
    children: [
      { index: true, element: <Navigate to="/monday_meeting" replace /> },
      { path: 'home', element: <Navigate to="/monday_meeting" replace /> },
      { path: 'find_schedule', element: <FindSchedulePage /> },
      { path: 'battery_capacity_calculator', element: <BatteryCapacityCalculatorPage /> },
      { path: 'quotation_tool', element: <QuotationToolPage /> },
      { path: 'deficiency_tracker', element: <DeficiencyTrackerPage /> },
      { path: 'scheduling_attack', element: <Navigate to="/monday_meeting?tab=scheduling" replace /> },
      { path: 'monday_meeting', element: <MondayMeetingPage /> },
      { path: 'monday_meeting/service/admin', element: <MondayMeetingServiceAdminPage /> },
      { path: 'monthlies', element: <MonthlyHomePage /> },
      { path: 'monthlies/routes', element: <Navigate to="/monthlies" replace /> },
      { path: 'monthlies/locations', element: <MonthlyRoutesPage /> },
      { path: 'monthlies/routes/:routeId', element: <MonthlyRouteDetailPage /> },
      { path: 'monthlies/routes/:routeId/paperwork', element: <MonthlyRoutePaperworkPage /> },
      { path: 'monthlies/routes/:routeId/sessions/:monthIso', element: <RedirectMonthlySessionToPaperwork /> },
      { path: 'monthlies/routes/:routeId/runs/:monthIso', element: <RedirectMonthlyRunToPaperwork /> },
      { path: 'monthlies/routes/:routeId/worksheet/:monthIso', element: <TechnicianWorksheetPage /> },
      { path: 'monthlies/locations/:locationId', element: <MonthlyLocationDetailPage /> },
      { path: 'monthlies/billing', element: <MonthlyBillingPage /> },
      { path: 'monthlies/map', element: <MonthlyRoutesMapPage /> },
      { path: 'monthlies/monitoring-companies', element: <MonitoringCompaniesPage /> },
      { path: 'monthlies/keys', element: <KeysAdminPage /> },
      { path: 'tools/monthly-routes', element: <Navigate to="/monthlies/locations" replace /> },
      { path: 'tools/monthly-routes/map', element: <Navigate to="/monthlies/map" replace /> },
      { path: 'processing_attack', element: <RedirectProcessingAttack /> },
      { path: 'limbo_job_tracker', element: <LimboJobTrackerPage /> },
      { path: 'technician_meeting', element: <TechnicianMeetingPage /> },
      { path: 'performance_summary', element: <Navigate to="/technician_meeting" replace /> },
    ],
  },
])
