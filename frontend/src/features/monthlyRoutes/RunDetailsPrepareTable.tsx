import { useCallback, useState } from 'react'
import { Alert, Table } from 'react-bootstrap'
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
import { patchRunDetailsStop } from './patchRunDetailsStop'
import type { RunDetailPrepRow } from './runDetailsLocationReview'
import { useMonitoringCompanies } from './useMonitoringCompanies'

type SavingState = { siteId: number; fieldKey: string } | null

export default function RunDetailsPrepareTable({
  rows,
  routeId,
  monthDate,
  onSaved,
  onDeficiencyUpdated,
}: {
  rows: RunDetailPrepRow[]
  routeId: number
  monthDate: string
  onSaved: () => Promise<void>
  onDeficiencyUpdated?: () => void | Promise<void>
}) {
  const [saving, setSaving] = useState<SavingState>(null)
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { companies, loading: companiesLoading, refresh, appendCompany } = useMonitoringCompanies()

  const patchStop = useCallback(
    async (testingSiteId: number, fieldKey: string, changes: Record<string, string | number | null>) => {
      setSaving({ siteId: testingSiteId, fieldKey })
      setError(null)
      try {
        await patchRunDetailsStop(routeId, monthDate, testingSiteId, changes)
        await onSaved()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save.')
      } finally {
        setSaving(null)
      }
    },
    [routeId, monthDate, onSaved],
  )

  const fieldKey = (testingSiteId: number, suffix: string) => `${testingSiteId}-${suffix}`

  const isRowSaving = (siteId: number) => saving?.siteId === siteId
  const isFieldSaving = (siteId: number, key: string) =>
    saving?.siteId === siteId && saving?.fieldKey === key

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
            const rowBusy = isRowSaving(sid)
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

            return (
              <tr
                key={sid}
                className={annualDue ? 'run-details-prepare-row--annual' : undefined}
              >
                <td className="run-details-prepare-sticky-order tabular-nums align-top">
                  <span className="run-details-prepare-stop-num">{stop.stop_number}</span>
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
                      disabled={rowBusy}
                      saving={isFieldSaving(sid, fk('ring'))}
                      activeKey={activeFieldKey}
                      onActivate={setActiveFieldKey}
                      onCommit={(next) => void patchStop(sid, fk('ring'), { ring: next.trim() || null })}
                    />
                    <PrepCompactField
                      fieldKey={fk('key')}
                      label="Key #"
                      value={stop.key_number || ''}
                      disabled={rowBusy}
                      saving={isFieldSaving(sid, fk('key'))}
                      activeKey={activeFieldKey}
                      onActivate={setActiveFieldKey}
                      onCommit={(next) =>
                        void patchStop(sid, fk('key'), { key_number: next.trim() || null })
                      }
                    />
                    <PrepCompactField
                      fieldKey={fk('door-code')}
                      label="Door code"
                      value={stop.door_code || ''}
                      disabled={rowBusy}
                      saving={isFieldSaving(sid, fk('door-code'))}
                      activeKey={activeFieldKey}
                      onActivate={setActiveFieldKey}
                      onCommit={(next) =>
                        void patchStop(sid, fk('door-code'), { door_code: next.trim() || null })
                      }
                    />
                    <PrepCompactField
                      fieldKey={fk('annual')}
                      label="Annual month"
                      value={stop.annual_month || ''}
                      hint={annualMonthHint(stop, locationLabel, monthDate)}
                      disabled={rowBusy}
                      saving={isFieldSaving(sid, fk('annual'))}
                      activeKey={activeFieldKey}
                      onActivate={setActiveFieldKey}
                      onCommit={(next) =>
                        void patchStop(sid, fk('annual'), { annual_month: next.trim() || null })
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
                      disabled={rowBusy}
                      saving={isFieldSaving(sid, fk('company'))}
                      activeKey={activeFieldKey}
                      onActivate={setActiveFieldKey}
                      onCommit={(nextId) => void patchStop(sid, fk('company'), { monitoring_company_id: nextId })}
                      onCompanyCreated={(company) => {
                        appendCompany(company)
                        void refresh()
                      }}
                    />
                    <PrepCompactField
                      fieldKey={fk('account')}
                      label="Account #"
                      value={stop.monitoring_account_number || ''}
                      disabled={rowBusy}
                      saving={isFieldSaving(sid, fk('account'))}
                      activeKey={activeFieldKey}
                      onActivate={setActiveFieldKey}
                      onCommit={(next) =>
                        void patchStop(sid, fk('account'), {
                          monitoring_account_number: next.trim() || null,
                        })
                      }
                    />
                    <PrepCompactField
                      fieldKey={fk('mon-notes')}
                      label="Notes"
                      value={stop.monitoring_notes || ''}
                      disabled={rowBusy}
                      saving={isFieldSaving(sid, fk('mon-notes'))}
                      activeKey={activeFieldKey}
                      onActivate={setActiveFieldKey}
                      multiline
                      onCommit={(next) =>
                        void patchStop(sid, fk('mon-notes'), { monitoring_notes: next.trim() || null })
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
                    disabled={rowBusy}
                    saving={isFieldSaving(sid, fk('run-comments'))}
                    activeKey={activeFieldKey}
                    onActivate={setActiveFieldKey}
                    onCommit={(next) => void patchStop(sid, fk('run-comments'), { run_comments: next })}
                  />
                </td>
                <td className="align-top run-details-prepare-longtext-cell">
                  <PrepLongTextCell
                    fieldKey={fk('procedures')}
                    value={stop.testing_procedures || ''}
                    disabled={rowBusy}
                    saving={isFieldSaving(sid, fk('procedures'))}
                    activeKey={activeFieldKey}
                    onActivate={setActiveFieldKey}
                    onCommit={(next) =>
                      void patchStop(sid, fk('procedures'), { testing_procedures: next })
                    }
                  />
                </td>
                <td className="align-top run-details-prepare-longtext-cell">
                  <PrepLongTextCell
                    fieldKey={fk('loc-notes')}
                    value={stop.inspection_tech_notes || ''}
                    disabled={rowBusy}
                    saving={isFieldSaving(sid, fk('loc-notes'))}
                    activeKey={activeFieldKey}
                    onActivate={setActiveFieldKey}
                    onCommit={(next) =>
                      void patchStop(sid, fk('loc-notes'), { inspection_tech_notes: next })
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
