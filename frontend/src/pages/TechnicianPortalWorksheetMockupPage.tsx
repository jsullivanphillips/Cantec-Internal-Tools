/**
 * Temporary interactive mockup for the portal worksheet redesign (fake data only).
 * Route: /tech/worksheet-mockup
 */
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Modal } from 'react-bootstrap'
import { WORKSHEET_CLOCK_IN_BLOCKED_MESSAGE } from '../features/monthlyRoutes/monthlyRoutesShared'

type StopStatus = 'pending' | 'in_progress' | 'tested' | 'skipped'

type MockStop = {
  id: number
  stopNumber: number
  displayAddress: string
  buildingName: string | null
  propertyManagementCompany: string | null
  panelLabel: string | null
  ring: string
  key: string
  annualMonth: string | null
  doorCode: string | null
  panel: string
  panelLocation: string
  monitoringCompany: string
  monitoringNotes: string | null
  testingProcedures: string
  inspectionTechNotes: string
  timeIn: string | null
  timeOut: string | null
  resultStatus: StopStatus
  skipReason: string | null
  isAnnualMonth: boolean
}

const INITIAL_STOPS: MockStop[] = [
  {
    id: 1,
    stopNumber: 11,
    displayAddress: '1045 Pandora Ave',
    buildingName: 'Parkade Level P2',
    propertyManagementCompany: 'Coast Property Mgmt',
    panelLabel: 'FACP — East stair',
    ring: 'R-12',
    key: 'KEY-4421',
    annualMonth: null,
    doorCode: '4821#',
    panel: 'Simplex 4100ES',
    panelLocation: 'Electrical room, P2 east',
    monitoringCompany: 'Paladin Security',
    monitoringNotes: 'Acct #88421 · Signals: Fire, Trouble',
    testingProcedures:
      '1. Notify monitoring\n2. Test 10% devices per floor\n3. Reset and verify panel clear',
    inspectionTechNotes: 'Last month: one smokes low battery in stair 3.',
    timeIn: '08:42',
    timeOut: '09:05',
    resultStatus: 'tested',
    skipReason: null,
    isAnnualMonth: false,
  },
  {
    id: 2,
    stopNumber: 12,
    displayAddress: '1045 Pandora Ave',
    buildingName: 'Tower A',
    propertyManagementCompany: 'Coast Property Mgmt',
    panelLabel: 'FACP — Roof mechanical',
    ring: 'R-12B',
    key: 'KEY-4421',
    annualMonth: 'May',
    doorCode: null,
    panel: 'Notifier NFS2-3030',
    panelLocation: 'Roof penthouse, north wall',
    monitoringCompany: 'Paladin Security',
    monitoringNotes: null,
    testingProcedures:
      'Annual: full device test per NFPA 72. Document all out-of-service devices on back of sheet.',
    inspectionTechNotes: '',
    timeIn: '09:12',
    timeOut: null,
    resultStatus: 'in_progress',
    skipReason: null,
    isAnnualMonth: true,
  },
  {
    id: 3,
    stopNumber: 13,
    displayAddress: '2200 Douglas St — Units 4-9',
    buildingName: null,
    propertyManagementCompany: 'Quadra Properties',
    panelLabel: null,
    ring: 'R-3',
    key: 'KEY-1188',
    annualMonth: null,
    doorCode: 'Front desk',
    panel: 'Fire-Lite MS-5UD',
    panelLocation: 'Main floor lobby closet',
    monitoringCompany: 'Securitas',
    monitoringNotes: 'Call ahead — front desk holds keys after 6pm',
    testingProcedures: 'Monthly: horns/strobes + 2 smokes per floor.',
    inspectionTechNotes: '',
    timeIn: null,
    timeOut: null,
    resultStatus: 'pending',
    skipReason: null,
    isAnnualMonth: false,
  },
  {
    id: 4,
    stopNumber: 14,
    displayAddress: '891 Johnson St',
    buildingName: 'Parkade',
    propertyManagementCompany: null,
    panelLabel: 'FACP only',
    ring: 'R-8',
    key: 'KEY-9002',
    annualMonth: null,
    doorCode: null,
    panel: 'Simplex 4010',
    panelLocation: 'P1 ramp entrance',
    monitoringCompany: '—',
    monitoringNotes: null,
    testingProcedures: 'Skip annual devices. Visual panel check only.',
    inspectionTechNotes: 'Gate arm broken — use side pedestrian door.',
    timeIn: null,
    timeOut: null,
    resultStatus: 'skipped',
    skipReason: 'No access — parkade gate stuck closed',
    isAnnualMonth: false,
  },
  {
    id: 5,
    stopNumber: 15,
    displayAddress: '1450 Government St',
    buildingName: 'Annex',
    propertyManagementCompany: 'BC Housing',
    panelLabel: null,
    ring: 'R-1',
    key: 'KEY-2200',
    annualMonth: null,
    doorCode: '2510',
    panel: 'Edwards EST3',
    panelLocation: 'Basement B1, room 12',
    monitoringCompany: 'ADT Commercial',
    monitoringNotes: null,
    testingProcedures: 'Standard monthly test. Elevator recall test with on-site staff.',
    inspectionTechNotes: '',
    timeIn: null,
    timeOut: null,
    resultStatus: 'pending',
    skipReason: null,
    isAnnualMonth: false,
  },
]

