import { describe, expect, it } from 'vitest'
import {
  addTagToList,
  MAX_TAG_LENGTH,
  MAX_TICKET_TAGS,
  normalizeTagInput,
  removeTagFromList,
  ticketAuthorsMatch,
} from './locationTicketsShared'

describe('normalizeTagInput', () => {
  it('trims and accepts valid tags', () => {
    expect(normalizeTagInput('  keys  ')).toBe('keys')
  })

  it('rejects tags over max length', () => {
    expect(normalizeTagInput('x'.repeat(MAX_TAG_LENGTH + 1))).toBeNull()
  })
})

describe('addTagToList', () => {
  it('dedupes case-insensitively and enforces max count', () => {
    let tags: string[] = []
    for (let i = 0; i < MAX_TICKET_TAGS; i += 1) {
      const result = addTagToList(tags, `tag-${i}`)
      tags = result.tags
      expect(result.error).toBeNull()
    }
    const overflow = addTagToList(tags, 'one-more')
    expect(overflow.error).toContain(String(MAX_TICKET_TAGS))
    const dupe = addTagToList(['Keys'], 'keys')
    expect(dupe.tags).toEqual(['Keys'])
  })
})

describe('removeTagFromList', () => {
  it('removes a single tag', () => {
    expect(removeTagFromList(['a', 'b'], 'a')).toEqual(['b'])
  })
})

describe('ticketAuthorsMatch', () => {
  it('matches session username to comment author', () => {
    expect(ticketAuthorsMatch('Office_User', 'office_user')).toBe(true)
    expect(ticketAuthorsMatch('alice', 'bob')).toBe(false)
  })
})
