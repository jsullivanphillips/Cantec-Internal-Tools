import { useMemo, useState } from 'react'
import { Button, Card } from 'react-bootstrap'
import { Link, isRouteErrorResponse, useLocation, useRouteError } from 'react-router-dom'

type ErrorCopy = {
  eyebrow: string
  title: string
  message: string
  statusLabel?: string
}

const DYNAMIC_IMPORT_ERROR_TEXT = [
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'importing a module script failed',
  'chunkloaderror',
  'loading chunk',
  'failed to fetch',
]

function stringifyUnknown(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function errorDetails(error: unknown): string {
  if (isRouteErrorResponse(error)) {
    return [
      `Status: ${error.status}`,
      error.statusText ? `Status text: ${error.statusText}` : '',
      stringifyUnknown(error.data),
    ]
      .filter(Boolean)
      .join('\n')
  }

  if (error instanceof Error) {
    return [error.name, error.message, error.stack].filter(Boolean).join('\n')
  }

  return stringifyUnknown(error)
}

function isDynamicImportError(error: unknown): boolean {
  const details = errorDetails(error).toLowerCase()
  return DYNAMIC_IMPORT_ERROR_TEXT.some((text) => details.includes(text))
}

function routeErrorCopy(error: unknown): ErrorCopy {
  if (isDynamicImportError(error)) {
    return {
      eyebrow: 'Page failed to load',
      title: 'Schedule Assist could not load this page',
      message:
        'This usually happens when the app was updated while your browser was open, or when the connection to Schedule Assist is temporarily unavailable. Reload the page once the site is back online.',
    }
  }

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      return {
        eyebrow: 'Page not found',
        title: 'We could not find that page',
        message:
          'The link may be outdated or the page may have moved. Use Home to get back to Schedule Assist.',
        statusLabel: '404',
      }
    }

    return {
      eyebrow: 'Request failed',
      title: 'Schedule Assist could not finish loading',
      message:
        error.statusText || 'A request for this page failed. Reload the page or sign in again if your session expired.',
      statusLabel: String(error.status),
    }
  }

  return {
    eyebrow: 'Unexpected error',
    title: 'Something went wrong',
    message:
      'Schedule Assist hit an unexpected problem while opening this page. Reload the page to try again.',
  }
}

export default function AppRouteErrorPage() {
  const error = useRouteError()
  const location = useLocation()
  const [logoFailed, setLogoFailed] = useState(false)
  const copy = useMemo(() => routeErrorCopy(error), [error])
  const details = useMemo(() => errorDetails(error), [error])
  const showSignIn = !location.pathname.startsWith('/login')

  return (
    <div className="app-shell app-canvas d-flex flex-column min-vh-100">
      <header className="app-topbar d-flex align-items-center justify-content-between px-3 px-lg-4 border-bottom bg-white">
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
      </header>

      <main className="app-route-error d-flex flex-grow-1 align-items-center justify-content-center p-3 p-md-4">
        <Card className="app-surface-card app-route-error__card">
          <Card.Body className="p-4 p-md-5">
            <div className="d-flex flex-column flex-md-row gap-3 gap-md-4">
              <div className="app-route-error__icon d-flex align-items-center justify-content-center flex-shrink-0">
                <i className="bi bi-cloud-slash" aria-hidden />
              </div>
              <div className="min-w-0">
                <div className="text-uppercase text-muted fw-semibold small mb-2">
                  {copy.statusLabel ? `${copy.eyebrow} · ${copy.statusLabel}` : copy.eyebrow}
                </div>
                <h1 className="processing-page-title mb-3">{copy.title}</h1>
                <p className="text-muted mb-4">{copy.message}</p>

                <div className="d-flex flex-column flex-sm-row gap-2 mb-4">
                  <Button type="button" onClick={() => window.location.reload()}>
                    Reload page
                  </Button>
                  <Link to="/home" className="btn btn-outline-primary">
                    Go to Home
                  </Link>
                  {showSignIn ? (
                    <Link to="/login" className="btn btn-outline-secondary">
                      Sign in
                    </Link>
                  ) : null}
                </div>

                {details ? (
                  <details className="app-route-error__details">
                    <summary className="text-muted small">Technical details</summary>
                    <pre className="mt-2 mb-0 small">{details}</pre>
                  </details>
                ) : null}
              </div>
            </div>
          </Card.Body>
        </Card>
      </main>
    </div>
  )
}
