import type { ReactNode } from 'react'
import { useBrandSkeletonShimmerCycle } from '../hooks/useBrandSkeletonShimmerCycle'

/** Keeps viewport-synced skeleton shimmer timing available app-wide. */
export default function BrandSkeletonStylesProvider({ children }: { children: ReactNode }) {
  useBrandSkeletonShimmerCycle()
  return children
}
