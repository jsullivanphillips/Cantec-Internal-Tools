export const MAX_MONTHLY_LOCATION_TAGS = 32
export const MAX_MONTHLY_LOCATION_TAG_LENGTH = 32

export function normalizeMonthlyLocationTag(raw: string): string | null {
  const tag = raw.trim()
  if (!tag) return null
  if (tag.length > MAX_MONTHLY_LOCATION_TAG_LENGTH) return null
  return tag
}

export function addMonthlyLocationTag(
  tags: string[],
  raw: string,
): { tags: string[]; error: string | null } {
  const tag = normalizeMonthlyLocationTag(raw)
  if (!tag) {
    return { tags, error: `Enter a tag up to ${MAX_MONTHLY_LOCATION_TAG_LENGTH} characters.` }
  }
  if (tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
    return { tags, error: null }
  }
  if (tags.length >= MAX_MONTHLY_LOCATION_TAGS) {
    return { tags, error: `A location may have at most ${MAX_MONTHLY_LOCATION_TAGS} tags.` }
  }
  return { tags: [...tags, tag], error: null }
}

export function removeMonthlyLocationTag(tags: string[], tag: string): string[] {
  return tags.filter((item) => item !== tag)
}
