const base = import.meta.env.VITE_API_BASE_URL ?? ''

/** True when the SPA is on the PIN-gated technician portal (`/tech/*`). */
export function isTechnicianPortalPath(pathname = window.location.pathname): boolean {
  return pathname === '/tech' || pathname.startsWith('/tech/')
}

function staffLoginPath(): string {
  return `${base}/login`
}

/** Where to send the browser when staff/portal session auth failed. */
export function authFailureRedirectPath(pathname = window.location.pathname): string {
  return isTechnicianPortalPath(pathname) ? `${base}/tech` : staffLoginPath()
}

function resolveRedirectLocation(locationHeader: string | null): string {
  const fallback = isTechnicianPortalPath() ? '/tech' : '/login'
  const loc = (locationHeader || fallback).trim()
  let target = loc.startsWith('http') ? loc : `${base}${loc.startsWith('/') ? loc : `/${loc}`}`

  if (isTechnicianPortalPath()) {
    try {
      const url = new URL(target, window.location.origin)
      if (url.pathname === '/login' || url.pathname.endsWith('/login')) {
        return authFailureRedirectPath()
      }
    } catch {
      if (target.includes('/login')) {
        return authFailureRedirectPath()
      }
    }
  }
  return target
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === 'AbortError'
  if (typeof error === 'object' && error != null && 'name' in error) {
    return (error as { name?: string }).name === 'AbortError'
  }
  return false
}

/** Coerce API/unknown values to safe React text (avoids rendering plain objects). */
export function coerceUiText(value: unknown, fallback = ''): string {
  if (value == null) return fallback
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Error) return value.message || fallback
  try {
    return JSON.stringify(value)
  } catch {
    return fallback
  }
}

/** User-facing message from a non-2xx API response body and status code. */
export function formatApiErrorMessage(
  status: number,
  body: unknown,
  fallback: string,
): string {
  if (body && typeof body === 'object' && body !== null) {
    const record = body as Record<string, unknown>
    if (typeof record.error === 'string' && record.error.trim()) {
      return record.error.trim()
    }
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message.trim()
    }
  }
  if (typeof body === 'string') {
    const trimmed = body.trim()
    if (trimmed && !trimmed.startsWith('<!') && trimmed.length <= 300) {
      return trimmed
    }
  }
  if (status >= 500) {
    return 'The server ran into an unexpected error while loading this data. Try again in a moment, or contact the office if it keeps happening.'
  }
  if (status === 404) {
    return 'This data is not available right now.'
  }
  if (status === 403) {
    return "You don't have permission to view this data."
  }
  if (status === 401) {
    return 'Your session may have expired. Refresh the page and sign in again.'
  }
  return fallback
}

export async function readApiErrorBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text.trim()) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export async function apiFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${base}${path}`
  const hdrs: Record<string, string> = {
    Accept: 'application/json',
    ...((init.headers as Record<string, string>) || {}),
  }
  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    redirect: 'manual',
    headers: hdrs,
  })

  if (res.status === 302 || res.status === 301) {
    window.location.href = resolveRedirectLocation(res.headers.get('location'))
    throw new Error('redirect')
  }

  const ct = res.headers.get('content-type') || ''
  if (!res.ok && ct.includes('text/html') && (res.status === 401 || res.status === 403)) {
    window.location.href = authFailureRedirectPath()
    throw new Error('auth')
  }

  return res
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const hdrs: Record<string, string> = { ...(init?.headers as Record<string, string>) }
  if (init?.body != null && !hdrs['Content-Type'] && !hdrs['content-type']) {
    hdrs['Content-Type'] = 'application/json'
  }
  const res = await apiFetch(path, { ...init, headers: hdrs })
  if (!res.ok) {
    const body = await readApiErrorBody(res)
    if (
      res.status === 401 &&
      isTechnicianPortalPath() &&
      typeof body === 'object' &&
      body != null &&
      'code' in (body as Record<string, unknown>)
    ) {
      const code = String((body as { code?: string }).code || '')
      if (code === 'auth_required' || code === 'portal_locked') {
        window.location.href = authFailureRedirectPath()
        throw new Error('portal_auth')
      }
    }
    throw body
  }
  // DELETE and some success handlers return 204 No Content with no body — res.json() throws.
  if (res.status === 204 || res.status === 205) {
    return undefined as T
  }
  const text = await res.text()
  if (!text.trim()) {
    return undefined as T
  }
  return JSON.parse(text) as T
}

/**
 * POST a ``FormData`` (typically a single uploaded file) and parse the JSON response.
 *
 * Unlike :func:`apiJson` we do NOT set ``Content-Type``; browsers must add the
 * multipart boundary themselves. On non-2xx responses we throw the parsed JSON
 * (or raw text) so callers can render the server's ``error`` field directly.
 */
export async function apiPostFormData<T>(path: string, form: FormData): Promise<T> {
  const res = await apiFetch(path, { method: 'POST', body: form })
  if (!res.ok) {
    const text = await res.text()
    let err: unknown = text
    try {
      err = JSON.parse(text)
    } catch {
      /* keep raw text */
    }
    throw err
  }
  if (res.status === 204 || res.status === 205) {
    return undefined as T
  }
  const text = await res.text()
  if (!text.trim()) {
    return undefined as T
  }
  return JSON.parse(text) as T
}
