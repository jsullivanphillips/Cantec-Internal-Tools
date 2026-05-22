import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { Button } from 'react-bootstrap'
import { apiFetch, apiJson } from '../lib/apiClient'

type PortalMeResponse = {
  unlocked: boolean
  configured: boolean
}

const LOCK_PATH = '/tech'

/**
 * Public, PIN-gated shell for the technician portal at `/tech/*`.
 * Mirrors the basic chrome of `KeysPublicLayout` but without the staff sidebar.
 * Children pages handle the actual PIN form and route picker; the layout just
 * gates non-lock paths and exposes a "Lock" button when the session is unlocked.
 */
export default function TechnicianPortalLayout() {
  const nav = useNavigate()
  const location = useLocation()
  const [logoFailed, setLogoFailed] = useState(false)
  const [unlocked, setUnlocked] = useState<boolean | null>(null)

  const isLockScreen = location.pathname === LOCK_PATH || location.pathname === `${LOCK_PATH}/`
  const isWorksheetScreen = location.pathname.includes('/worksheet/')

  const refreshLock = useCallback(async () => {
    try {
      const me = await apiJson<PortalMeResponse>('/api/technician_portal/me')
      setUnlocked(!!me.unlocked)
    } catch {
      setUnlocked(false)
    }
  }, [])

  useEffect(() => {
    void refreshLock()
  }, [refreshLock, location.pathname])

  useEffect(() => {
    if (unlocked === false && !isLockScreen) {
      nav(LOCK_PATH, { replace: true })
    }
  }, [unlocked, isLockScreen, nav])

  const lock = useCallback(async () => {
    try {
      await apiFetch('/api/technician_portal/logout', { method: 'POST' })
    } catch {
      /* ignore – we still navigate to lock screen */
    }
    setUnlocked(false)
    nav(LOCK_PATH, { replace: true })
  }, [nav])

  return (
    <div className="app-shell d-flex flex-column min-vh-100 app-canvas">
      <header className="app-topbar d-flex align-items-center justify-content-between px-3 px-lg-4 border-bottom bg-white">
        <div className="d-flex align-items-center gap-3 min-w-0">
          {!logoFailed ? (
            <img
              src="/cantec-logo-horizontal.png"
              alt="Cantec"
              className="app-topbar-logo"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <span className="fw-semibold text-primary text-truncate">Technician Portal</span>
          )}
          <span className="text-muted small d-none d-sm-inline">Technician Portal</span>
        </div>
        {unlocked && !isLockScreen ? (
          <Button variant="outline-secondary" size="sm" type="button" onClick={lock}>
            Lock
          </Button>
        ) : null}
      </header>

      <main
        className={`app-main flex-grow-1 min-w-0${isWorksheetScreen ? ' app-main--flush app-main--portal-worksheet' : ' overflow-auto'}`}
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
          {unlocked === null && !isLockScreen ? (
            <div className="d-flex justify-content-center align-items-center py-5">
              <div className="spinner-border text-primary" role="status">
                <span className="visually-hidden">Checking session…</span>
              </div>
            </div>
          ) : (
            <Outlet />
          )}
        </Suspense>
      </main>
    </div>
  )
}
