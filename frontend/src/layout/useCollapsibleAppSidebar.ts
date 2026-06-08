import { useEffect, useRef, useState } from 'react'

const APP_SIDEBAR_EXPAND_TRANSITION_MS = 220
const APP_SIDEBAR_LABEL_ANIMATION_MS = 360

export function useCollapsibleAppSidebar() {
  const [navExpanded, setNavExpanded] = useState(true)
  const [navItemsExpanded, setNavItemsExpanded] = useState(true)
  const [navLabelsAnimating, setNavLabelsAnimating] = useState(false)
  const navWasCollapsedRef = useRef(false)

  useEffect(() => {
    if (!navExpanded) {
      setNavItemsExpanded(false)
      setNavLabelsAnimating(false)
      navWasCollapsedRef.current = true
      return undefined
    }

    const shouldAnimateLabels = navWasCollapsedRef.current
    navWasCollapsedRef.current = false

    const revealTimer = window.setTimeout(() => {
      setNavItemsExpanded(true)
      if (shouldAnimateLabels) {
        setNavLabelsAnimating(true)
      }
    }, APP_SIDEBAR_EXPAND_TRANSITION_MS)

    return () => window.clearTimeout(revealTimer)
  }, [navExpanded])

  useEffect(() => {
    if (!navLabelsAnimating) return undefined
    const timer = window.setTimeout(() => setNavLabelsAnimating(false), APP_SIDEBAR_LABEL_ANIMATION_MS)
    return () => window.clearTimeout(timer)
  }, [navLabelsAnimating])

  return {
    navExpanded,
    setNavExpanded,
    navItemsExpanded,
    navLabelsAnimating,
  }
}
