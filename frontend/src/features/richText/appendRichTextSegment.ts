function escapePlainTextForRichText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Append plain user text as a blue rich-text segment to existing HTML. */
export function appendBlueRichTextSegment(
  existing: string | null | undefined,
  plainText: string,
): string {
  const trimmed = plainText.trim()
  if (!trimmed) return (existing ?? '').trim()
  const segment = `<span class="rt-blue">${escapePlainTextForRichText(trimmed)}</span>`
  const base = (existing ?? '').trim()
  if (!base) return segment
  return `${base}<br>${segment}`
}
