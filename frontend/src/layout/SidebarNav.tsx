import { useCallback, useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Nav } from 'react-bootstrap'

type NavItem = { to: string; label: string; icon: string; end?: boolean }
type NavSection = { title: string; items: NavItem[] }

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Status',
    items: [
      { to: '/monday_meeting', label: 'Monday Meeting', icon: 'bi-calendar-week' },
      { to: '/technician_meeting', label: 'Technician Meeting', icon: 'bi-people' },
    ],
  },
  {
    title: 'Tools',
    items: [
      { to: '/keys', label: 'Keys', icon: 'bi-key', end: true },
      { to: '/find_schedule', label: 'Scheduling Assistant', icon: 'bi-calendar2-check' },
      { to: '/limbo_job_tracker', label: 'Limbo jobs', icon: 'bi-hourglass-split' },
      { to: '/battery_capacity_calculator', label: 'Battery Capacity Calculator', icon: 'bi-battery-charging' },
      { to: '/quotation_tool', label: 'Quotation Tool', icon: 'bi-calculator' },
    ],
  },
  {
    title: 'Monthlies',
    items: [
      { to: '/monthlies', label: 'Dashboard', icon: 'bi-grid-1x2', end: true },
      { to: '/monthlies/locations', label: 'Monthly Locations', icon: 'bi-buildings', end: true },
      { to: '/monthlies/billing', label: 'Monthly Billing', icon: 'bi-receipt', end: true },
      { to: '/monthlies/map', label: 'Map', icon: 'bi-map' },
      { to: '/monthlies/monitoring-companies', label: 'Monitoring companies', icon: 'bi-telephone' },
    ],
  },
  {
    title: 'Data',
    items: [
      { to: '/deficiency_tracker', label: 'Deficiencies', icon: 'bi-exclamation-triangle' },
    ],
  },
]

const SECTIONS_COLLAPSED_STORAGE_KEY = 'app.sidebar.sectionsCollapsed.v1'

function sectionKey(title: string) {
  return title.toLowerCase().replace(/\s+/g, '-')
}

function readCollapsedSections(): Set<string> {
  try {
    const raw = localStorage.getItem(SECTIONS_COLLAPSED_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((k): k is string => typeof k === 'string'))
  } catch {
    return new Set()
  }
}

function writeCollapsedSections(collapsed: Set<string>) {
  try {
    localStorage.setItem(SECTIONS_COLLAPSED_STORAGE_KEY, JSON.stringify([...collapsed]))
  } catch {
    // Ignore quota / private mode errors.
  }
}

function isItemActive(pathname: string, item: NavItem) {
  if (item.end) return pathname === item.to
  return pathname === item.to || pathname.startsWith(`${item.to}/`)
}

function navLinkClassName(isActive: boolean, showLabels: boolean, animateLabels: boolean) {
  const classes = ['app-sidebar-link', 'd-flex', 'align-items-center', 'rounded']
  classes.push(showLabels ? 'app-sidebar-link--with-labels' : 'app-sidebar-link--icon-only')
  if (showLabels && animateLabels) {
    classes.push('app-sidebar-link--revealing')
  }
  if (isActive) classes.push('active')
  return classes.join(' ')
}

export function SidebarNav({
  onNavigate,
  idPrefix,
  shellExpanded = true,
  itemsExpanded = true,
  animateLabels = false,
}: {
  onNavigate?: () => void
  idPrefix: string
  shellExpanded?: boolean
  itemsExpanded?: boolean
  animateLabels?: boolean
}) {
  const location = useLocation()
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => readCollapsedSections())
  const showLabels = shellExpanded && itemsExpanded
  const iconOnly = !showLabels

  const toggleSection = useCallback((key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      writeCollapsedSections(next)
      return next
    })
  }, [])

  useEffect(() => {
    for (const section of NAV_SECTIONS) {
      const key = sectionKey(section.title)
      const hasActiveItem = section.items.some((item) => isItemActive(location.pathname, item))
      if (!hasActiveItem) continue
      setCollapsedSections((prev) => {
        if (!prev.has(key)) return prev
        const next = new Set(prev)
        next.delete(key)
        writeCollapsedSections(next)
        return next
      })
      break
    }
  }, [location.pathname])

  return (
    <Nav
      className={`flex-column app-sidebar-nav${
        iconOnly ? ' app-sidebar-nav--icon-only' : ' gap-1 px-2 pb-3 app-sidebar-nav--with-labels'
      }${animateLabels ? ' app-sidebar-nav--revealing' : ''}`}
      as="nav"
    >
      <NavLink
        to="/home"
        end
        className={({ isActive }) => navLinkClassName(isActive, showLabels, animateLabels)}
        onClick={onNavigate}
        id={`${idPrefix}-home`}
        title={iconOnly ? 'Home' : undefined}
        aria-label="Home"
      >
        <span className="app-sidebar-link-icon">
          <i className="bi bi-house-door" aria-hidden />
        </span>
        <span className="app-sidebar-link-label">Home</span>
      </NavLink>
      {NAV_SECTIONS.map((section) => {
        const key = sectionKey(section.title)
        const isSectionCollapsed = showLabels && collapsedSections.has(key)

        return (
        <div
          key={section.title}
          className={
            showLabels ? 'app-sidebar-section' : 'app-sidebar-section app-sidebar-section--icon-only'
          }
        >
          {showLabels ? (
            <button
              type="button"
              className={`app-sidebar-section-toggle px-3 pb-1 small text-uppercase text-muted fw-semibold${
                animateLabels ? ' app-sidebar-section-title--revealing' : ''
              }`}
              aria-expanded={!isSectionCollapsed}
              aria-controls={`${idPrefix}-section-${key}`}
              onClick={() => toggleSection(key)}
            >
              <span className="app-sidebar-section-toggle__label">{section.title}</span>
              <i
                className={`bi ${isSectionCollapsed ? 'bi-chevron-right' : 'bi-chevron-down'} app-sidebar-section-toggle__chevron`}
                aria-hidden
              />
            </button>
          ) : null}
          {!isSectionCollapsed ? (
          <div
            id={`${idPrefix}-section-${key}`}
            className={`app-sidebar-section-items d-flex flex-column${
              showLabels ? ' gap-1' : ' app-sidebar-section-items--icon-only'
            }`}
          >
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => navLinkClassName(isActive, showLabels, animateLabels)}
                onClick={onNavigate}
                id={`${idPrefix}-${item.to.replace(/\//g, '-')}`}
                title={iconOnly ? item.label : undefined}
                aria-label={item.label}
              >
                <span className="app-sidebar-link-icon">
                  <i className={`bi ${item.icon}`} aria-hidden />
                </span>
                <span className="app-sidebar-link-label">{item.label}</span>
              </NavLink>
            ))}
          </div>
          ) : null}
        </div>
        )
      })}
    </Nav>
  )
}
