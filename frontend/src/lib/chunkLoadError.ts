const DYNAMIC_IMPORT_ERROR_TEXT = [
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'importing a module script failed',
  'chunkloaderror',
  'loading chunk',
] as const

export const CHUNK_RELOAD_SESSION_KEY = 'schedule-assist:chunk-reload'

/** True when a lazy route chunk failed to download (usually stale cache after deploy). */
export function isChunkLoadError(error: unknown): boolean {
  let haystack = ''
  if (error instanceof Error) {
    haystack = `${error.name}\n${error.message}`.toLowerCase()
  } else if (typeof error === 'string') {
    haystack = error.toLowerCase()
  } else {
    return false
  }
  return DYNAMIC_IMPORT_ERROR_TEXT.some((text) => haystack.includes(text))
}
