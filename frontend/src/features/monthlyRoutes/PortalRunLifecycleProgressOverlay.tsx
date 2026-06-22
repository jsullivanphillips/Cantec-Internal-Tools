import { ProgressBar, Spinner } from 'react-bootstrap'

import {
  operationTitle,
  runLifecycleDetailLine,
  runLifecycleProgressPercent,
  stepStatus,
  stepsForOperation,
  type PortalRunLifecycleProgress,
} from './portalRunLifecycleProgress'

type PortalRunLifecycleProgressOverlayProps = {
  progress: PortalRunLifecycleProgress | null
}

function StepIcon({ status }: { status: 'done' | 'active' | 'pending' }) {
  if (status === 'done') {
    return (
      <span className="portal-run-lifecycle-progress__step-icon portal-run-lifecycle-progress__step-icon--done" aria-hidden>
        ✓
      </span>
    )
  }
  if (status === 'active') {
    return (
      <span className="portal-run-lifecycle-progress__step-icon portal-run-lifecycle-progress__step-icon--active" aria-hidden>
        <Spinner animation="border" size="sm" />
      </span>
    )
  }
  return (
    <span className="portal-run-lifecycle-progress__step-icon portal-run-lifecycle-progress__step-icon--pending" aria-hidden />
  )
}

export default function PortalRunLifecycleProgressOverlay({
  progress,
}: PortalRunLifecycleProgressOverlayProps) {
  if (!progress) return null

  const title = operationTitle(progress.operation)
  const detail = runLifecycleDetailLine(progress)
  const percent = runLifecycleProgressPercent(progress)
  const steps = stepsForOperation(progress.operation)
  const isActive = progress.completedStepIds.length < steps.length

  return (
    <div
      className="portal-blocking-overlay portal-run-lifecycle-progress"
      role="status"
      aria-live="polite"
      aria-busy={isActive}
      aria-label={title}
    >
      <div className="portal-run-lifecycle-progress__card">
        <header className="portal-run-lifecycle-progress__header">
          <h2 className="portal-run-lifecycle-progress__title">{title}</h2>
          <p className="portal-run-lifecycle-progress__detail">{detail}</p>
        </header>

        <div className="portal-run-lifecycle-progress__bar-wrap">
          <div className="portal-run-lifecycle-progress__bar-meta">
            <span>Progress</span>
            <span className="tabular-nums">{percent}%</span>
          </div>
          <ProgressBar
            now={percent}
            animated={isActive}
            striped={isActive}
            className="portal-run-lifecycle-progress__bar"
          />
        </div>

        <ol className="portal-run-lifecycle-progress__steps">
          {steps.map((step) => {
            const status = stepStatus(progress, step.id)
            return (
              <li
                key={step.id}
                className={[
                  'portal-run-lifecycle-progress__step',
                  `portal-run-lifecycle-progress__step--${status}`,
                ].join(' ')}
              >
                <StepIcon status={status} />
                <div className="portal-run-lifecycle-progress__step-copy">
                  <span className="portal-run-lifecycle-progress__step-title">{step.title}</span>
                  {status === 'active' ? (
                    <span className="portal-run-lifecycle-progress__step-desc">{step.description}</span>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
