import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button, Card } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import { formatRouteErrorTechnicalDetails, RENDER_ERROR_DETAILS_KEY } from './routeErrorTechnicalDetails'

type Props = { children: ReactNode }
type State = { error: Error | null; componentStack: string | null }

export default class AppRenderErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const componentStack = info.componentStack?.trim() || null
    this.setState({ componentStack })
    try {
      sessionStorage.setItem(
        RENDER_ERROR_DETAILS_KEY,
        JSON.stringify({
          componentStack,
          pathname: window.location.pathname,
          at: new Date().toISOString(),
        }),
      )
    } catch {
      // Ignore quota / private mode.
    }
    console.error('Render error in page content', error, info.componentStack)
  }

  private reload = () => {
    try {
      sessionStorage.removeItem(RENDER_ERROR_DETAILS_KEY)
    } catch {
      /* ignore */
    }
    window.location.reload()
  }

  render() {
    const { error, componentStack } = this.state
    if (!error) return this.props.children

    const details = formatRouteErrorTechnicalDetails(error, {
      pathname: window.location.pathname,
      componentStack,
    })

    return (
      <div className="app-route-error d-flex align-items-center justify-content-center p-3 p-md-4">
        <Card className="app-surface-card app-route-error__card">
          <Card.Body className="p-4 p-md-5">
            <div className="text-uppercase text-muted fw-semibold small mb-2">Render error</div>
            <h1 className="processing-page-title mb-3">This page could not be displayed</h1>
            <p className="text-muted mb-4">
              Schedule Assist hit a problem while rendering page content. Reload the page to try again.
            </p>
            <div className="d-flex flex-column flex-sm-row gap-2 mb-4">
              <Button type="button" onClick={this.reload}>
                Reload page
              </Button>
              <Link to="/monday_meeting" className="btn btn-outline-primary">
                Monday Meeting
              </Link>
            </div>
            {details ? (
              <details className="app-route-error__details" open>
                <summary className="text-muted small">Technical details</summary>
                <pre className="mt-2 mb-0 small">{details}</pre>
              </details>
            ) : null}
          </Card.Body>
        </Card>
      </div>
    )
  }
}
