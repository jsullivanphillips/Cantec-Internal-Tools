import { type ComponentType, lazy } from 'react'
import { CHUNK_RELOAD_SESSION_KEY, isChunkLoadError } from './chunkLoadError'

type LazyModule<T extends ComponentType<unknown>> = { default: T }

/**
 * Like React.lazy, but reloads the page once when a hashed Vite chunk 404s
 * (common after deploy while an old index bundle is still cached).
 */
export function lazyWithChunkRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<LazyModule<T>>,
) {
  return lazy(async () => {
    const alreadyReloaded = window.sessionStorage.getItem(CHUNK_RELOAD_SESSION_KEY) === '1'

    try {
      const module = await factory()
      window.sessionStorage.removeItem(CHUNK_RELOAD_SESSION_KEY)
      return module
    } catch (error) {
      if (!alreadyReloaded && isChunkLoadError(error)) {
        window.sessionStorage.setItem(CHUNK_RELOAD_SESSION_KEY, '1')
        window.location.reload()
        return new Promise<LazyModule<T>>(() => {})
      }
      throw error
    }
  })
}
