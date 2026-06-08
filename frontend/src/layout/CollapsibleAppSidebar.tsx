import { SidebarNav } from './SidebarNav'
import { useCollapsibleAppSidebar } from './useCollapsibleAppSidebar'

export default function CollapsibleAppSidebar({ idPrefix }: { idPrefix: string }) {
  const { navExpanded, setNavExpanded, navItemsExpanded, navLabelsAnimating } =
    useCollapsibleAppSidebar()

  return (
    <aside
      className={`app-sidebar d-none d-lg-grid${
        navExpanded ? ' app-sidebar--expanded' : ' app-sidebar--collapsed'
      }`}
    >
      <div
        className={`app-sidebar__inner${
          navItemsExpanded ? ' app-sidebar__inner--expanded' : ' app-sidebar__inner--collapsed'
        }`}
      >
        <SidebarNav
          idPrefix={idPrefix}
          shellExpanded={navExpanded}
          itemsExpanded={navItemsExpanded}
          animateLabels={navLabelsAnimating}
        />
      </div>
      <button
        type="button"
        className="app-sidebar-toggle"
        aria-expanded={navExpanded}
        onClick={() => setNavExpanded((v) => !v)}
      >
        <i
          className={`bi ${navExpanded ? 'bi-chevron-double-left' : 'bi-chevron-double-right'}`}
          aria-hidden
        />
        {navItemsExpanded ? (
          <span
            className={`app-sidebar-toggle-label${
              navLabelsAnimating ? ' app-sidebar-toggle-label--revealing' : ''
            }`}
          >
            Collapse menu
          </span>
        ) : null}
      </button>
    </aside>
  )
}
