import {
  TICKET_STATUS_LABELS,
  type LocationTicketStatus,
} from './locationTicketsShared'

const TICKET_STEP_ORDER: LocationTicketStatus[] = ['open', 'in_progress', 'closed']

type Props = {
  status: LocationTicketStatus
  className?: string
}

export default function TicketStatusStepper({ status, className }: Props) {
  const activeIndex = TICKET_STEP_ORDER.indexOf(status)

  return (
    <nav
      className={className ?? 'ticket-status-stepper'}
      aria-label="Ticket status"
    >
      <ol className="ticket-status-stepper__list">
        {TICKET_STEP_ORDER.map((stepStatus, index) => {
          const done = index < activeIndex
          const current = index === activeIndex
          return (
            <li
              key={stepStatus}
              className={[
                'ticket-status-stepper__step',
                done ? 'ticket-status-stepper__step--done' : '',
                current ? 'ticket-status-stepper__step--current' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="ticket-status-stepper__label">
                {TICKET_STATUS_LABELS[stepStatus]}
              </span>
              <span className="ticket-status-stepper__track" aria-hidden>
                <span className="ticket-status-stepper__marker" />
                {index < TICKET_STEP_ORDER.length - 1 ? (
                  <span
                    className={[
                      'ticket-status-stepper__connector',
                      index < activeIndex ? 'ticket-status-stepper__connector--done' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  />
                ) : null}
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
