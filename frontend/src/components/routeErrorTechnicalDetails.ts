import { isRouteErrorResponse } from 'react-router-dom'
import { isChunkLoadError } from '../lib/chunkLoadError'
import { formatReactMinifiedErrorDetails } from '../lib/reactErrorDetails'

export const RENDER_ERROR_DETAILS_KEY = 'schedule-assist:render-error-details'

function stringifyUnknown(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function readStoredRenderContext(): { componentStack?: string | null; pathname?: string; at?: string } | null {
  try {
    const raw = sessionStorage.getItem(RENDER_ERROR_DETAILS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as { componentStack?: string | null; pathname?: string; at?: string }
  } catch {
    return null
  }
}

export function formatRouteErrorTechnicalDetails(
  error: unknown,
  context?: { pathname?: string; componentStack?: string | null },
): string {
  const lines: string[] = []
  const pathname = context?.pathname ?? window.location.pathname
  const stored = readStoredRenderContext()

  lines.push(`When: ${new Date().toISOString()}`)
  lines.push(`Route: ${pathname}`)
  if (stored?.at) lines.push(`Stored render context: ${stored.at}`)
  if (typeof navigator !== 'undefined' && navigator.userAgent) {
    lines.push(`Browser: ${navigator.userAgent}`)
  }
  lines.push('')

  if (isChunkLoadError(error)) {
    lines.push('Type: Lazy chunk failed to load (stale cache after deploy is common).')
    lines.push('')
  }

  if (error instanceof Error) {
    const reactDetails = formatReactMinifiedErrorDetails(error.message)
    if (reactDetails) {
      lines.push(reactDetails)
      lines.push('')
    }
    lines.push(`Error name: ${error.name}`)
    lines.push(`Error message: ${error.message}`)
    if (error.stack) {
      lines.push('')
      lines.push('Stack trace:')
      lines.push(error.stack)
    }
  } else if (isRouteErrorResponse(error)) {
    lines.push(`HTTP status: ${error.status}`)
    if (error.statusText) lines.push(`Status text: ${error.statusText}`)
    if (error.data != null) {
      lines.push('')
      lines.push('Response data:')
      lines.push(stringifyUnknown(error.data))
    }
  } else {
    lines.push('Error payload:')
    lines.push(stringifyUnknown(error))
  }

  const componentStack = context?.componentStack ?? stored?.componentStack
  if (componentStack) {
    lines.push('')
    lines.push('React component stack:')
    lines.push(componentStack)
  }

  return lines.filter((line, index, all) => !(line === '' && all[index + 1] === '')).join('\n')
}
