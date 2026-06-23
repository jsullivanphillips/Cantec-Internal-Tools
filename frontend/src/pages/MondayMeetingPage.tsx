import { Suspense, useCallback } from 'react'
import { Card, Nav, Tab } from 'react-bootstrap'
import { useSearchParams } from 'react-router-dom'
import { lazyWithChunkRetry } from '../lib/lazyWithChunkRetry'
import '../features/mondayMeeting/mondayMeeting.css'

const MondayMeetingProcessingEmbed = lazyWithChunkRetry(
  () => import('../features/mondayMeeting/MondayMeetingProcessingEmbed'),
)
const MondayMeetingProcessingHistoryEmbed = lazyWithChunkRetry(
  () => import('../features/mondayMeeting/MondayMeetingProcessingHistoryEmbed'),
)
const MondayMeetingSchedulingEmbed = lazyWithChunkRetry(
  () => import('../features/mondayMeeting/MondayMeetingSchedulingEmbed'),
)
const MondayMeetingServiceTab = lazyWithChunkRetry(
  () => import('../features/mondayMeeting/MondayMeetingServiceTab'),
)

function MondayMeetingTabFallback() {
  return (
    <div className="monday-meeting-service-loading" aria-busy="true" aria-label="Loading tab">
      <div className="spinner-border text-primary" role="status">
        <span className="visually-hidden">Loading…</span>
      </div>
    </div>
  )
}

type MondayMeetingTabKey = 'processing' | 'processing-history' | 'scheduling' | 'service'

function parseMondayMeetingTab(tab: string | null): MondayMeetingTabKey {
  if (tab === 'processing-history' || tab === 'scheduling' || tab === 'service') return tab
  return 'processing'
}

export default function MondayMeetingPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = parseMondayMeetingTab(searchParams.get('tab'))

  const handleTabSelect = useCallback(
    (key: string | null) => {
      const k = key as MondayMeetingTabKey
      if (!k || k === 'processing') {
        setSearchParams({}, { replace: true })
        return
      }
      setSearchParams({ tab: k }, { replace: true })
    },
    [setSearchParams],
  )

  return (
    <div className="monday-meeting-page container-fluid py-3 px-2 d-flex flex-column gap-3">
      <Card className="app-surface-card">
        <Card.Body className="p-3 p-md-4">
          <h1 className="processing-page-title mb-1">Monday Meeting</h1>
          <p className="processing-page-subtitle mb-0">
            Processing backlog, scheduling health, and service pipeline metrics in one view.
          </p>
        </Card.Body>
      </Card>

      <Tab.Container activeKey={activeTab} onSelect={handleTabSelect}>
        <div className="processing-tabs-shell app-surface-card">
          <Nav variant="tabs" className="mb-0 processing-tabs processing-tabs-shell__nav">
            <Nav.Item>
              <Nav.Link eventKey="processing">Processing</Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link eventKey="scheduling">Scheduling</Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link eventKey="service">Service</Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link eventKey="processing-history">Processing History</Nav.Link>
            </Nav.Item>
          </Nav>
          <Tab.Content className="processing-tabs-shell__panel">
            <Tab.Pane eventKey="processing" mountOnEnter unmountOnExit>
              <Suspense fallback={<MondayMeetingTabFallback />}>
                <MondayMeetingProcessingEmbed />
              </Suspense>
            </Tab.Pane>
            <Tab.Pane eventKey="scheduling" mountOnEnter unmountOnExit>
              <Suspense fallback={<MondayMeetingTabFallback />}>
                <MondayMeetingSchedulingEmbed />
              </Suspense>
            </Tab.Pane>
            <Tab.Pane eventKey="service" mountOnEnter unmountOnExit>
              <Suspense fallback={<MondayMeetingTabFallback />}>
                <MondayMeetingServiceTab />
              </Suspense>
            </Tab.Pane>
            <Tab.Pane eventKey="processing-history" mountOnEnter unmountOnExit>
              <Suspense fallback={<MondayMeetingTabFallback />}>
                <MondayMeetingProcessingHistoryEmbed />
              </Suspense>
            </Tab.Pane>
          </Tab.Content>
        </div>
      </Tab.Container>
    </div>
  )
}
