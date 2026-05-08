/**
 * View-only parsing for monitoring paste shapes:
 * - Colon headers (COMPANY / SIGNALS / ACCT / PHONE / PASS / PW, etc.)
 * - Short prose blocks: company name line(s), `account #…`, `password is …`
 *
 * Trailing prose in the same paragraph as headers with no blank line stays attached
 * to the last field; use a blank paragraph to separate free-form notes below.
 */

export type MonitoringFieldKey = 'company' | 'signals' | 'acct' | 'phone' | 'pass' | 'pw'

export type MonitoringSheetFieldRow = {
  key: MonitoringFieldKey
  label: string
  value: string
}

export type MonitoringSheetParsed = {
  isStructured: boolean
  remainderBefore: string
  remainderAfter: string
  fields: MonitoringSheetFieldRow[]
}

const DISPLAY_ORDER: MonitoringFieldKey[] = ['company', 'signals', 'acct', 'phone', 'pass', 'pw']

const FIELD_LABELS: Record<MonitoringFieldKey, string> = {
  company: 'Company',
  signals: 'Signals',
  acct: 'Acct',
  phone: 'Phone',
  pass: 'Pass',
  pw: 'PW',
}

/** Line after trimEnd — headers may be indented in pasted sheets. */
function parseMonitoringHeaderLine(line: string): { key: MonitoringFieldKey; inlineRest: string } | null {
  const t = line.trim()
  const labeled = t.match(
    /^(COMPANY|SIGNALS|ACCT|ACCOUNT|PHONE|PASSWORD|PASS|PW)\s*:\s*(.*)$/i,
  )
  if (labeled) {
    const tag = labeled[1].toUpperCase()
    const map: Record<string, MonitoringFieldKey> = {
      COMPANY: 'company',
      SIGNALS: 'signals',
      ACCT: 'acct',
      ACCOUNT: 'acct',
      PHONE: 'phone',
      PASSWORD: 'pass',
      PASS: 'pass',
      PW: 'pw',
    }
    const key = map[tag]
    if (!key) return null
    return { key, inlineRest: labeled[2] }
  }
  if (/^PW\s*:/i.test(t)) return null
  const pwShort = t.match(/^PW\s+(\S.*)$/i)
  if (pwShort) return { key: 'pw', inlineRest: pwShort[1] }
  return null
}

/** `account #123` / `password is …` (no colon headers). */
const PROSE_ACCOUNT_HASH_RE = /^\s*account\s*#\s*(.+?)\s*$/i
const PROSE_PASSWORD_IS_RE = /^\s*password\s+is\s+(.+)$/i
const PROSE_PASSWORD_COLON_RE = /^\s*password\s*:\s*(.+)$/i
const PROSE_PASSWD_IS_RE = /^\s*(?:pwd|passwd|pass)\s+is\s+(.+)$/i

function proseMonitoringLineMatchesStructured(lineTrimmed: string): boolean {
  return (
    PROSE_ACCOUNT_HASH_RE.test(lineTrimmed) ||
    PROSE_PASSWORD_IS_RE.test(lineTrimmed) ||
    PROSE_PASSWORD_COLON_RE.test(lineTrimmed) ||
    PROSE_PASSWD_IS_RE.test(lineTrimmed)
  )
}

function paragraphContainsColonHeaders(paragraph: string): boolean {
  const lines = preprocessMonitoringStructuredParagraph(normalizeNewlines(paragraph)).split('\n')
  return lines.some((ln) => parseMonitoringHeaderLine(ln) != null)
}

/** True if paragraph uses colon headers or prose account/password lines. */
function paragraphContainsStructuredMonitoring(paragraph: string): boolean {
  if (paragraphContainsColonHeaders(paragraph)) return true
  const lines = normalizeNewlines(paragraph).split('\n')
  return lines.some((ln) => proseMonitoringLineMatchesStructured(ln.trim()))
}

