import { registerSW } from 'virtual:pwa-register'
import { isTechnicianPortalPath } from './apiClient'

/** Register the PWA service worker only on technician portal routes. */
export function registerPortalServiceWorkerIfNeeded(): void {
  if (!isTechnicianPortalPath()) return
  if (!('serviceWorker' in navigator)) return

  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (import.meta.env.DEV) {
        console.info('[portal-pwa] service worker registered', registration?.scope)
      }
    },
    onRegisterError(error) {
      console.warn('[portal-pwa] service worker registration failed', error)
    },
  })
}
