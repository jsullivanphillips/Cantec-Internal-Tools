import { useState } from 'react'
import { Alert, Form, Table } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import { annualMonthHint, stopAnnualDueThisMonth } from './annualMonthHint'
import { monitoringCompanyDisplayName } from './MonitoringCompanySelect'
import {
  PrepCompactField,
  PrepCompanyField,
  PrepLongTextCell,
} from './RunDetailsPrepareFields'
import RunDetailsDeficiencyList from './RunDetailsDeficiencyList'
import { openDeficiencySummaries } from './runDetailsDeficiencyDisplay'
import type { RunDetailPrepRow } from './runDetailsLocationReview'
import type { RunDetailsStopPatchApi } from './useRunDetailsStopPatch'
import { useMonitoringCompanies } from './useMonitoringCompanies'

export default function RunDetailsPrepareTable({
  rows,
  routeId,
  monthDate,
  stopPatch,
  onDeficiencyUpdated,
}: {
  rows: RunDetailPrepRow[]
  routeId: number
  monthDate: string
  stopPatch: RunDetailsStopPatchApi
  onDeficiencyUpdated?: () => void | Promise<void>
}) {
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null)
  const { patchStop, error, isFieldSaving } = stopPatch
  const { companies, loading: companiesLoading, refresh, appendCompany } = useMonitoringCompanies()

  const fieldKey = (testingSiteId: number, suffix: string) => `${testingSiteId}-${suffix}`

  if (rows.length === 0) {
    return <p className="monthly-run-detail-empty mb-0">No stops on this route yet.</p>
  }

  return (
    <div className="run-details-prepare-table-shell">
      {error ? (
        <Alert variant="danger" className="py-2 small mb-2">
          {error}
        </Alert>
      ) : null}
      <Table size="sm" className="run-details-prepare-table mb-0">
        <colgroup>
          <col className="run-details-prepare-col-stop" />
          <col className="run-details-prepare-col-highlight" />
          <col className="run-details-prepare-col-address" />
          <col className="run-details-prepare-col-access" />
          <col className="run-details-prepare-col-monitoring" />
          <col className="run-details-prepare-col-deficiencies" />
          <col className="run-details-prepare-col-run-comments" />
          <col className="run-details-prepare-col-procedures" />
          <col className="run-details-prepare-col-location-comments" />
        </colgroup>
        <thead>
          <tr>
            <th className="run-details-prepare-sticky-order">#</th>
            <th className="run-details-prepare-col-highlight">Highlight</th>
            <th className="run-details-prepare-sticky-address">Address</th>
            <th>Access</th>
            <th>Monitoring</th>
            <th>Deficiencies</th>
            <th>Job comments</th>
            <th>Testing procedures</th>
            <th>Location comments</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ stop, locationLabel, siteCount }) => {
            const sid = stop.testing_site_id
            const siteLabel = (stop.label || '').trim() || 'Primary testing location'
            const companyId = stop.monitoring_company_id ?? null
            const companyName =
              stop.monitoring_company_record?.name?.trim() ||
              stop.monitoring_company?.trim() ||
              monitoringCompanyDisplayName(companyId, companies, stop.monitoring_company)
            const openDeficiencies = openDeficiencySummaries(stop.deficiency_summaries)
            const multiSite = siteCount > 1
            const annualDue = stopAnnualDueThisMonth(stop, locationLabel, monthDate)

            const fk = (suffix: string) => fieldKey(sid, suffix)

            const attention = Boolean(stop.office_attention)

            return (
              <tr
                key={sid}
                className={[
                  annualDue ? 'run-details-prepare-row--annual' : '',
                  attention ? 'run-details-prepare-row--attention' : '',
                ]
                  .filter(Boolean)
                  .join(' ') || undefined}
              >
                <td className="run-details-prepare-sticky-order tabular-nums align-top">
                  <span className="run-details-prepare-stop-num">{stop.stop_number}</span>
                </td>
                <td className="align-top text-center run-details-prepare-col-highlight">
                  <Form.Check
                    type="checkbox"
                    aria-label={`Highlight stop ${stop.stop_number} for technicians`}
                    checked={attention}
                    disabled={isFieldSaving(sid, fk('highlight'))}
                    onChange={(e) =>
                      void patchStop(
                        sid,
                        fk('highlight'),
                        { office_attention: e.target.checked },
                        { office_attention: !e.target.checked },
                      )
                    }
                  />
                </td>
                <td className="run-details-prepare-sticky-address align-top">
                  <Link
                    to={`/monthlies/locations/${stop.location_id}`}
                    className="run-details-prepare-address-link"
                  >
                    {locationLabel}
                  </Link>
                  {multiSite ? (
                    <div
                      className={`run-details-prepare-site-label text-muted small${multiSite ? ' run-details-prepare-site-label--multi' : ''}`}
                    >
                      {siteLabel}
                    </div>
                  ) : null}
                </td>
                <td className="align-top run-details-prepare-stack-cell">
                  <div className="run-details-prepare-stack">
                    <PrepCompactField
                      fieldKey={fk('ring')}
                      label="Ring"
                      value={stop.ring || ''}
                      saving={isFieldSaving(sid, fk('ring'))}
                      activeKey={activeFieldKey}
                      onActivate={setActiveFieldKey}
                      onCommit={(next) =>
                        void patchStop(sid, fk('ring'), { ring: next.trim() || null }, { ring: stop.ring })
                      }
                    />
                    <PrepCompactField
                      fieldKey={fk('key')}
                      label="Key"
                      value={stop.key_number || ''}
                      saving={isFieldSaving(sid, fk('key'))}
                      activeKey={activeFieldKey}
                      onActivate={setActiveFieldKey}
                      onCommit={(next) =>
                        void patchStop(
                          sid,
                          fk('key'),
                          { key_number: next.trim() || null },
                          { key_number: stop.key_number },
                        )
                      }
                    />
                    <PrepCompactField
                      fieldKey={fk('door')}
                      label="Door"
                      value={stop.door_code || ''}
                      saving={isFieldSaving(sid, fk('door'))}
                      activeKey={activeFieldKey}
                      onActivate={setActiveFieldKey}
                      onCommit={(next) =>
                        void patchStop(
                          sid,
                          fk('door'),
                          { door_code: next.trim() || null },
                          { door_code: stop.door_code },
                        )
                      }
                    />
                    <PrepCompactField
                      fieldKey={fk('annual')}
                      label="Annual month"
                      value={stop.annual_month || ''}
                      saving={isFieldSaving(sid, fk('annual'))}
                      activeKey={activeFieldKey}
                      onActivate={setActiveFieldKey}
                      hint={annualMonthHint(stop, locationLabel, monthDate) ?? undefined}
                      onCommit={(next) =>
                        void patchStop(
                          sid,
                          fk('annual'),
                          { annual_month: next.trim() || null },
                          { annual_month: stop.annual_month },
                        )
                      }
                    />
                  </div>
                </td>
                <td className="align-top run-details-prepare-stack-cell">
                  <div className="run-details-prepare-stack">
                    <PrepCompanyField
                      fieldKey={fk('company')}
                      label="Company"
                      companyId={companyId}
                      companyName={companyName}
                      companies={companies}
                      companiesLoading={companiesLoading}
                      saving={isFieldSaving(sid, fk('company'))}
                      activeKey={activeFieldKey}
                      onActivate={setActiveFieldKey}
                      onCommit={(nextId) =>
                        void patchStop(
                          sid,
                          fk('company'),
                          { monitoring_company_id: nextId },
                          {
                            monitoring_company_id: stop.monitoring_company_id,
                            monitoring_company: stop.monitoring_company,
                            monitoring_company_record: stop.monitoring_company_record,
                          },
                        )
                      }
                      onCompanyCreated={(company) => {
                        appendCompany(company)
                        void refresh()
                      }}
                    />
                    <PrepCompactField
                      fieldKey={fk('account')}
                      label="Account #"
                      value={stop.monitoring_account_number || ''}
                      saving={isFieldSaving(sid, fk('account'))}
                      activeKey={activeFieldKey}
                      onActivate={setActiveFieldKey}
                      onCommit={(next) =>
                        void patchStop(
                          sid,
                          fk('account'),
                          { monitoring_account_number: next.trim() || null },
                          { monitoring_account_number: stop.monitoring_account_number },
                        )
                      }
                    />
                    <PrepCompactField
                      fieldKey={fk('mon-notes')}
                      label="Notes"
                      value={stop.monitoring_notes || ''}
                      saving={isFieldSaving(sid, fk('mon-notes'))}
                      activeKey={activeFieldKey}
                      onActivate={setActiveFieldKey}
                      multiline
                      onCommit={(next) =>
                        void patchStop(
                          sid,
                          fk('mon-notes'),
                          { monitoring_notes: next.trim() || null },
                          { monitoring_notes: stop.monitoring_notes },
                        )
                      }
                    />
                  </div>
                </td>
                <td className="align-top run-details-prepare-deficiency-cell">
                  <RunDetailsDeficiencyList
                    deficiencies={openDeficiencies}
                    routeId={routeId}
                    monthDate={monthDate}
                    testingSiteId={sid}
                    compact
                    onDeficiencyUpdated={onDeficiencyUpdated}
                    modalContext={{
                      locationLabel,
                      stopNumber: stop.stop_number,
                      siteLabel: multiSite ? siteLabel : undefined,
                    }}
                  />
                </td>
                <td className="align-top run-details-prepare-longtext-cell">
                  <PrepLongTextCell
                    fieldKey={fk('run-comments')}
                    value={stop.run_comments || ''}
                    saving={isFieldSaving(sid, fk('run-comments'))}
                    activeKey={activeFieldKey}
                    onActivate={setActiveFieldKey}
                    onCommit={(next) =>
                      void patchStop(
                        sid,
                        fk('run-comments'),
                        { run_comments: next },
                        { run_comments: stop.run_comments },
                      )
                    }
                  />
                </td>
                <td className="align-top run-details-prepare-longtext-cell">
                  <PrepLongTextCell
                    fieldKey={fk('procedures')}
                    value={stop.testing_procedures || ''}
                    saving={isFieldSaving(sid, fk('procedures'))}
                    activeKey={activeFieldKey}
                    onActivate={setActiveFieldKey}
                    onCommit={(next) =>
                      void patchStop(
                        sid,
                        fk('procedures'),
                        { testing_procedures: next },
                        { testing_procedures: stop.testing_procedures },
                      )
                    }
                  />
                </td>
                <td className="align-top run-details-prepare-longtext-cell">
                  <PrepLongTextCell
                    fieldKey={fk('loc-notes')}
                    value={stop.inspection_tech_notes || ''}
                    saving={isFieldSaving(sid, fk('loc-notes'))}
                    activeKey={activeFieldKey}
                    onActivate={setActiveFieldKey}
                    onCommit={(next) =>
                      void patchStop(
                        sid,
                        fk('loc-notes'),
                        { inspection_tech_notes: next },
                        { inspection_tech_notes: stop.inspection_tech_notes },
                      )
                    }
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </div>
  )
}
