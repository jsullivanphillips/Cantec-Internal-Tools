import type { CSSProperties, ReactNode } from 'react'

/** Balanced directory columns; address + PMC slightly wider than route/key/annual. */
export const DIRECTORY_COLUMN_WIDTHS = {
  status: '3%',
  route: '7%',
  address: '24%',
  tags: '14%',
  property: '18%',
  key: '14%',
  annual: '12%',
} as const

export const STATUS_COLUMN_STYLE: CSSProperties = {
  textAlign: 'center',
}

export const KEYS_COLUMN_STYLE: CSSProperties = {
  textAlign: 'center',
}

export const ANNUAL_COLUMN_STYLE: CSSProperties = {
  textAlign: 'center',
}

export const LIBRARY_TABLE_HEADER_STICKY_STYLE: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 5,
  backgroundColor: '#fff',
  boxShadow: 'inset 0 -1px 0 rgba(0, 0, 0, 0.12)',
}

export function renderLibraryStatusDot(status: string | null | undefined): ReactNode {
  const normalized = (status || '').toLowerCase()
  let colorClass = 'bg-secondary'
  let label = status || 'unknown'

  if (normalized === 'active') {
    colorClass = 'bg-success'
    label = 'active'
  } else if (normalized === 'cancelled') {
    colorClass = 'bg-danger'
    label = 'cancelled'
  } else if (normalized === 'on_hold' || normalized === 'on hold') {
    colorClass = 'bg-warning'
    label = 'on hold'
  } else if (normalized === 'waiting_keys' || normalized === 'waiting keys') {
    return (
      <i
        className="bi bi-key-fill text-warning"
        title="waiting keys"
        aria-label="waiting keys"
      />
    )
  }

  return (
    <span
      className={`d-inline-block rounded-circle ${colorClass}`}
      style={{ width: 10, height: 10 }}
      title={label}
      aria-label={label}
    />
  )
}
