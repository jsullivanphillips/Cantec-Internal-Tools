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
    title: 'Data',
    items: [
      { to: '/monthly_specialist', label: 'Monthly Specialists', icon: 'bi-people' },
      { to: '/performance_summary', label: 'Performance Summary', icon: 'bi-pie-chart' },
      { to: '/deficiency_tracker', label: 'Deficiencies', icon: 'bi-exclamation-triangle' },
    ],
  },
]

function navLinkClassName({ isActive }: { isActive: boolean }) {
  return `app-sidebar-link d-flex align-items-center gap-2 px-3 py-2 rounded${isActive ? ' active' : ''}`
}

export function SidebarNav({
  onNavigate,
  idPrefix,
}: {
  onNavigate?: () => void
  idPrefix: string
}) {
  return (
    <Nav className="flex-column gap-1 px-2 pb-3" as="nav">
      <NavLink
        to="/home"
        end
        className={navLinkClassName}
        onClick={onNavigate}
        id={`${idPrefix}-home`}
      >
        <i className="bi bi-house-door" aria-hidden />
        Home
      </NavLink>
      {NAV_SECTIONS.map((section) => (
        <div key={section.title} className="mt-3">
          <div className="app-sidebar-section-title px-3 pb-1 small text-uppercase text-muted fw-semibold">
            {section.title}
          </div>
          <div className="app-sidebar-section-items d-flex flex-column gap-1">
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={navLinkClassName}
                onClick={onNavigate}
                id={`${idPrefix}-${item.to.replace(/\//g, '-')}`}
              >
                <i className={`bi ${item.icon}`} aria-hidden />
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </Nav>
  )
}
