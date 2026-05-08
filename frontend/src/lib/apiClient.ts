const base = import.meta.env.VITE_API_BASE_URL ?? ''

export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === 'AbortError'
  if (typeof error === 'object' && error != null && 'name' in error) {
    return (error as { name?: string }).name === 'AbortError'
  }
  return false
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
    const loc = res.headers.get('location') || '/login'
    window.location.href = loc.startsWith('http') ? loc : `${base}${loc}`
    throw new Error('redirect')
  }

  const ct = res.headers.get('content-type') || ''
  if (!res.ok && ct.includes('text/html')) {
    window.location.href = `${base}/login`
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
    const text = await res.text()
    let err: unknown = text
    try {
      err = JSON.parse(text)
    } catch {
      /* keep text */
    }
    throw err
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
