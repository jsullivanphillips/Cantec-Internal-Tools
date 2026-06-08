import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/apiClient'
import { Button, Offcanvas } from 'react-bootstrap'
import { SidebarNav } from './SidebarNav'

const APP_SIDEBAR_EXPAND_TRANSITION_MS = 220

export default function AppLayout() {
  const nav = useNavigate()
  const location = useLocation()
  const [ready, setReady] = useState(false)
  const [logoFailed, setLogoFailed] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [navExpanded, setNavExpanded] = useState(true)
  const [navItemsExpanded, setNavItemsExpanded] = useState(true)
  const [navLabelsAnimating, setNavLabelsAnimating] = useState(false)
  const navWasCollapsedRef = useRef(false)
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

  useEffect(() => {
    if (!navExpanded) {
      setNavItemsExpanded(false)
      setNavLabelsAnimating(false)
      navWasCollapsedRef.current = true
      return undefined
    }

    const shouldAnimateLabels = navWasCollapsedRef.current
    navWasCollapsedRef.current = false

    const revealTimer = window.setTimeout(() => {
      setNavItemsExpanded(true)
      if (shouldAnimateLabels) {
        setNavLabelsAnimating(true)
      }
    }, APP_SIDEBAR_EXPAND_TRANSITION_MS)

    return () => window.clearTimeout(revealTimer)
  }, [navExpanded])

  useEffect(() => {
    if (!navLabelsAnimating) return undefined
    const timer = window.setTimeout(() => setNavLabelsAnimating(false), 360)
    return () => window.clearTimeout(timer)
  }, [navLabelsAnimating])

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
          <Link to="/home" className="d-flex align-items-center text-decoration-none min-w-0">
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
        <Button variant="outline-secondary" size="sm" type="button" onClick={logout}>
          Log out
        </Button>
      </header>

      <div className="app-body d-flex flex-grow-1">
        <aside
          className={`app-sidebar d-none d-lg-grid${
            navExpanded ? ' app-sidebar--expanded' : ' app-sidebar--collapsed'
          }`}
        >
          <div
            className={`app-sidebar__inner${
              navItemsExpanded ? ' app-sidebar__inner--expanded' : ' app-sidebar__inner--collapsed'
            }`}
          >
            <SidebarNav
              idPrefix="side"
              shellExpanded={navExpanded}
              itemsExpanded={navItemsExpanded}
              animateLabels={navLabelsAnimating}
            />
          </div>
          <button
            type="button"
            className="app-sidebar-toggle"
            aria-expanded={navExpanded}
            onClick={() => setNavExpanded((v) => !v)}
          >
            <i
              className={`bi ${navExpanded ? 'bi-chevron-double-left' : 'bi-chevron-double-right'}`}
              aria-hidden
            />
            {navItemsExpanded ? (
              <span
                className={`app-sidebar-toggle-label${
                  navLabelsAnimating ? ' app-sidebar-toggle-label--revealing' : ''
                }`}
              >
                Collapse menu
              </span>
            ) : null}
          </button>
        </aside>

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
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
