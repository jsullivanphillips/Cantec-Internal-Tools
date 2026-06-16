export type TopN = number | 'all'

export const noDatalabels = { datalabels: { display: false } }

export function formatLabelName(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function buildJobsCompletedDatasets(
  jobsPayload: {
    technicians?: string[]
    job_types?: string[]
    entries?: { technician: string; job_type: string; count: number }[]
  },
  topN: TopN,
) {
  const techsJobs = jobsPayload.technicians || []
  const jobTypes = jobsPayload.job_types || []
  const jobsEntries = jobsPayload.entries || []

  const lookupJobs: Record<string, Record<string, number>> = {}
  techsJobs.forEach((t) => {
    lookupJobs[t] = {}
  })
  jobsEntries.forEach(({ technician, job_type, count }) => {
    if (!lookupJobs[technician]) lookupJobs[technician] = {}
    lookupJobs[technician][job_type] = count
  })

  const totalsJobs = techsJobs
    .map((t) => ({
      tech: t,
      total: jobTypes.reduce((sum, jt) => sum + (lookupJobs[t]?.[jt] || 0), 0),
    }))
    .sort((a, b) => b.total - a.total)

  const N = topN === 'all' ? totalsJobs.length : topN
  const selectedTechsJ = totalsJobs.slice(0, N).map((d) => d.tech)

  const jobTypeTotals = jobTypes.map((jt) => ({
    jobType: jt,
    total: techsJobs.reduce((sum, tech) => sum + (lookupJobs[tech]?.[jt] || 0), 0),
  }))
  jobTypeTotals.sort((a, b) => b.total - a.total)
  const topJobTypes = jobTypeTotals.slice(0, 8).map((x) => x.jobType)
  const otherJobTypes = jobTypes.filter((jt) => !topJobTypes.includes(jt))
  const finalJobTypes = [...topJobTypes, 'Other']

  const paletteJobs = [
    '#c6d6ec',
    '#8eb0d6',
    '#4e79a7',
    '#2d527d',
    '#ffe0b3',
    '#f7b366',
    '#f28e2b',
    '#b6651a',
    '#678dbd',
    '#d1873d',
  ]

  const jobDatasets = finalJobTypes.map((jt, i) => {
    const data = selectedTechsJ.map((tech) => {
      if (jt === 'Other') {
        return otherJobTypes.reduce((sum, other) => sum + (lookupJobs[tech]?.[other] || 0), 0)
      }
      return lookupJobs[tech]?.[jt] || 0
    })
    return {
      label: formatLabelName(jt),
      data,
      type: 'bar' as const,
      backgroundColor: paletteJobs[i % paletteJobs.length],
    }
  })

  const jobTotalsByTech = selectedTechsJ.map((_, idx) =>
    jobDatasets.reduce((sum, ds) => sum + (ds.data[idx] as number), 0),
  )

  const totalJobsDataset = {
    label: 'Total Jobs',
    data: jobTotalsByTech,
    type: 'line' as const,
    yAxisID: 'y1',
    borderColor: '#164b7c',
    backgroundColor: '#164b7c',
    borderWidth: 2,
    fill: false,
    pointRadius: 4,
  }

  return {
    labels: selectedTechsJ,
    datasets: [...jobDatasets, totalJobsDataset],
    jobTotalsByTech,
  }
}

export function buildDefsByTechDatasets(
  payload: {
    technicians?: string[]
    service_lines?: string[]
    entries?: { technician: string; service_line: string; count: number }[]
  },
  topN: TopN,
) {
  const techsDefs = payload.technicians || []
  const rawLines = payload.service_lines || []
  const defsEntries = payload.entries || []

  const lookupDefs: Record<string, Record<string, number>> = {}
  techsDefs.forEach((t) => {
    lookupDefs[t] = {}
  })
  defsEntries.forEach(({ technician, service_line, count }) => {
    if (!lookupDefs[technician]) lookupDefs[technician] = {}
    lookupDefs[technician][service_line] = count
  })

  const lineTotals = rawLines
    .map((sl) => ({
      line: sl,
      total: techsDefs.reduce((sum, t) => sum + (lookupDefs[t]?.[sl] || 0), 0),
    }))
    .sort((a, b) => b.total - a.total)
  const topLines = lineTotals.slice(0, 6).map((x) => x.line)
  const otherLines = rawLines.filter((sl) => !topLines.includes(sl))
  const finalLines = [...topLines, 'Other']

  const paletteDefs = [
    '#c6d6ec',
    '#8eb0d6',
    '#4e79a7',
    '#2d527d',
    '#ffe0b3',
    '#f7b366',
    '#f28e2b',
    '#b6651a',
    '#678dbd',
    '#d1873d',
  ]

  const defDatasets = finalLines.map((sl, idx) => {
    const data = techsDefs.map((tech) => {
      if (sl === 'Other') {
        return otherLines.reduce((sum, ol) => sum + (lookupDefs[tech]?.[ol] || 0), 0)
      }
      return lookupDefs[tech]?.[sl] || 0
    })
    return {
      label: sl,
      data,
      backgroundColor: paletteDefs[idx % paletteDefs.length],
    }
  })

  const totalsDefs = techsDefs
    .map((t) => ({
      tech: t,
      total: finalLines.reduce((sum, _sl, si) => {
        const ds = defDatasets[si]
        const idx = techsDefs.indexOf(t)
        return sum + (ds.data[idx] as number)
      }, 0),
    }))
    .sort((a, b) => b.total - a.total)

  const N = topN === 'all' ? totalsDefs.length : topN
  const selectedTechsD = totalsDefs.slice(0, N).map((d) => d.tech)

  const barDatasets = defDatasets.map((ds) => ({
    label: ds.label,
    data: selectedTechsD.map((tech) => ds.data[techsDefs.indexOf(tech)] as number),
    type: 'bar' as const,
    backgroundColor: ds.backgroundColor,
  }))

  const defTotalsByTech = selectedTechsD.map((_, i) =>
    barDatasets.reduce((sum, ds) => sum + (ds.data[i] as number), 0),
  )

  const totalDefsDataset = {
    label: 'Total Defs',
    data: defTotalsByTech,
    type: 'line' as const,
    yAxisID: 'y1',
    borderColor: '#164b7c',
    backgroundColor: '#164b7c',
    borderWidth: 2,
    fill: false,
    pointRadius: 4,
  }

  return { labels: selectedTechsD, datasets: [...barDatasets, totalDefsDataset], defTotalsByTech }
}
