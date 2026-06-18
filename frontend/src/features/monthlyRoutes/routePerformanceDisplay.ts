/** Format net profit percentage (0–1 fraction) for route performance display. */
export function formatNetPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return '—'
  return `${(pct * 100).toFixed(1)}%`
}
