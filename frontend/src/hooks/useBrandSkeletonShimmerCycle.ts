import { useLayoutEffect } from 'react'

/** Viewport travel per shimmer cycle (horizontal) at this speed keeps bars visually in sync. */
export const BRAND_SKELETON_SHIMMER_SPEED_PX_PER_S = 2200
export const BRAND_SKELETON_SHIMMER_TRAVEL_VW = 200

/** Sets the shared shimmer cycle duration on `:root` for all skeleton loaders. */
export function useBrandSkeletonShimmerCycle(): void {
  useLayoutEffect(() => {
    const syncCycle = () => {
      const travelPx = (BRAND_SKELETON_SHIMMER_TRAVEL_VW / 100) * window.innerWidth
      const seconds = travelPx / BRAND_SKELETON_SHIMMER_SPEED_PX_PER_S
      document.documentElement.style.setProperty('--brand-skeleton-shimmer-cycle', `${seconds}s`)
    }

    syncCycle()
    window.addEventListener('resize', syncCycle)
    return () => {
      window.removeEventListener('resize', syncCycle)
      document.documentElement.style.removeProperty('--brand-skeleton-shimmer-cycle')
    }
  }, [])
}
