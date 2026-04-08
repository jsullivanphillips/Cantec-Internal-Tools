/** Mirrors `static/js/scheduling_attack.js` `render()` stacking rules for `/scheduling_attack/metrics`. */

export type YearBucket = {
  recurring_fa_hours?: number[]
  recurring_spr_hours?: number[]
  nonrecurring_fa_hours?: number[]
  nonrecurring_spr_hours?: number[]
  recurring_fa_jobs?: number[]
  recurring_spr_jobs?: number[]
  nonrecurring_fa_jobs?: number[]
  nonrecurring_spr_jobs?: number[]
}

export type MetricsPayload = {
  labels?: string[]
  year?: number
  prev_year?: number
  cur?: YearBucket
  prev?: YearBucket
  monthly_available_hours?: Record<string, number>
  num_active_techs?: number
}

const COLORS = {
  recFA: '0,123,255',
  recSPR: '40,167,69',
  nonFA: '255,159,64',
  nonSPR: '111,66,193',
  prevA: 0.35,
  currA: 0.8,
}

const fill = (rgb: string, a: number) => `rgba(${rgb},${a})`
const stroke = (rgb: string) => `rgba(${rgb},1)`

function normalizeToFullMonth(label: string | null | undefined): string | null {
  if (label == null) return null
  const s = String(label).trim()
  const m = s.match(/^(\d{4})[-/](\d{1,2})$/)
  if (m) {
    const n = Number(m[2])
    const names = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ]
    return names[n - 1] || null
  }
  return null
}

export function buildCapacitySeries(
  labels: string[],
  monthlyAvailableDict: Record<string, number> | undefined,
): (number | null)[] {
  return labels.map((lbl) => {
    const monthFull = normalizeToFullMonth(lbl) || lbl
    const val = monthlyAvailableDict?.[monthFull]
    return val ?? null
  })
}

export function maskByRule(
  srcArr: number[] | undefined,
  which: 'prev' | 'curr',
  currentMonth: number,
): (number | null)[] {
  return (srcArr || []).map((val, i) => {
    const monthNum = i + 1
    const v = val ?? 0
    if (monthNum < currentMonth) {
      return which === 'curr' ? v : null
    }
    if (monthNum > currentMonth) {
      return which === 'prev' ? v : null
    }
    return v
  })
}

export function buildHoursDatasets(
  data: MetricsPayload,
  includeTravel: boolean,
  currentMonth: number,
) {
  const labels = data.labels || []
  const cur = data.cur || {}
  const prev = data.prev || {}

  const hoursDatasets = [
    {
      label: 'Prev Year Rec FA (hrs)',
      data: maskByRule(prev.recurring_fa_hours, 'prev', currentMonth),
      stack: 'prev',
      backgroundColor: fill(COLORS.recFA, COLORS.prevA),
      borderColor: stroke(COLORS.recFA),
      borderWidth: 1,
    },
    {
      label: 'Prev Year Rec SPR (hrs)',
      data: maskByRule(prev.recurring_spr_hours, 'prev', currentMonth),
      stack: 'prev',
      backgroundColor: fill(COLORS.recSPR, COLORS.prevA),
      borderColor: stroke(COLORS.recSPR),
      borderWidth: 1,
    },
    {
      label: 'Prev Year Nonrec FA (hrs)',
      data: maskByRule(prev.nonrecurring_fa_hours, 'prev', currentMonth),
      stack: 'prev',
      backgroundColor: fill(COLORS.nonFA, COLORS.prevA),
      borderColor: stroke(COLORS.nonFA),
      borderWidth: 1,
    },
    {
      label: 'Prev Year Nonrec SPR (hrs)',
      data: maskByRule(prev.nonrecurring_spr_hours, 'prev', currentMonth),
      stack: 'prev',
      backgroundColor: fill(COLORS.nonSPR, COLORS.prevA),
      borderColor: stroke(COLORS.nonSPR),
      borderWidth: 1,
    },
    {
      label: 'Current Year Rec FA (hrs)',
      data: maskByRule(cur.recurring_fa_hours, 'curr', currentMonth),
      stack: 'curr',
      backgroundColor: fill(COLORS.recFA, COLORS.currA),
      borderColor: stroke(COLORS.recFA),
      borderWidth: 1,
    },
    {
      label: 'Current Year Rec SPR (hrs)',
      data: maskByRule(cur.recurring_spr_hours, 'curr', currentMonth),
      stack: 'curr',
      backgroundColor: fill(COLORS.recSPR, COLORS.currA),
      borderColor: stroke(COLORS.recSPR),
      borderWidth: 1,
    },
    {
      label: 'Current Year Nonrec FA (hrs)',
      data: maskByRule(cur.nonrecurring_fa_hours, 'curr', currentMonth),
      stack: 'curr',
      backgroundColor: fill(COLORS.nonFA, COLORS.currA),
      borderColor: stroke(COLORS.nonFA),
      borderWidth: 1,
    },
    {
      label: 'Current Year Nonrec SPR (hrs)',
      data: maskByRule(cur.nonrecurring_spr_hours, 'curr', currentMonth),
      stack: 'curr',
      backgroundColor: fill(COLORS.nonSPR, COLORS.currA),
      borderColor: stroke(COLORS.nonSPR),
      borderWidth: 1,
    },
  ]

  const capacityByMonth = buildCapacitySeries(labels, data.monthly_available_hours)
  const capacityDataset = {
    type: 'line' as const,
    label: 'Available Tech Hours',
    data: capacityByMonth,
    borderWidth: 2,
    borderColor: 'rgba(220,53,69,1)',
    backgroundColor: 'rgba(220,53,69,0.1)',
    borderDash: [6, 4] as number[],
    pointRadius: 0,
    tension: 0.3,
    fill: false,
    yAxisID: 'y',
    order: 0,
    spanGaps: true,
  }

  void includeTravel // API already applied; label only in UI

  return { labels, hoursDatasets, capacityByMonth, capacityDataset }
}

