const REACT_ERROR_SUMMARIES: Record<number, string> = {
  31: 'Objects are not valid as a React child. A plain JavaScript object (for example {}) was rendered as UI text instead of a string or element.',
  130: 'Element type is invalid — a component was undefined, often due to a bad import/export.',
  152: 'React.Children.only expected a single child.',
  294: 'Too many re-renders. React limits nested updates to prevent infinite loops.',
  418: 'Hydration failed because the server HTML did not match the client.',
  423: 'There was an error while hydrating but React recovered by client-rendering the tree.',
}

const REACT_ERROR_HINTS: Record<number, string[]> = {
  31: [
    'An API response field named error or message may be an object instead of a string.',
    'Check Monday Meeting → Processing weekly KPI trend lines if the crash happens on the home page.',
    'Hard-refresh after deploys (Ctrl+Shift+R) if you recently saw a chunk load error.',
  ],
}

export type ParsedReactMinifiedError = {
  code: number
  summary: string
  args: string[]
  hints: string[]
  docsUrl: string | null
}

function decodeArg(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '))
  } catch {
    return raw
  }
}

/** Expand "Minified React error #31; visit https://react.dev/errors/31?args[]=..." messages. */
export function parseReactMinifiedError(message: string): ParsedReactMinifiedError | null {
  const codeMatch = message.match(/Minified React error #(\d+)/i)
  if (!codeMatch) return null

  const code = Number(codeMatch[1])
  const args: string[] = []
  const argsPattern = /args\[\]=([^;&\s]+)/g
  let argMatch: RegExpExecArray | null
  while ((argMatch = argsPattern.exec(message)) !== null) {
    args.push(decodeArg(argMatch[1]))
  }

  const docsMatch = message.match(/https:\/\/react\.dev\/errors\/\d+[^\s)]*/)
  const summary = REACT_ERROR_SUMMARIES[code] ?? `React runtime error #${code}.`
  const hints = REACT_ERROR_HINTS[code] ?? []

  return {
    code,
    summary,
    args,
    hints,
    docsUrl: docsMatch?.[0] ?? `https://react.dev/errors/${code}`,
  }
}

export function formatReactMinifiedErrorDetails(message: string): string | null {
  const parsed = parseReactMinifiedError(message)
  if (!parsed) return null

  const lines = [
    `React error #${parsed.code}: ${parsed.summary}`,
    ...(parsed.args.length > 0 ? [`Argument(s): ${parsed.args.join(' · ')}`] : []),
    ...(parsed.hints.length > 0 ? ['', 'Likely causes:', ...parsed.hints.map((h) => `- ${h}`)] : []),
    ...(parsed.docsUrl ? ['', `Docs: ${parsed.docsUrl}`] : []),
  ]
  return lines.join('\n')
}
