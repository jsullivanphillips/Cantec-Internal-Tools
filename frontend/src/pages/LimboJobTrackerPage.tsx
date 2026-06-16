import { Card } from 'react-bootstrap'
import LimboJobTrackerPanel from '../components/LimboJobTrackerPanel'

export default function LimboJobTrackerPage() {
  return (
    <div className="container-fluid py-3 px-2 limbo-job-tracker-page d-flex flex-column gap-3">
      <Card className="app-surface-card">
        <Card.Body className="p-3 p-md-4">
          <h1 className="processing-page-title mb-1">Limbo jobs</h1>
          <p className="processing-page-subtitle mb-0">
            Scheduled jobs with no appointment, or appointments that have passed without completion.
          </p>
        </Card.Body>
      </Card>
      <LimboJobTrackerPanel />
    </div>
  )
}