function statusLabel(status: StopStatus): string {
  if (status === 'tested') return 'Tested'
  if (status === 'skipped') return 'Skipped'
  if (status === 'in_progress') return 'In progress'
  return 'Pending'
}

function isClockedIn(stop: MockStop): boolean {
  return !!stop.timeIn && !stop.timeOut && stop.resultStatus !== 'skipped'
}

/** Nav pill background — clocked in beats tested / skipped / annual. */
function navStopStatusClass(stop: MockStop): string {
  if (isClockedIn(stop)) return 'pw-mock-nav-stop--clocked-in'
  if (stop.resultStatus === 'tested') return 'pw-mock-nav-stop--tested'
  if (stop.resultStatus === 'skipped') return 'pw-mock-nav-stop--skipped'
  if (stop.isAnnualMonth) return 'pw-mock-nav-stop--annual'
  return ''
}

function headerBandClass(status: StopStatus, isAnnual: boolean): string {
  if (status === 'tested') return 'pw-mock-header--tested'
  if (status === 'skipped') return 'pw-mock-header--skipped'
  if (status === 'in_progress') return 'pw-mock-header--progress'
  if (isAnnual) return 'pw-mock-header--annual'
  return 'pw-mock-header--pending'
}

function FieldRow({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className={`pw-mock-field-row${multiline ? ' pw-mock-field-row--multiline' : ''}`}>
      <div className="pw-mock-field-label">{label}</div>
      <div className="pw-mock-field-value">{value || '—'}</div>
    </div>
  )
}

