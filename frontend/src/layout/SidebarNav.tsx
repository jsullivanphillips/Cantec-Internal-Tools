import { NavLink } from 'react-router-dom'
import { Nav } from 'react-bootstrap'

type NavItem = { to: string; label: string; icon: string; end?: boolean }
type NavSection = { title: string; items: NavItem[] }

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Status',
    items: [
      { to: '/processing_attack', label: 'Jobs Backlog', icon: 'bi-speedometer2' },
      { to: '/scheduling_attack', label: 'Scheduling Attack', icon: 'bi-graph-up-arrow' },
    ],
  },
  {
    title: 'Tools',
    items: [
      { to: '/keys', label: 'Keys', icon: 'bi-key', end: true },
      { to: '/find_schedule', label: 'Scheduling Assistant', icon: 'bi-calendar2-check' },
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
      { to: '/monthlies/specialists', label: 'Specialists', icon: 'bi-people' },
      { to: '/monthlies/monitoring-companies', label: 'Monitoring companies', icon: 'bi-telephone' },
    ],
  },
  {
    title: 'Data',
    items: [
      { to: '/performance_summary', label: 'Performance Summary', icon: 'bi-pie-chart' },
      { to: '/deficiency_tracker', label: 'Deficiencies', icon: 'bi-exclamation-triangle' },
    ],
  },
]

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
  const showLabels = shellExpanded && itemsExpanded
  const iconOnly = !showLabels

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
      {NAV_SECTIONS.map((section) => (
        <div
          key={section.title}
          className={
            showLabels ? 'app-sidebar-section' : 'app-sidebar-section app-sidebar-section--icon-only'
          }
        >
          {showLabels ? (
            <div
              className={`app-sidebar-section-title px-3 pb-1 small text-uppercase text-muted fw-semibold${
                animateLabels ? ' app-sidebar-section-title--revealing' : ''
              }`}
            >
              {section.title}
            </div>
          ) : null}
          <div
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
        </div>
      ))}
    </Nav>
  )
}
