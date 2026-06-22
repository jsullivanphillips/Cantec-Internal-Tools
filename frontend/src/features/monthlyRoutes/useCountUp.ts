import { useEffect, useState } from 'react'

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

/** Animate an integer from 0 to `target` over `durationMs`. */
export function useCountUp(
  target: number | null | undefined,
  durationMs: number,
  enabled: boolean,
): number | null {
  const [value, setValue] = useState<number | null>(enabled ? 0 : (target ?? null))

  useEffect(() => {
    if (target == null || !Number.isFinite(target)) {
      setValue(null)
      return
    }
    if (!enabled) {
      setValue(Math.round(target))
      return
    }

    let frame = 0
    let start: number | null = null
    const roundedTarget = Math.round(target)

    const tick = (timestamp: number) => {
      if (start == null) start = timestamp
      const progress = Math.min(1, (timestamp - start) / durationMs)
      setValue(Math.round(roundedTarget * easeOutCubic(progress)))
      if (progress < 1) {
        frame = requestAnimationFrame(tick)
      }
    }

    setValue(0)
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, durationMs, enabled])

  return value
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
