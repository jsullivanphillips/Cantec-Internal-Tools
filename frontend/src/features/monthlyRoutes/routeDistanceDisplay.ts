/** Format route driving distance from calculated_path ``distance_meters``. */
export function formatDistanceMeters(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value < 1000) return `${Math.round(value)} m`
  return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} km`
}
