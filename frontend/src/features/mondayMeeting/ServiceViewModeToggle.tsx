import { useCallback, useEffect, useState } from 'react'
import { SERVICE_VIEW_MODE_STORAGE_KEY, type ServiceViewMode } from './serviceMetricsTypes'

function readStoredViewMode(): ServiceViewMode {
  try {
    const stored = localStorage.getItem(SERVICE_VIEW_MODE_STORAGE_KEY)
    return stored === 'visuals' ? 'visuals' : 'metrics'
  } catch {
    return 'metrics'
  }
}

export function useServiceViewMode(): [ServiceViewMode, (mode: ServiceViewMode) => void] {
  const [viewMode, setViewModeState] = useState<ServiceViewMode>(() => readStoredViewMode())

  const setViewMode = useCallback((mode: ServiceViewMode) => {
    setViewModeState(mode)
    try {
      localStorage.setItem(SERVICE_VIEW_MODE_STORAGE_KEY, mode)
    } catch {
      // Ignore storage errors.
    }
  }, [])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SERVICE_VIEW_MODE_STORAGE_KEY) return
      setViewModeState(event.newValue === 'visuals' ? 'visuals' : 'metrics')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return [viewMode, setViewMode]
}

type Props = {
  value: ServiceViewMode
  onChange: (mode: ServiceViewMode) => void
}

export default function ServiceViewModeToggle({ value, onChange }: Props) {
  return (
    <div
      className="monday-meeting-service-view-toggle"
      role="radiogroup"
      aria-label="Service metrics display mode"
    >
      {(['metrics', 'visuals'] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          className={`monday-meeting-service-view-toggle__btn${
            value === mode ? ' monday-meeting-service-view-toggle__btn--active' : ''
          }`}
          onClick={() => onChange(mode)}
        >
          {mode === 'metrics' ? 'Metrics' : 'Visuals'}
        </button>
      ))}
    </div>
  )
}
