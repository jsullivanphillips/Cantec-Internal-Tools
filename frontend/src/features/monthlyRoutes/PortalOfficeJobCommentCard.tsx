import RichTextDisplay from '../richText/RichTextDisplay'
import type { TechnicianWorksheetLocation } from './monthlyRoutesShared'
import { portalStopHasOfficeJobComment } from './portalWorkflowShared'

type Props = {
  stop: TechnicianWorksheetLocation
}

export default function PortalOfficeJobCommentCard({ stop }: Props) {
  if (!portalStopHasOfficeJobComment(stop)) return null

  return (
    <div className="pw-mock-field-group pw-portal-office-job-comment-card">
      <div className="pw-mock-field-group-title">Office job comment</div>
      <div className="pw-portal-office-job-comment-card__content">
        <RichTextDisplay value={stop.office_job_comment ?? ''} />
      </div>
    </div>
  )
}
