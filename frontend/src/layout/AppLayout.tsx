import { Link, Outlet, useNavigate } from 'react-router-dom'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/apiClient'
import { Button, Offcanvas } from 'react-bootstrap'
import { SidebarNav } from './SidebarNav'

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
          <div className="app-sidebar__inner flex-grow-1 pt-3">
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
