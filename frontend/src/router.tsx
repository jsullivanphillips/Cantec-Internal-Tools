import { lazy } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import AppLayout from './layout/AppLayout'
import KeysPublicLayout from './layout/KeysPublicLayout'
import LoginPage from './pages/LoginPage'

const HomePage = lazy(() => import('./pages/HomePage'))
const FindSchedulePage = lazy(() => import('./pages/FindSchedulePage'))
const KeysHomePage = lazy(() => import('./pages/KeysHomePage'))
const KeyDetailPage = lazy(() => import('./pages/KeyDetailPage'))
const KeyByBarcodePage = lazy(() => import('./pages/KeyByBarcodePage'))
const PerformanceSummaryPage = lazy(() => import('./pages/PerformanceSummaryPage'))
const MonthlySpecialistsPage = lazy(() => import('./pages/MonthlySpecialistsPage'))
const KeyMetricsPage = lazy(() => import('./pages/KeyMetricsPage'))
const DeficiencyTrackerPage = lazy(() => import('./pages/DeficiencyTrackerPage'))
const SchedulingAttackPage = lazy(() => import('./pages/SchedulingAttackPage'))
const ProcessingAttackPage = lazy(() => import('./pages/ProcessingAttackPage'))
const QuotationToolPage = lazy(() => import('./pages/QuotationToolPage'))

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/keys/metrics',
    element: <AppLayout />,
    children: [{ index: true, element: <KeyMetricsPage /> }],
  },
  {
    path: '/keys',
    element: <KeysPublicLayout />,
    children: [
      { index: true, element: <KeysHomePage /> },
      { path: 'by-barcode/:barcode', element: <KeyByBarcodePage /> },
      { path: ':keyId', element: <KeyDetailPage /> },
    ],
  },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/home" replace /> },
      { path: 'home', element: <HomePage /> },
      { path: 'find_schedule', element: <FindSchedulePage /> },
      { path: 'quotation_tool', element: <QuotationToolPage /> },
      { path: 'deficiency_tracker', element: <DeficiencyTrackerPage /> },
      { path: 'scheduling_attack', element: <SchedulingAttackPage /> },
      { path: 'monthly_specialist', element: <MonthlySpecialistsPage /> },
      { path: 'processing_attack', element: <ProcessingAttackPage /> },
      { path: 'limbo_job_tracker', element: <Navigate to="/processing_attack?tab=limbo" replace /> },
      { path: 'performance_summary', element: <PerformanceSummaryPage /> },
    ],
  },
])
