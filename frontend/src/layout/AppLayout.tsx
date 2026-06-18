import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/apiClient'
import { Button, Offcanvas } from 'react-bootstrap'
import CollapsibleAppSidebar from './CollapsibleAppSidebar'
import { SidebarNav } from './SidebarNav'
import MonthlyLocationHeaderSearch from './MonthlyLocationHeaderSearch'
import AppRenderErrorBoundary from '../components/AppRenderErrorBoundary'

export default function AppLayout() {
  const nav = useNavigate()
  const location = useLocation()
  const [ready, setReady] = useState(false)
  const [logoFailed, setLogoFailed] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const isPublicBatteryCalculatorRoute = location.pathname === '/battery_capacity_calculator'
  const isMonthlyRoutesMapRoute = location.pathname === '/monthlies/map'
  const isMonthlyRouteDetailRoute =
    /^\/monthlies\/routes\/\d+\/?$/.test(location.pathname) ||
    /^\/monthlies\/routes\/\d+\/runs\//.test(location.pathname)
  const isWorksheetRoute =
    location.pathname.includes('/worksheet/')

  const check = useCallback(async () => {
    if (isPublicBatteryCalculatorRoute) {
      setReady(true)
      return
    }
    try {
      const r = await apiFetch('/api/auth/me')
      const d = await r.json()
      if (!d.authenticated) {
        nav('/login', { replace: true })
        return
      }
      setReady(true)
    } catch {
      nav('/login', { replace: true })
    }
  }, [isPublicBatteryCalculatorRoute, nav])

  useEffect(() => {
    check()
  }, [check])

  const logout = async () => {
    setShowMenu(false)
    await apiFetch('/api/auth/logout', { method: 'POST' })
    nav('/login', { replace: true })
  }

  if (!ready) {
    return (
      <div className="d-flex justify-content-center align-items-center vh-100 app-canvas">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell d-flex flex-column min-vh-100 app-canvas">
      <header className="app-topbar d-flex align-items-center justify-content-between px-3 px-lg-4 border-bottom bg-white">
        <div className="d-flex align-items-center gap-3 min-w-0">
          <Button
            variant="light"
            className="d-lg-none border"
            type="button"
            aria-controls="app-sidebar-offcanvas"
            onClick={() => setShowMenu(true)}
          >
            <i className="bi bi-list fs-5" aria-hidden />
            <span className="visually-hidden">Open menu</span>
          </Button>
          <Link to="/monday_meeting" className="d-flex align-items-center text-decoration-none min-w-0">
            {!logoFailed ? (
              <img
                src="/cantec-logo-horizontal.png"
                alt="Cantec"
                className="app-topbar-logo"
                onError={() => setLogoFailed(true)}
              />
            ) : (
              <span className="fw-semibold text-primary text-truncate">Schedule Assist</span>
            )}
          </Link>
        </div>
        <div className="app-topbar-actions d-flex align-items-center gap-2 flex-shrink-0">
          <MonthlyLocationHeaderSearch />
          <Button variant="outline-secondary" size="sm" type="button" onClick={logout}>
            Log out
          </Button>
        </div>
      </header>

      <div className="app-body d-flex flex-grow-1">
        <CollapsibleAppSidebar idPrefix="side" />

        <Offcanvas
          show={showMenu}
          onHide={() => setShowMenu(false)}
          placement="start"
          id="app-sidebar-offcanvas"
          className="d-lg-none"
        >
          <Offcanvas.Header closeButton>
            <Offcanvas.Title>Menu</Offcanvas.Title>
          </Offcanvas.Header>
          <Offcanvas.Body className="p-0">
            <SidebarNav idPrefix="drawer" onNavigate={() => setShowMenu(false)} />
          </Offcanvas.Body>
        </Offcanvas>

        <main
          className={`app-main flex-grow-1 min-w-0 overflow-auto${isMonthlyRoutesMapRoute ? ' app-main--monthly-map' : ''}${isMonthlyRouteDetailRoute ? ' app-main--monthly-route-detail' : ''}${isWorksheetRoute ? ' app-main--flush' : ''}`}
        >
          <Suspense
            fallback={
              <div className="d-flex justify-content-center align-items-center py-5">
                <div className="spinner-border text-primary" role="status">
                  <span className="visually-hidden">Loading…</span>
                </div>
              </div>
            }
          >
            <AppRenderErrorBoundary>
              <Outlet />
            </AppRenderErrorBoundary>
          </Suspense>
        </main>
      </div>
    </div>
  )
}
