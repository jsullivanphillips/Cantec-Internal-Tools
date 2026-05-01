import { Link } from 'react-router-dom'
import {
  libraryRouteNumberLine,
  libraryRouteOccurrenceLine,
  type LibraryLocation,
} from './monthlyRoutesShared'

/** In-app route detail when ``monthly_route.id`` exists; otherwise plain label. */
export default function RouteLibraryLink({ loc }: { loc: LibraryLocation }) {
  const line1 = libraryRouteNumberLine(loc)
  const line2 = libraryRouteOccurrenceLine(loc)
  const rid = loc.monthly_route?.id

  const body = (
    <>
      <span className="d-block">{line1}</span>
      {line2 != null ? (
        <span className="d-block small text-muted fw-normal">{line2}</span>
      ) : null}
    </>
  )

  if (rid != null && line1 !== '—') {
    return (
      <Link to={`/monthlies/routes/${rid}`} className="fw-semibold text-decoration-none">
        {body}
      </Link>
    )
  }
  return <>{body}</>
}
