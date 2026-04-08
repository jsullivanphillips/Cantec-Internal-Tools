import { Link, Outlet } from 'react-router-dom'
import { Suspense, useState } from 'react'

/** Keys search / sign-out flow for technicians — no staff login required. */
export default function KeysPublicLayout() {
  const [logoFailed, setLogoFailed] = useState(false)

  return (
    <div className="app-shell d-flex flex-column min-vh-100 app-canvas">
      <header className="app-topbar d-flex align-items-center justify-content-between px-3 px-lg-4 border-bottom bg-white">
        <div className="d-flex align-items-center gap-3 min-w-0">
          <Link to="/keys" className="d-flex align-items-center text-decoration-none min-w-0">
            {!logoFailed ? (
              <img
                src="/cantec-logo-horizontal.png"
                alt="Cantec"
                className="app-topbar-logo"
                onError={() => setLogoFailed(true)}
              />
            ) : (
              <span className="fw-semibold text-primary text-truncate">Keys</span>
            )}
          </Link>
        </div>
        <Link to="/login" className="btn btn-outline-secondary btn-sm">
          Staff sign in
        </Link>
      </header>

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
  )
}
