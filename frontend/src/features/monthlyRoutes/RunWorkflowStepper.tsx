import {
  deriveRunWorkflowStage,
  runWorkflowStageIndex,
  RUN_WORKFLOW_STEP_LABELS,
  type RunWorkflowStage,
} from './runWorkflowShared'
import type { TechnicianWorksheetRun } from './monthlyRoutesShared'

type Props = {
  run: TechnicianWorksheetRun | null | undefined
  className?: string
}

export default function RunWorkflowStepper({ run, className }: Props) {
  const stage: RunWorkflowStage = deriveRunWorkflowStage(run)
  const activeIndex = runWorkflowStageIndex(stage)

  return (
    <nav
      className={className ?? 'run-workflow-stepper'}
      aria-label="Run workflow progress"
    >
      <ol className="run-workflow-stepper__list">
        {RUN_WORKFLOW_STEP_LABELS.map((label, index) => {
          const done = index < activeIndex || stage === 'completed'
          const current = index === activeIndex && stage !== 'completed'
          const activePhase = label === 'Active' && current
          return (
            <li
              key={label}
              className={[
                'run-workflow-stepper__step',
                done ? 'run-workflow-stepper__step--done' : '',
                current ? 'run-workflow-stepper__step--current' : '',
                activePhase ? 'run-workflow-stepper__step--active-phase' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="run-workflow-stepper__marker" aria-hidden />
              <span className="run-workflow-stepper__label">{label}</span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
