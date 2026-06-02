import { useCallback, useState } from 'react'
import { Alert, Button, Form, Spinner } from 'react-bootstrap'
import type { MonthlyRunDetailLocation } from './monthlyRoutesShared'
import { annualMonthHint } from './annualMonthHint'
import { patchRunDetailsStop } from './patchRunDetailsStop'

export default function RunDetailsLocationPrepPanel({
  location,
  routeId,
  monthDate,
  onSaved,
}: {
  location: MonthlyRunDetailLocation
  routeId: number
  monthDate: string
  onSaved: () => Promise<void>
}) {
  const [busySiteId, setBusySiteId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const patchStop = useCallback(
    async (testingSiteId: number, changes: Record<string, string | null>) => {
      setBusySiteId(testingSiteId)
      setError(null)
      try {
        await patchRunDetailsStop(routeId, monthDate, testingSiteId, changes)
        await onSaved()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save.')
      } finally {
        setBusySiteId(null)
      }
    },
    [routeId, monthDate, onSaved],
  )

  return (
    <div className="run-location-card__prep" aria-label="Prepare for next month">
      <div className="run-location-card__prep-title">Prepare for next month</div>
      {error ? (
        <Alert variant="danger" className="py-2 small mb-2">
          {error}
        </Alert>
      ) : null}
      {location.stops.map((stop) => {
        const busy = busySiteId === stop.testing_site_id
        const runComment = (stop.run_comments || '').trim()
        const annualHintText = annualMonthHint(stop, location.location_label, monthDate)
        return (
          <div key={stop.testing_site_id} className="run-location-card__prep-stop">
            {location.stops.length > 1 ? (
              <div className="run-location-card__prep-stop-label text-muted small">
                {(stop.label || '').trim() || `Stop ${stop.stop_number}`}
              </div>
            ) : null}
            <div className="run-location-card__prep-row">
              <span className="run-location-card__prep-key">Annual month</span>
              {annualHintText ? (
                <span className="run-location-card__prep-hint small text-muted">
                  {annualHintText}
                </span>
              ) : null}
              <Form.Control
                size="sm"
                className="run-location-card__prep-input"
                defaultValue={stop.annual_month || ''}
                disabled={busy}
                onBlur={(e) => {
                  const next = e.target.value.trim()
                  const prev = (stop.annual_month || '').trim()
                  if (next !== prev) {
                    void patchStop(stop.testing_site_id, { annual_month: next || null })
                  }
                }}
              />
            </div>
            <div className="run-location-card__prep-row">
              <span className="run-location-card__prep-key">Testing procedures</span>
              <Form.Control
                as="textarea"
                rows={2}
                size="sm"
                className="run-location-card__prep-input"
                defaultValue={stop.testing_procedures || ''}
                disabled={busy}
                onBlur={(e) => {
                  const next = e.target.value
                  if (next !== (stop.testing_procedures || '')) {
                    void patchStop(stop.testing_site_id, { testing_procedures: next })
                  }
                }}
              />
            </div>
            <div className="run-location-card__prep-row">
              <span className="run-location-card__prep-key">Location comments</span>
              <Form.Control
                as="textarea"
                rows={2}
                size="sm"
                className="run-location-card__prep-input"
                defaultValue={stop.inspection_tech_notes || ''}
                disabled={busy}
                onBlur={(e) => {
                  const next = e.target.value
                  if (next !== (stop.inspection_tech_notes || '')) {
                    void patchStop(stop.testing_site_id, { inspection_tech_notes: next })
                  }
                }}
              />
            </div>
            {runComment ? (
              <div className="run-location-card__prep-row run-location-card__prep-row--job-comment">
                <div>
                  <span className="run-location-card__prep-key">Job comment</span>
                  <p className="small text-muted mb-1">This month only — clear before the next run.</p>
                  <p className="run-location-card__prep-job-text mb-0">{runComment}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline-secondary"
                  disabled={busy}
                  onClick={() => void patchStop(stop.testing_site_id, { run_comments: '' })}
                >
                  {busy ? <Spinner animation="border" size="sm" aria-hidden /> : 'Clear job comment'}
                </Button>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
