import { Spinner } from 'react-bootstrap'

import {
  officePaperworkLifecycleBannerDetail,
  officePaperworkLifecycleTitle,
  type OfficePaperworkLifecycleProgress,
} from './officePaperworkLifecycleProgress'

type OfficePaperworkLifecycleBannerProps = {
  progress: OfficePaperworkLifecycleProgress | null
}

export function OfficePaperworkLifecycleBanner({ progress }: OfficePaperworkLifecycleBannerProps) {
  if (!progress) return null

  const title = officePaperworkLifecycleTitle(progress.operation)
  const detail = officePaperworkLifecycleBannerDetail(progress)

  return (
    <div
      className="office-paperwork-lifecycle-banner"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={title}
    >
      <Spinner animation="border" size="sm" className="office-paperwork-lifecycle-banner__spinner" aria-hidden />
      <div className="office-paperwork-lifecycle-banner__copy">
        <strong className="office-paperwork-lifecycle-banner__title">{title}</strong>
        <span className="office-paperwork-lifecycle-banner__detail">{detail}</span>
      </div>
    </div>
  )
}
