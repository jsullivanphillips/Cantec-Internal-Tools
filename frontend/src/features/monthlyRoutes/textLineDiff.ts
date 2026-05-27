/** Line-level diff for run-details long text (comments, procedures). */

export type LineDiffPart =
  | { type: 'same'; line: string }
  | { type: 'remove'; line: string }
  | { type: 'add'; line: string }

export const RUN_DETAIL_LINE_DIFF_LABELS = new Set([
  'Testing procedures',
  'Location comments',
  'Job comment',
])

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n')
}

function lineKey(line: string): string {
  return line.trim()
}

function lcsLength(a: string[], b: string[]): number[][] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  return dp
}

/** Myers-style backtrack over trimmed line keys; display uses original line text. */
export function computeLineDiff(before: string, after: string): LineDiffPart[] {
  const oldLines = splitLines(before)
  const newLines = splitLines(after)
  const a = oldLines.map(lineKey)
  const b = newLines.map(lineKey)
  const dp = lcsLength(a, b)
  const out: LineDiffPart[] = []
  let i = 0
  let j = 0
  while (i < oldLines.length && j < newLines.length) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', line: newLines[j] })
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'remove', line: oldLines[i] })
      i += 1
    } else {
      out.push({ type: 'add', line: newLines[j] })
      j += 1
    }
  }
  while (i < oldLines.length) {
    out.push({ type: 'remove', line: oldLines[i] })
    i += 1
  }
  while (j < newLines.length) {
    out.push({ type: 'add', line: newLines[j] })
    j += 1
  }
  return out
}

export type LineDiffDisplayMode = 'lines' | 'full'

/** Prefer compact +/- lines when most content is unchanged (e.g. one line appended). */
export function lineDiffDisplayMode(
  label: string,
  before: string,
  after: string,
): LineDiffDisplayMode {
  if (!RUN_DETAIL_LINE_DIFF_LABELS.has(label)) return 'full'
  const parts = computeLineDiff(before, after)
  const same = parts.filter((p) => p.type === 'same').length
  const changed = parts.length - same
  if (changed === 0) return 'full'
  // Entirely rewritten: side-by-side blocks are easier to read.
  if (same === 0 && changed > 10) return 'full'
  return 'lines'
}

export function changedLineDiffParts(parts: LineDiffPart[]): LineDiffPart[] {
  return parts.filter((p) => p.type !== 'same')
}

export type LineDiffGroup = {
  type: 'add' | 'remove'
  text: string
}

function isBlankDiffLine(line: string): boolean {
  return line.trim() === ''
}

/** Merge consecutive added (or removed) lines into one block for display. */
export function groupLineDiffParts(parts: LineDiffPart[]): LineDiffGroup[] {
  const groups: LineDiffGroup[] = []
  for (const part of parts) {
    if (part.type === 'same') continue
    if (isBlankDiffLine(part.line)) continue
    const type = part.type === 'add' ? 'add' : 'remove'
    const last = groups[groups.length - 1]
    if (last && last.type === type) {
      last.text = `${last.text}\n${part.line}`
    } else {
      groups.push({ type, text: part.line })
    }
  }
  return groups
}

export function lineDiffAriaSummary(label: string, groups: LineDiffGroup[]): string {
  const adds = groups.filter((g) => g.type === 'add').length
  const removes = groups.filter((g) => g.type === 'remove').length
  const bits: string[] = [label]
  if (adds) bits.push(`${adds} addition${adds === 1 ? '' : 's'}`)
  if (removes) bits.push(`${removes} removal${removes === 1 ? '' : 's'}`)
  return bits.join(': ')
}
