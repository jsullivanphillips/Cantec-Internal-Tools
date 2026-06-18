import { Table } from 'react-bootstrap'
import {
  ANNUAL_COLUMN_STYLE,
  DIRECTORY_COLUMN_WIDTHS,
  KEYS_COLUMN_STYLE,
  LIBRARY_TABLE_HEADER_STICKY_STYLE,
  STATUS_COLUMN_STYLE,
} from './monthlyDirectoryTableShared'

const SKELETON_ROW_COUNT = 10

const LOCATION_BAR_WIDTHS = ['78%', '88%', '70%', '92%', '66%'] as const
const PROPERTY_BAR_WIDTHS = ['82%', '68%', '90%', '74%', '61%'] as const
const KEY_BAR_WIDTHS = ['3.5rem', '4rem', '3.25rem', '3.75rem', '3.5rem'] as const
const ANNUAL_BAR_WIDTHS = ['3.25rem', '3.75rem', '3rem', '3.5rem', '3.25rem'] as const

function SkeletonBar({
  width,
  height = '0.65rem',
  className = 'd-block',
  pill = true,
}: {
  width: string
  height?: string
  className?: string
  pill?: boolean
}) {
  return (
    <span
      className={`home-skeleton-bar ${className}`.trim()}
      style={{
        width,
        height,
        borderRadius: pill ? undefined : '0.35rem',
      }}
    />
  )
}

function SkeletonStatusDot() {
  return (
    <span
      className="home-skeleton-bar d-inline-block"
      style={{ width: '0.62rem', height: '0.62rem', borderRadius: '50%' }}
    />
  )
}

export default function MonthlyLocationsTableSkeleton() {
  return (
    <div className="home-skeleton" aria-busy="true" aria-label="Loading locations">
      <Table
        striped
        className="align-middle monthly-routes-library-table monthly-locations-directory-table mb-0"
      >
        <colgroup>
          <col style={{ width: DIRECTORY_COLUMN_WIDTHS.status }} />
          <col style={{ width: DIRECTORY_COLUMN_WIDTHS.route }} />
          <col style={{ width: DIRECTORY_COLUMN_WIDTHS.address }} />
          <col style={{ width: DIRECTORY_COLUMN_WIDTHS.tags }} />
          <col style={{ width: DIRECTORY_COLUMN_WIDTHS.property }} />
          <col style={{ width: DIRECTORY_COLUMN_WIDTHS.key }} />
          <col style={{ width: DIRECTORY_COLUMN_WIDTHS.annual }} />
        </colgroup>
        <thead>
          <tr>
            <th
              className="text-center monthly-locations-table__status-col"
              style={{ ...STATUS_COLUMN_STYLE, ...LIBRARY_TABLE_HEADER_STICKY_STYLE }}
            >
              Status
            </th>
            <th
              className="monthly-locations-table__route-col"
              style={LIBRARY_TABLE_HEADER_STICKY_STYLE}
            >
              Route
            </th>
            <th
              className="monthly-locations-table__label-col"
              style={LIBRARY_TABLE_HEADER_STICKY_STYLE}
            >
              Location
            </th>
            <th
              className="monthly-locations-table__tags-col"
              style={LIBRARY_TABLE_HEADER_STICKY_STYLE}
            >
              Tags
            </th>
            <th style={LIBRARY_TABLE_HEADER_STICKY_STYLE}>Property Management</th>
            <th
              className="text-center"
              style={{ ...KEYS_COLUMN_STYLE, ...LIBRARY_TABLE_HEADER_STICKY_STYLE }}
            >
              Key
            </th>
            <th
              className="text-center"
              style={{ ...ANNUAL_COLUMN_STYLE, ...LIBRARY_TABLE_HEADER_STICKY_STYLE }}
            >
              Annual
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: SKELETON_ROW_COUNT }, (_, rowIndex) => (
            <tr key={rowIndex}>
              <td className="text-center monthly-locations-table__status-col" style={STATUS_COLUMN_STYLE}>
                <SkeletonStatusDot />
              </td>
              <td className="monthly-locations-table__route-col">
                <SkeletonBar width="2.25rem" height="0.6rem" />
                <SkeletonBar
                  width="2.75rem"
                  height="0.5rem"
                  className="d-block mt-1"
                />
              </td>
              <td className="monthly-locations-table__label-col">
                <SkeletonBar width={LOCATION_BAR_WIDTHS[rowIndex % LOCATION_BAR_WIDTHS.length]} />
              </td>
              <td className="monthly-locations-table__tags-col">
                <div className="d-flex align-items-center gap-1 flex-nowrap">
                  {rowIndex % 3 !== 2 ? (
                    <SkeletonBar width="2.75rem" height="1.1rem" pill />
                  ) : null}
                  {rowIndex % 2 === 0 ? (
                    <SkeletonBar width="2.25rem" height="1.1rem" pill />
                  ) : null}
                </div>
              </td>
              <td>
                <SkeletonBar width={PROPERTY_BAR_WIDTHS[rowIndex % PROPERTY_BAR_WIDTHS.length]} />
              </td>
              <td className="text-center" style={KEYS_COLUMN_STYLE}>
                <SkeletonBar
                  width={KEY_BAR_WIDTHS[rowIndex % KEY_BAR_WIDTHS.length]}
                  className="d-inline-block"
                />
              </td>
              <td className="text-center" style={ANNUAL_COLUMN_STYLE}>
                <SkeletonBar
                  width={ANNUAL_BAR_WIDTHS[rowIndex % ANNUAL_BAR_WIDTHS.length]}
                  className="d-inline-block"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}
