import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/apiClient'
import { Button, Nav, Offcanvas } from 'react-bootstrap'

type NavItem = { to: string; label: string; icon: string; end?: boolean }
type NavSection = { title: string; items: NavItem[] }

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Status',
    items: [
      { to: '/processing_attack', label: 'Jobs Backlog', icon: 'bi-speedometer2' },
      { to: '/scheduling_attack', label: 'Scheduling Attack', icon: 'bi-graph-up-arrow' },
    ],
  },
  {
    title: 'Tools',
    items: [
      { to: '/keys', label: 'Keys', icon: 'bi-key', end: true },
      { to: '/find_schedule', label: 'Scheduling Assistant', icon: 'bi-calendar2-check' },
    ],
  },
  {
    title: 'Data',
    items: [
      { to: '/monthly_specialist', label: 'Monthly Specialists', icon: 'bi-people' },
      { to: '/performance_summary', label: 'Performance Summary', icon: 'bi-pie-chart' },
      { to: '/deficiency_tracker', label: 'Deficiencies', icon: 'bi-exclamation-triangle' },
    ],
  },
]

function navLinkClassName({ isActive }: { isActive: boolean }) {
  return `app-sidebar-link d-flex align-items-center gap-2 px-3 py-2 rounded${isActive ? ' active' : ''}`
}

function SidebarNav({
  onNavigate,
  idPrefix,
}: {
  onNavigate?: () => void
  idPrefix: string
}) {
  return (
    <Nav className="flex-column gap-1 px-2 pb-3" as="nav">
      <NavLink
        to="/home"
        end
        className={navLinkClassName}
        onClick={onNavigate}
        id={`${idPrefix}-home`}
      >
        <i className="bi bi-house-door" aria-hidden />
        Home
      </NavLink>
      {NAV_SECTIONS.map((section) => (
        <div key={section.title} className="mt-3">
          <div className="app-sidebar-section-title px-3 pb-1 small text-uppercase text-muted fw-semibold">
            {section.title}
          </div>
          <div className="app-sidebar-section-items d-flex flex-column gap-1">
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={navLinkClassName}
                onClick={onNavigate}
                id={`${idPrefix}-${item.to.replace(/\//g, '-')}`}
              >
                <i className={`bi ${item.icon}`} aria-hidden />
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </Nav>
  )
}

export default function AppLayout() {
  const nav = useNavigate()
  const [ready, setReady] = useState(false)
  const [logoFailed, setLogoFailed] = useState(false)
  const [showMenu, setShowMenu] = useState(false)

  const check = useCallback(async () => {
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
  }, [nav])

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
        <aside className="app-sidebar d-none d-lg-flex flex-column border-end bg-white">
          <div className="flex-grow-1 overflow-auto pt-3">
            <SidebarNav idPrefix="side" />
          </div>
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

        <main className="app-main flex-grow-1 min-w-0 overflow-auto">
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
