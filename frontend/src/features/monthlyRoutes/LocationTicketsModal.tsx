import { LocationTicketsPanelModal } from './LocationTicketsPanel'

type Props = {
  show: boolean
  routeId: number
  locationId: number
  locationLabel: string
  monthDate: string
  sessionUsername?: string | null
  onHide: () => void
  onTicketsChanged?: () => void
}

export default function LocationTicketsModal({
  show,
  routeId,
  locationId,
  locationLabel,
  monthDate,
  sessionUsername = null,
  onHide,
  onTicketsChanged,
}: Props) {
  return (
    <LocationTicketsPanelModal
      show={show}
      routeId={routeId}
      locationId={locationId}
      locationLabel={locationLabel}
      monthDate={monthDate}
      sessionUsername={sessionUsername}
      onHide={onHide}
      onTicketsChanged={onTicketsChanged}
    />
  )
}
