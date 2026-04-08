import { Link, Outlet, useNavigate } from 'react-router-dom'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/apiClient'
import { Button, Offcanvas } from 'react-bootstrap'
import { SidebarNav } from './SidebarNav'

/**
 * Keys search / sign-out for technicians — no staff login required to view /keys.
 * Same shell as AppLayout (sidebar, logo → home) so navigation is consistent; protected
 * routes still mount AppLayout and redirect to /login when unauthenticated.
 */
export default function KeysPublicLayout() {
  const nav = useNavigate()
  const [logoFailed, setLogoFailed] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)

  const refreshAuth = useCallback(async () => {
    try {
      const r = await apiFetch('/api/auth/me')
      const d = await r.json()
      setAuthenticated(!!d.authenticated)
    } catch {
      setAuthenticated(false)
    }
  }, [])

  useEffect(() => {
    void refreshAuth()
  }, [refreshAuth])

  const logout = async () => {
    setShowMenu(false)
    await apiFetch('/api/auth/logout', { method: 'POST' })
    setAuthenticated(false)
    nav('/login', { replace: true })
  }

  return (
    <div className="app-shell d-flex flex-column min-vh-100 app-canvas">
      <header className="app-topbar d-flex align-items-center justify-content-between px-3 px-lg-4 border-bottom bg-white">
        <div className="d-flex align-items-center gap-3 min-w-0">
          <Button
            variant="light"
            className="d-lg-none border"
            type="button"
            aria-controls="keys-public-sidebar-offcanvas"
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
        {authenticated ? (
          <Button variant="outline-secondary" size="sm" type="button" onClick={logout}>
            Log out
          </Button>
        ) : (
          <Link to="/login" className="btn btn-outline-secondary btn-sm">
            Staff sign in
          </Link>
        )}
      </header>

      <div className="app-body d-flex flex-grow-1">
        <aside className="app-sidebar d-none d-lg-flex flex-column border-end bg-white">
          <div className="flex-grow-1 overflow-auto pt-3">
            <SidebarNav idPrefix="keys-public-side" />
          </div>
        </aside>

        <Offcanvas
          show={showMenu}
          onHide={() => setShowMenu(false)}
          placement="start"
          id="keys-public-sidebar-offcanvas"
          className="d-lg-none"
        >
          <Offcanvas.Header closeButton>
            <Offcanvas.Title>Menu</Offcanvas.Title>
          </Offcanvas.Header>
          <Offcanvas.Body className="p-0">
            <SidebarNav idPrefix="keys-public-drawer" onNavigate={() => setShowMenu(false)} />
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