export function buildJobsDatasets(data: MetricsPayload, currentMonth: number) {
  const labels = data.labels || []
  const cur = data.cur || {}
  const prev = data.prev || {}
  const jobsDatasets = [
    {
      label: 'Prev Year Rec FA (jobs)',
      data: maskByRule(prev.recurring_fa_jobs, 'prev', currentMonth),
      stack: 'prev',
      backgroundColor: fill(COLORS.recFA, COLORS.prevA),
      borderColor: stroke(COLORS.recFA),
      borderWidth: 1,
    },
    {
      label: 'Prev Year Rec SPR (jobs)',
      data: maskByRule(prev.recurring_spr_jobs, 'prev', currentMonth),
      stack: 'prev',
      backgroundColor: fill(COLORS.recSPR, COLORS.prevA),
      borderColor: stroke(COLORS.recSPR),
      borderWidth: 1,
    },
    {
      label: 'Prev Year Nonrec FA (jobs)',
      data: maskByRule(prev.nonrecurring_fa_jobs, 'prev', currentMonth),
      stack: 'prev',
      backgroundColor: fill(COLORS.nonFA, COLORS.prevA),
      borderColor: stroke(COLORS.nonFA),
      borderWidth: 1,
    },
    {
      label: 'Prev Year Nonrec SPR (jobs)',
      data: maskByRule(prev.nonrecurring_spr_jobs, 'prev', currentMonth),
      stack: 'prev',
      backgroundColor: fill(COLORS.nonSPR, COLORS.prevA),
      borderColor: stroke(COLORS.nonSPR),
      borderWidth: 1,
    },
    {
      label: 'Current Year Rec FA (jobs)',
      data: maskByRule(cur.recurring_fa_jobs, 'curr', currentMonth),
      stack: 'curr',
      backgroundColor: fill(COLORS.recFA, COLORS.currA),
      borderColor: stroke(COLORS.recFA),
      borderWidth: 1,
    },
    {
      label: 'Current Year Rec SPR (jobs)',
      data: maskByRule(cur.recurring_spr_jobs, 'curr', currentMonth),
      stack: 'curr',
      backgroundColor: fill(COLORS.recSPR, COLORS.currA),
      borderColor: stroke(COLORS.recSPR),
      borderWidth: 1,
    },
    {
      label: 'Current Year Nonrec FA (jobs)',
      data: maskByRule(cur.nonrecurring_fa_jobs, 'curr', currentMonth),
      stack: 'curr',
      backgroundColor: fill(COLORS.nonFA, COLORS.currA),
      borderColor: stroke(COLORS.nonFA),
      borderWidth: 1,
    },
    {
      label: 'Current Year Nonrec SPR (jobs)',
      data: maskByRule(cur.nonrecurring_spr_jobs, 'curr', currentMonth),
      stack: 'curr',
      backgroundColor: fill(COLORS.nonSPR, COLORS.currA),
      borderColor: stroke(COLORS.nonSPR),
      borderWidth: 1,
    },
  ]
  return { labels, jobsDatasets }
}
