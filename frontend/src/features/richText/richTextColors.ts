export type RichTextColorId = 'black' | 'red' | 'green' | 'blue' | 'orange'

export type RichTextColorOption = {
  id: RichTextColorId
  label: string
  className: string
}

export const RICH_TEXT_COLOR_OPTIONS: readonly RichTextColorOption[] = [
  { id: 'black', label: 'Black', className: 'rt-black' },
  { id: 'red', label: 'Red', className: 'rt-red' },
  { id: 'green', label: 'Green', className: 'rt-green' },
  { id: 'blue', label: 'Blue', className: 'rt-blue' },
  { id: 'orange', label: 'Orange', className: 'rt-orange' },
] as const

export const RICH_TEXT_COLOR_CLASS_NAMES = new Set(
  RICH_TEXT_COLOR_OPTIONS.map((option) => option.className),
)

export function richTextColorClassName(id: RichTextColorId): string {
  return RICH_TEXT_COLOR_OPTIONS.find((option) => option.id === id)?.className ?? 'rt-black'
}
