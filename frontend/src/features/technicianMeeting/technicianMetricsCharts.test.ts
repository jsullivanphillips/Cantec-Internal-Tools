import { describe, expect, it } from 'vitest'
import { aggregateDeficiencyCountsByTech, topTechCountsFromRecord, topTechnicianLeader } from './technicianMetricsCharts'

describe('technicianMetricsCharts', () => {
  it('selects top technicians from a count record', () => {
    expect(
      topTechCountsFromRecord(
        { Alice: 12, Bob: 8, Carol: 20 },
        2,
      ),
    ).toEqual({
      labels: ['Carol', 'Alice'],
      counts: [20, 12],
    })
  })

  it('aggregates deficiency counts by technician', () => {
    expect(
      aggregateDeficiencyCountsByTech(
        [
          { technician: 'Alice', count: 3 },
          { technician: 'Bob', count: 2 },
          { technician: 'Alice', count: 1 },
        ],
        'all',
      ),
    ).toEqual({
      labels: ['Alice', 'Bob'],
      counts: [4, 2],
    })
  })

  it('finds the top technician from count entries', () => {
    expect(
      topTechnicianLeader([
        { technician: 'Bob', count: 8 },
        { technician: 'Alice', count: 12 },
      ]),
    ).toEqual({ technician: 'Alice', count: 12 })
  })
})