export default function TechnicianPortalWorksheetMockupPage() {
  const [stops, setStops] = useState<MockStop[]>(INITIAL_STOPS)
  const [activeId, setActiveId] = useState(2)
  const [navExpanded, setNavExpanded] = useState(false)
  const [skipModalOpen, setSkipModalOpen] = useState(false)
  const [noteModalOpen, setNoteModalOpen] = useState(false)
  const [skipDraft, setSkipDraft] = useState('')
  const [noteDraft, setNoteDraft] = useState('')

  const active = useMemo(() => stops.find((s) => s.id === activeId) ?? stops[0], [stops, activeId])

  const clockedInStop = useMemo(() => stops.find((s) => isClockedIn(s)) ?? null, [stops])

  const clockInBlockedElsewhere =
    clockedInStop != null && clockedInStop.id !== activeId

  const progress = useMemo(() => {
    const tested = stops.filter((s) => s.resultStatus === 'tested').length
    const skipped = stops.filter((s) => s.resultStatus === 'skipped').length
    const open = stops.length - tested - skipped
    return { tested, skipped, open, total: stops.length }
  }, [stops])

  const updateActive = useCallback((patch: Partial<MockStop>) => {
    setStops((prev) =>
      prev.map((s) => (s.id === activeId ? { ...s, ...patch } : s)),
    )
  }, [activeId])

  const clockIn = () => {
    if (clockInBlockedElsewhere) {
      window.alert(WORKSHEET_CLOCK_IN_BLOCKED_MESSAGE)
      return
    }
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    updateActive({ timeIn: now, timeOut: null, resultStatus: 'in_progress', skipReason: null })
  }

  const clockOut = () => {
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    updateActive({ timeOut: now, resultStatus: 'tested' })
    const idx = stops.findIndex((s) => s.id === activeId)
    const next = stops.slice(idx + 1).find((s) => s.resultStatus === 'pending')
    if (next) setActiveId(next.id)
  }

  const applySkip = () => {
    updateActive({
      resultStatus: 'skipped',
      skipReason: skipDraft.trim() || 'Skipped',
      timeIn: null,
      timeOut: null,
    })
    setSkipModalOpen(false)
    setSkipDraft('')
  }

  const openNoteModal = () => {
    setNoteDraft(active.inspectionTechNotes)
    setNoteModalOpen(true)
  }

  const applyNote = () => {
    updateActive({ inspectionTechNotes: noteDraft.trim() })
    setNoteModalOpen(false)
    setNoteDraft('')
  }

  const renderNavStop = (stop: MockStop) => {
    const isActive = stop.id === activeId
    const statusClass = navStopStatusClass(stop)
    const clockedIn = isClockedIn(stop)
    const activeClass = isActive ? ' pw-mock-nav-stop--active' : ''
    const statusSuffix = statusClass ? ` ${statusClass}` : ''

    if (!navExpanded) {
      return (
        <button
          key={stop.id}
          type="button"
          className={`pw-mock-nav-stop pw-mock-nav-stop--collapsed${statusSuffix}${activeClass}`}
          onClick={() => setActiveId(stop.id)}
          title={`#${stop.stopNumber} — ${stop.displayAddress}`}
          aria-label={`Stop ${stop.stopNumber}, ${clockedIn ? 'Clocked in' : statusLabel(stop.resultStatus)}`}
          aria-current={isActive ? 'true' : undefined}
        >
          <span className="pw-mock-nav-stop-num">{stop.stopNumber}</span>
        </button>
      )
    }

    return (
      <button
        key={stop.id}
        type="button"
        className={`pw-mock-nav-stop pw-mock-nav-stop--expanded${statusSuffix}${activeClass}`}
        onClick={() => setActiveId(stop.id)}
        aria-current={isActive ? 'true' : undefined}
      >
        <span className="pw-mock-nav-stop-address">{stop.displayAddress}</span>
        <span className="pw-mock-nav-stop-detail">
          <span className="pw-mock-nav-stop-line">
            <span className="pw-mock-nav-stop-label">Monitoring</span>
            {stop.monitoringCompany}
          </span>
          <span className="pw-mock-nav-stop-line">
            <span className="pw-mock-nav-stop-label">Key</span>
            {stop.key}
          </span>
          <span className="pw-mock-nav-stop-line">
            <span className="pw-mock-nav-stop-label">Ring</span>
            {stop.ring}
          </span>
        </span>
      </button>
    )
  }

  return (
    <div className="portal-worksheet-mockup">
      <div className="pw-mock-banner">
        <strong>UI mockup</strong> — fake data only. Not connected to the live worksheet.
        <Link to="/tech/start" className="ms-2">
          Back to portal
        </Link>
      </div>

      <header className="pw-mock-chrome">
        <div className="pw-mock-chrome-top">
          <Link to="/tech/start" className="btn btn-link text-primary p-0 pw-mock-back" aria-label="Back">
            <i className="bi bi-arrow-left-circle-fill" aria-hidden />
          </Link>
          <div className="pw-mock-chrome-titles">
            <div className="pw-mock-route-title">R1 — 1st Monday</div>
            <div className="pw-mock-route-sub">May 2026 run · {progress.total} stops</div>
          </div>
          <Badge bg="success" className="pw-mock-sync">
            Synced
          </Badge>
        </div>
        <div className="pw-mock-chrome-meta">
          <span>
            {progress.tested} tested · {progress.skipped} skipped · {progress.open} open
          </span>
          <Button size="sm" variant="outline-success" disabled>
            Complete run
          </Button>
        </div>
      </header>

      <div className="pw-mock-body">
        <aside
          className={`pw-mock-sidenav${navExpanded ? ' pw-mock-sidenav--expanded' : ' pw-mock-sidenav--collapsed'}`}
        >
          {navExpanded ? (
            <div className="pw-mock-sidenav-head">
              <div className="pw-mock-sidenav-title">Route</div>
              <div className="pw-mock-sidenav-sub">{progress.total} stops</div>
            </div>
          ) : null}
          <div className="pw-mock-sidenav-list">{stops.map((s) => renderNavStop(s))}</div>
          <button
            type="button"
            className="pw-mock-sidenav-toggle"
            aria-expanded={navExpanded}
            onClick={() => setNavExpanded((v) => !v)}
          >
            <i
              className={`bi ${navExpanded ? 'bi-chevron-double-left' : 'bi-chevron-double-right'}`}
              aria-hidden
            />
            {navExpanded ? <span className="pw-mock-sidenav-toggle-label">Collapse menu</span> : null}
          </button>
        </aside>

        <div className="pw-mock-shell">
        <section className="pw-mock-detail">
          <div className={`pw-mock-header ${headerBandClass(active.resultStatus, active.isAnnualMonth)}`}>
            <div className="pw-mock-header-stop">
              Stop #{active.stopNumber}
              {active.isAnnualMonth ? (
                <span className="pw-mock-annual-pill">Annual month</span>
              ) : null}
            </div>
            <h1 className="pw-mock-header-address">{active.displayAddress}</h1>
            {active.buildingName ? (
              <div className="pw-mock-header-line">{active.buildingName}</div>
            ) : null}
            {active.propertyManagementCompany ? (
              <div className="pw-mock-header-line text-muted">{active.propertyManagementCompany}</div>
            ) : null}
            {active.panelLabel ? (
              <div className="pw-mock-header-line fw-semibold">{active.panelLabel}</div>
            ) : null}
            {(active.timeIn || active.timeOut) && (
              <div className="pw-mock-header-times">
                {active.timeIn ? <span>Time in {active.timeIn}</span> : null}
                {active.timeOut ? <span> · Time out {active.timeOut}</span> : null}
              </div>
            )}
            {active.resultStatus === 'skipped' && active.skipReason ? (
              <div className="pw-mock-header-skip">Skipped: {active.skipReason}</div>
            ) : null}
          </div>

          <div className="pw-mock-fields">
            <div className="pw-mock-field-group">
              <div className="pw-mock-field-group-title">Access</div>
              <FieldRow label="Ring" value={active.ring} />
              <FieldRow label="Key #" value={active.key} />
              <FieldRow label="Door code" value={active.doorCode ?? '—'} />
              <FieldRow label="Annual" value={active.annualMonth ?? '—'} />
            </div>
            <div className="pw-mock-field-group">
              <div className="pw-mock-field-group-title">Panel</div>
              <FieldRow label="Panel (make / model)" value={active.panel} />
              <FieldRow label="Panel location" value={active.panelLocation} />
            </div>
            <div className="pw-mock-field-group">
              <div className="pw-mock-field-group-title">Monitoring</div>
              <FieldRow label="Company" value={active.monitoringCompany} />
              {active.monitoringNotes ? (
                <FieldRow label="Notes" value={active.monitoringNotes} multiline />
              ) : null}
            </div>
            <div className="pw-mock-field-group">
              <div className="pw-mock-field-group-title">Test sheet</div>
              <FieldRow label="Testing procedures" value={active.testingProcedures} multiline />
              <FieldRow label="Tech comments & notes" value={active.inspectionTechNotes} multiline />
            </div>
          </div>
        </section>

        <footer className="pw-mock-dock">
          <Button
            variant="primary"
            className="pw-mock-dock-btn"
            disabled={active.resultStatus === 'tested' || !!active.timeIn}
            onClick={clockIn}
          >
            Clock in
          </Button>
          <Button
            variant="primary"
            className="pw-mock-dock-btn"
            disabled={!active.timeIn || !!active.timeOut}
            onClick={clockOut}
          >
            Clock out
          </Button>
          <Button
            variant="outline-warning"
            className="pw-mock-dock-btn"
            disabled={active.resultStatus === 'tested'}
            onClick={() => {
              setSkipDraft(active.skipReason ?? '')
              setSkipModalOpen(true)
            }}
          >
            Skip
          </Button>
          <Button variant="outline-danger" className="pw-mock-dock-btn" onClick={() => window.alert('Deficiency — not wired in mockup')}>
            Deficiency
          </Button>
          <Button variant="outline-secondary" className="pw-mock-dock-btn" onClick={openNoteModal}>
            Note
          </Button>
        </footer>
        </div>
      </div>

      <Modal show={skipModalOpen} onHide={() => setSkipModalOpen(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Skip stop #{active.stopNumber}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <label className="form-label small" htmlFor="skip-reason">
            Reason
          </label>
          <textarea
            id="skip-reason"
            className="form-control"
            rows={3}
            value={skipDraft}
            onChange={(e) => setSkipDraft(e.target.value)}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setSkipModalOpen(false)}>
            Cancel
          </Button>
          <Button variant="warning" onClick={applySkip}>
            Confirm skip
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={noteModalOpen} onHide={() => setNoteModalOpen(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Tech comments &amp; notes</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="small text-muted mb-2">Edit the note for this stop. Saving replaces the existing text.</p>
          <textarea
            className="form-control"
            rows={6}
            placeholder="Comments for this month’s visit…"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setNoteModalOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={applyNote}>
            Save note
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  )
}