function normalizeNewlines(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/**
 * Split labels jammed on one line (e.g. `PHONE:… ACCT PASS:boats`) into separate lines.
 * PASSWORD must precede PASS in the lookahead so `PASSWORD:` is not cut as `PASS`.
 */
function preprocessMonitoringStructuredParagraph(paragraph: string): string {
  let t = normalizeNewlines(paragraph)
  t = t.replace(/\s+ACCT\s+(?=PASS(?:WORD)?\s*:)/gi, '\nACCT:\n')
  t = t.replace(
    /\s+(?=(?:COMPANY|SIGNALS|ACCT|ACCOUNT|PHONE|PASSWORD|PASS|PW)\s*:)/gi,
    '\n',
  )
  return t
}

function mergeFieldValue(
  prevRaw: string | undefined,
  incomingJoined: string,
): string {
  const incoming = incomingJoined.trim()
  const prev = (prevRaw ?? '').trim()
  if (incoming) return prev ? `${prev}\n${incoming}` : incoming
  return prev
}

/**
 * Natural-language lines (when no colon headers). Leading lines → company; lines after
 * account/password → remainderAfterInner.
 */
function tryParseProseStructuredParagraph(paragraph: string): {
  remainderBeforeInner: string
  remainderAfterInner: string
  values: Partial<Record<MonitoringFieldKey, string>>
  seen: Set<MonitoringFieldKey>
} | null {
  const lines = paragraph.split('\n')
  const seen = new Set<MonitoringFieldKey>()
  const values: Partial<Record<MonitoringFieldKey, string>> = {}
  const companyBuf: string[] = []
  const trailingBuf: string[] = []
  let phase: 'company' | 'afterStructured' = 'company'

  function consumeStructuredLine(line: string): boolean {
    let m = line.match(PROSE_ACCOUNT_HASH_RE)
    if (m) {
      seen.add('acct')
      values.acct = mergeFieldValue(values.acct, m[1].trim())
      return true
    }
    m =
      line.match(PROSE_PASSWORD_IS_RE) ||
      line.match(PROSE_PASSWORD_COLON_RE) ||
      line.match(PROSE_PASSWD_IS_RE)
    if (m) {
      seen.add('pass')
      values.pass = mergeFieldValue(values.pass, m[1].trim())
      return true
    }
    return false
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    if (consumeStructuredLine(line)) {
      phase = 'afterStructured'
      continue
    }

    if (phase === 'company') companyBuf.push(line)
    else trailingBuf.push(line)
  }

  if (seen.size === 0) return null

  const companyText = companyBuf.join('\n').trim()
  if (companyText) {
    seen.add('company')
    values.company = companyText
  }

  return {
    remainderBeforeInner: '',
    remainderAfterInner: trailingBuf.join('\n').trim(),
    values,
    seen,
  }
}

function parseStructuredParagraphBody(paragraph: string): {
  remainderBeforeInner: string
  remainderAfterInner: string
  values: Partial<Record<MonitoringFieldKey, string>>
  seen: Set<MonitoringFieldKey>
} {
  const normalized = normalizeNewlines(paragraph)
  const lines = preprocessMonitoringStructuredParagraph(normalized).split('\n')
  const hasColonHeader = lines.some((ln) => parseMonitoringHeaderLine(ln) != null)

  if (!hasColonHeader) {
    const prose = tryParseProseStructuredParagraph(normalized)
    if (prose != null) return prose
    return {
      remainderBeforeInner: normalized.trim(),
      remainderAfterInner: '',
      values: {},
      seen: new Set(),
    }
  }

  let firstHeaderIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (parseMonitoringHeaderLine(lines[i])) {
      firstHeaderIdx = i
      break
    }
  }
  if (firstHeaderIdx < 0) {
    return {
      remainderBeforeInner: normalized.trim(),
      remainderAfterInner: '',
      values: {},
      seen: new Set(),
    }
  }

  const remainderBeforeInner = lines.slice(0, firstHeaderIdx).join('\n').trim()

  const seen = new Set<MonitoringFieldKey>()
  const values: Partial<Record<MonitoringFieldKey, string>> = {}

  let i = firstHeaderIdx
  while (i < lines.length) {
    const header = parseMonitoringHeaderLine(lines[i])
    if (!header) {
      i++
      continue
    }
    const { key, inlineRest } = header
    seen.add(key)
    const parts: string[] = []
    parts.push(inlineRest)
    i++
    while (i < lines.length) {
      const nextHeader = parseMonitoringHeaderLine(lines[i])
      if (nextHeader) break
      parts.push(lines[i])
      i++
    }
    const joined = parts.join('\n').replace(/^\n+/, '').replace(/\s+\n/g, '\n').trimEnd()
    values[key] = mergeFieldValue(values[key], joined)
  }

  return { remainderBeforeInner, remainderAfterInner: '', values, seen }
}

export function parseMonitoringSheetDisplay(raw: string | null | undefined): MonitoringSheetParsed {
  const s = normalizeNewlines(raw ?? '')
  if (!s.trim()) {
    return { isStructured: false, remainderBefore: '', remainderAfter: '', fields: [] }
  }

  const paragraphs = s.split(/\n\s*\n+/)

  let structuredIdx = -1
  for (let p = 0; p < paragraphs.length; p++) {
    if (paragraphContainsStructuredMonitoring(paragraphs[p])) {
      structuredIdx = p
      break
    }
  }

  if (structuredIdx < 0) {
    return { isStructured: false, remainderBefore: '', remainderAfter: '', fields: [] }
  }

  const beforeParas = paragraphs.slice(0, structuredIdx).join('\n\n').trim()
  const structuredPara = paragraphs[structuredIdx]
  const afterParas = paragraphs.slice(structuredIdx + 1).join('\n\n').trim()

  const { remainderBeforeInner, remainderAfterInner, values, seen } =
    parseStructuredParagraphBody(structuredPara)

  if (seen.size === 0) {
    return { isStructured: false, remainderBefore: '', remainderAfter: '', fields: [] }
  }

  const remainderBeforeParts = [beforeParas, remainderBeforeInner].filter((x) => x.length > 0)
  const remainderBefore = remainderBeforeParts.join('\n\n').trim()

  const remainderAfterParts = [remainderAfterInner, afterParas].filter((x) => x.length > 0)
  const remainderAfter = remainderAfterParts.join('\n\n').trim()

  const fields: MonitoringSheetFieldRow[] = []
  for (const key of DISPLAY_ORDER) {
    if (!seen.has(key)) continue
    fields.push({
      key,
      label: FIELD_LABELS[key],
      value: (values[key] ?? '').trim(),
    })
  }

  return {
    isStructured: true,
    remainderBefore,
    remainderAfter,
    fields,
  }
}
