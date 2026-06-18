import { apiErrorText } from './apiClient'

/** User-facing line when weekly processed totals include an API error field. */
export function processingWowErrorLine(error: unknown, fallback: string): string {
  if (error == null || error === '') return fallback
  return apiErrorText(error, fallback)
}

export function hasProcessingDataError(error: unknown): boolean {
  if (error == null || error === '') return false
  return true
}
