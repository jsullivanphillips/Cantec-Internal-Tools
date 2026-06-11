import { lazy } from 'react'
import { createBrowserRouter, Navigate, useParams } from 'react-router-dom'
import AppRouteErrorPage from './components/AppRouteErrorPage'
import AppLayout from './layout/AppLayout'
import KeysPublicLayout from './layout/KeysPublicLayout'
import TechnicianPortalLayout from './layout/TechnicianPortalLayout'
import LoginPage from './pages/LoginPage'

const HomePage = lazy(() => import('./pages/HomePage'))
const FindSchedulePage = lazy(() => import('./pages/FindSchedulePage'))
const KeysHomePage = lazy(() => import('./pages/KeysHomePage'))
const KeyDetailPage = lazy(() => import('./pages/KeyDetailPage'))
const KeyByBarcodePage = lazy(() => import('./pages/KeyByBarcodePage'))
const PerformanceSummaryPage = lazy(() => import('./pages/PerformanceSummaryPage'))
const MonthlyHomePage = lazy(() => import('./pages/MonthlyHomePage'))
const MonthlyRoutesPage = lazy(() => import('./pages/MonthlyRoutesPage'))
const MonthlyRouteDetailPage = lazy(() => import('./pages/MonthlyRouteDetailPage'))
const MonthlyRoutePaperworkPage = lazy(() => import('./pages/MonthlyRoutePaperworkPage'))
const TechnicianWorksheetPage = lazy(() => import('./pages/TechnicianWorksheetPage'))
const MonthlyLocationDetailPage = lazy(() => import('./pages/MonthlyLocationDetailPage'))
const MonthlyRoutesMapPage = lazy(() => import('./pages/MonthlyRoutesMapPage'))
const MonthlySpecialistsPage = lazy(() => import('./pages/MonthlySpecialistsPage'))
const MonitoringCompaniesPage = lazy(() => import('./pages/MonitoringCompaniesPage'))
const MonthlyBillingPage = lazy(() => import('./pages/MonthlyBillingPage'))
const KeyMetricsPage = lazy(() => import('./pages/KeyMetricsPage'))
const DeficiencyTrackerPage = lazy(() => import('./pages/DeficiencyTrackerPage'))
const SchedulingAttackPage = lazy(() => import('./pages/SchedulingAttackPage'))
const ProcessingAttackPage = lazy(() => import('./pages/ProcessingAttackPage'))
const BatteryCapacityCalculatorPage = lazy(() => import('./pages/BatteryCapacityCalculatorPage'))
const QuotationToolPage = lazy(() => import('./pages/QuotationToolPage'))
const TechnicianPortalLockPage = lazy(() => import('./pages/TechnicianPortalLockPage'))
const TechnicianPortalTechPickerPage = lazy(() => import('./pages/TechnicianPortalTechPickerPage'))
const TechnicianPortalStartPage = lazy(() => import('./pages/TechnicianPortalStartPage'))
const TechnicianPortalRoutePage = lazy(() => import('./pages/TechnicianPortalRoutePage'))
const TechnicianPortalWorksheetPage = lazy(() => import('./pages/TechnicianPortalWorksheetPage'))
const RedirectPortalTrainingWorksheet = lazy(
  () => import('./pages/RedirectPortalTrainingWorksheet'),
)

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
      { path: 'start', element: <TechnicianPortalStartPage /> },
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
      { index: true, element: <Navigate to="/home" replace /> },
      { path: 'home', element: <HomePage /> },
      { path: 'find_schedule', element: <FindSchedulePage /> },
      { path: 'battery_capacity_calculator', element: <BatteryCapacityCalculatorPage /> },
      { path: 'quotation_tool', element: <QuotationToolPage /> },
      { path: 'deficiency_tracker', element: <DeficiencyTrackerPage /> },
      { path: 'scheduling_attack', element: <SchedulingAttackPage /> },
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
      { path: 'monthlies/specialists', element: <MonthlySpecialistsPage /> },
      { path: 'monthlies/monitoring-companies', element: <MonitoringCompaniesPage /> },
      { path: 'tools/monthly-routes', element: <Navigate to="/monthlies/locations" replace /> },
      { path: 'tools/monthly-routes/map', element: <Navigate to="/monthlies/map" replace /> },
      { path: 'processing_attack', element: <ProcessingAttackPage /> },
      { path: 'limbo_job_tracker', element: <Navigate to="/processing_attack?tab=limbo" replace /> },
      { path: 'performance_summary', element: <PerformanceSummaryPage /> },
    ],
  },
])
