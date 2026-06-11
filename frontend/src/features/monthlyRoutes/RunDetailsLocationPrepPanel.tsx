import { Alert, Button, Form, Spinner } from 'react-bootstrap'
import type { MonthlyRunDetailLocation } from './monthlyRoutesShared'
import { annualMonthDropdownOptions, normalizeAnnualMonthForSelect } from './monthlyRoutesShared'
import { annualMonthHint } from './annualMonthHint'
import { rollbackPatchForChanges } from './runDetailsPrepPatch'
import type { RunDetailsStopPatchApi } from './useRunDetailsStopPatch'

export default function RunDetailsLocationPrepPanel({
  location,
  monthDate,
  stopPatch,
}: {
  location: MonthlyRunDetailLocation
  monthDate: string
  stopPatch: RunDetailsStopPatchApi
}) {
  const { patchStop, isFieldSaving, error } = stopPatch

  return (
    <div className="run-location-card__prep" aria-label="Prepare for next month">
      <div className="run-location-card__prep-title">Prepare for next month</div>
      {error ? (
        <Alert variant="danger" className="py-2 small mb-2">
          {error}
        </Alert>
      ) : null}
      {(() => { const stop = location;
        const runComment = (stop.run_comments || '').trim()
        const annualHintText = annualMonthHint(stop, location.location_label, monthDate)
        const sid = stop.location_id
        const annualBusy = isFieldSaving(sid, `prep-${sid}-annual`)
        const annualSelectValue = normalizeAnnualMonthForSelect(stop.annual_month) || ''
        const proceduresBusy = isFieldSaving(sid, `prep-${sid}-procedures`)
        const locNotesBusy = isFieldSaving(sid, `prep-${sid}-loc-notes`)
        const runCommentsBusy = isFieldSaving(sid, `prep-${sid}-run-comments`)
        return (
          <div key={sid} className="run-location-card__prep-stop">
            {false ? (
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
              <Form.Select
                size="sm"
                className="run-location-card__prep-input"
                value={annualSelectValue}
                disabled={annualBusy}
                onChange={(e) => {
                  const next = e.target.value.trim()
                  const prev = normalizeAnnualMonthForSelect(stop.annual_month) || ''
                  if (next === prev) return
                  void patchStop(
                    sid,
                    `prep-${sid}-annual`,
                    { annual_month: next || null },
                    rollbackPatchForChanges(stop, { annual_month: next || null }),
                  )
                }}
              >
                {annualMonthDropdownOptions(stop.annual_month).map((opt) => (
                  <option key={opt.value || '__empty'} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Form.Select>
            </div>
            <div className="run-location-card__prep-row">
              <span className="run-location-card__prep-key">Testing procedures</span>
              <Form.Control
                as="textarea"
                rows={2}
                size="sm"
                className="run-location-card__prep-input"
                defaultValue={stop.testing_procedures || ''}
                disabled={proceduresBusy}
                onBlur={(e) => {
                  const next = e.target.value
                  if (next !== (stop.testing_procedures || '')) {
                    void patchStop(
                      sid,
                      `prep-${sid}-procedures`,
                      { testing_procedures: next },
                      rollbackPatchForChanges(stop, { testing_procedures: next }),
                    )
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
                disabled={locNotesBusy}
                onBlur={(e) => {
                  const next = e.target.value
                  if (next !== (stop.inspection_tech_notes || '')) {
                    void patchStop(
                      sid,
                      `prep-${sid}-loc-notes`,
                      { inspection_tech_notes: next },
                      rollbackPatchForChanges(stop, { inspection_tech_notes: next }),
                    )
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
                  disabled={runCommentsBusy}
                  onClick={() =>
                    void patchStop(
                      sid,
                      `prep-${sid}-run-comments`,
                      { run_comments: '' },
                      rollbackPatchForChanges(stop, { run_comments: '' }),
                    )
                  }
                >
                  {runCommentsBusy ? (
                    <Spinner animation="border" size="sm" aria-hidden />
                  ) : (
                    'Clear job comment'
                  )}
                </Button>
              </div>
            ) : null}
          </div>
        )
      })()}
    </div>
  )
}
