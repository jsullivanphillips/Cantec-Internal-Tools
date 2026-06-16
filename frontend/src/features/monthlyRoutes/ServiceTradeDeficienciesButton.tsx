import { useState } from 'react'
import { Button } from 'react-bootstrap'
import ServiceTradeDeficienciesModal from './ServiceTradeDeficienciesModal'

const NO_LINK_TITLE = 'Link this site to ServiceTrade to view deficiencies.'

type Props = {
  locationId: number
  hasServiceTradeLink: boolean
  locationLabel?: string
  size?: 'sm' | undefined
  className?: string
  variant?: 'outline-secondary' | 'outline-primary'
  label?: string
}

export default function ServiceTradeDeficienciesButton({
  locationId,
  hasServiceTradeLink,
  locationLabel,
  size = 'sm',
  className = '',
  variant = 'outline-secondary',
  label = 'View deficiencies',
}: Props) {
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={`st-deficiencies-view-btn ${className}`.trim()}
        disabled={!hasServiceTradeLink}
        title={hasServiceTradeLink ? undefined : NO_LINK_TITLE}
        onClick={() => setModalOpen(true)}
      >
        {label}
      </Button>
      {hasServiceTradeLink ? (
        <ServiceTradeDeficienciesModal
          show={modalOpen}
          onHide={() => setModalOpen(false)}
          locationId={locationId}
          locationLabel={locationLabel}
        />
      ) : null}
    </>
  )
}
