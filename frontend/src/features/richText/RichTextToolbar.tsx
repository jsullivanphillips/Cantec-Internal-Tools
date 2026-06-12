import type { RichTextEditorHandle } from './RichTextEditor'
import { RICH_TEXT_COLOR_OPTIONS, type RichTextColorId } from './richTextColors'

type RichTextToolbarProps = {
  editor: RichTextEditorHandle | null
  className?: string
}

function preventToolbarFocusLoss(event: React.MouseEvent | React.PointerEvent): void {
  event.preventDefault()
}

export default function RichTextToolbar({ editor, className }: RichTextToolbarProps) {
  return (
    <div
      className={['rich-text-toolbar', className].filter(Boolean).join(' ')}
      role="toolbar"
      aria-label="Text formatting"
    >
      <button
        type="button"
        className="rich-text-toolbar__btn rich-text-toolbar__btn--bold"
        aria-label="Bold"
        disabled={!editor}
        onPointerDown={preventToolbarFocusLoss}
        onMouseDown={preventToolbarFocusLoss}
        onClick={() => editor?.applyBold()}
      >
        <strong>B</strong>
      </button>
      <div className="rich-text-toolbar__colors" role="group" aria-label="Text color">
        {RICH_TEXT_COLOR_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`rich-text-toolbar__color rich-text-toolbar__color--${option.id}`}
            aria-label={option.label}
            title={option.label}
            disabled={!editor}
            onPointerDown={preventToolbarFocusLoss}
            onMouseDown={preventToolbarFocusLoss}
            onClick={() => editor?.applyColor(option.id as RichTextColorId)}
          />
        ))}
      </div>
    </div>
  )
}
