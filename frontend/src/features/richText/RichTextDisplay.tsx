import { sanitizeRichTextHtml, richTextIsEmpty } from './richTextSanitize'

type RichTextDisplayProps = {
  value: string | null | undefined
  className?: string
  emptyPlaceholder?: string
}

export default function RichTextDisplay({
  value,
  className,
  emptyPlaceholder = '—',
}: RichTextDisplayProps) {
  const raw = (value ?? '').trim()
  const empty = richTextIsEmpty(raw)
  const classes = ['rich-text-display', className].filter(Boolean).join(' ')

  if (empty) {
    return <span className={`${classes} rich-text-display--empty`}>{emptyPlaceholder}</span>
  }

  const sanitized = sanitizeRichTextHtml(raw)
  if (!sanitized.includes('<')) {
    return <span className={`${classes} rich-text-display--plain`}>{sanitized}</span>
  }

  return (
    <span
      className={classes}
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  )
}
