import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiJson } from '../lib/apiClient'
import PortalLocationReferencePanel, {
  type PortalLocationReference,
} from '../features/monthlyRoutes/PortalLocationReferencePanel'
import PortalBootstrapIcon from '../features/monthlyRoutes/PortalBootstrapIcon'
import { locationPrimaryLabel } from '../features/monthlyRoutes/locationDisplay'
import PortalLocationReferenceSkeleton from './PortalLocationReferenceSkeleton'

type PortalLocationResponse = {
  location: PortalLocationReference
}

export default function TechnicianPortalLocationPage() {
  const { locationId } = useParams<{ locationId: string }>()
  const idNum = locationId ? parseInt(locationId, 10) : NaN
  const [location, setLocation] = useState<PortalLocationReference | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!locationId || Number.isNaN(idNum)) {
      setError('Invalid location.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await apiJson<PortalLocationResponse>(`/api/technician_portal/locations/${idNum}`)
      setLocation(data.location)
    } catch (e) {
      const maybe = e as { code?: string }
      if (maybe?.code === 'not_found') {
        setError('Location not found.')
      } else if (maybe?.code === 'portal_locked') {
        window.location.replace('/tech')
        return
      } else {
        setError('Could not load this location.')
      }
      setLocation(null)
    } finally {
      setLoading(false)
    }
  }, [idNum, locationId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return <PortalLocationReferenceSkeleton />
  }

  if (error || !location) {
    return (
      <div className="portal-worksheet-mockup p-3">
        <div className="portal-flow-notice portal-flow-notice--error" role="alert">
          {error || 'Location not found.'}
        </div>
        <Link to="/tech/home" className="btn btn-link text-primary px-0 mt-2">
          Back to home
        </Link>
      </div>
    )
  }

  const title = locationPrimaryLabel(location)

  return (
    <div className="portal-worksheet-mockup portal-location-ref-page">
      <header className="pw-mock-chrome">
        <div className="pw-mock-chrome-top">
          <div className="pw-mock-chrome-start">
            <Link to="/tech/home" className="btn btn-link text-primary p-0 pw-mock-back" aria-label="Back to home">
              <PortalBootstrapIcon name="arrow-left-circle-fill" className="pw-mock-back-icon" aria-hidden />
            </Link>
            <div className="pw-mock-chrome-titles">
              <div className="pw-mock-route-title">{title}</div>
            </div>
          </div>
        </div>
      </header>

      <div className="portal-location-ref-scroll">
        <PortalLocationReferencePanel location={location} />
      </div>
    </div>
  )
}
