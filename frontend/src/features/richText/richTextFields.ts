/** Stop comment fields that support inline bold + color rich text. */
export const RICH_TEXT_FIELD_KEYS = [
  'office_job_comment',
  'testing_procedures',
  'inspection_tech_notes',
  'run_comments',
] as const

export type RichTextFieldKey = (typeof RICH_TEXT_FIELD_KEYS)[number]

const RICH_TEXT_FIELD_SET = new Set<string>(RICH_TEXT_FIELD_KEYS)

export function isRichTextField(fieldKey: string): fieldKey is RichTextFieldKey {
  return RICH_TEXT_FIELD_SET.has(fieldKey)
}

/** Portal fields techs may edit with the formatting toolbar (office job comment is read-only). */
export function isPortalRichTextEditableField(fieldKey: string): boolean {
  return (
    fieldKey === 'testing_procedures' ||
    fieldKey === 'inspection_tech_notes' ||
    fieldKey === 'run_comments'
  )
}
