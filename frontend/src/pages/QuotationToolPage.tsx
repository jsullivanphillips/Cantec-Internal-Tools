import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  ListGroup,
  Row,
  Tab,
  Tabs,
} from 'react-bootstrap'

const SAVED_QUOTES_KEY = 'scheduleAssist.quotationTool.savedQuotes.v1'

const travelProfiles = {
  crd: { label: 'Within CRD' },
  outsideCrd: { label: 'Outside CRD' },
} as const

const serviceTypeOptions = {
  recurringFireAlarm: { label: 'Fire Alarm (Recurring Service)', rateKey: 'recurringFireAlarmRate', minimumMinutes: 60, reportProcessingHours: 0 },
  fireAlarmService: { label: 'Fire Alarm (Service)', rateKey: 'fireAlarmServiceRate', minimumMinutes: 60, reportProcessingHours: 0 },
  sprinklerAnnual: { label: 'Sprinkler (Annual)', rateKey: 'sprinklerAnnualRate', minimumMinutes: 60, reportProcessingHours: 0 },
  sprinklerService: { label: 'Sprinkler (Service)', rateKey: 'sprinklerServiceRate', minimumMinutes: 60, reportProcessingHours: 0 },
  verification: { label: 'Verifications', rateKey: 'verificationRate', minimumMinutes: 120, reportProcessingHours: 1 },
} as const

const inspectionCategories = [
  'Fire Alarm Panel',
  'Annunciator',
  'Indicating Devices',
  'Signalling Equipment',
  'Auxiliary Equipment',
  'Other Equipment',
  'Passive Devices',
  'Sprinkler System',
  'Interval Testing',
  'Backflows',
] as const

type InspectionCategory = (typeof inspectionCategories)[number]
type ActiveTab = 'inspection' | 'service' | 'verification'
type TravelProfile = keyof typeof travelProfiles
type ServiceTypeKey = keyof typeof serviceTypeOptions
type BackflowMode = 'service' | 'annual'

type InspectionItem = { key: string; label: string; minutes: number; category: InspectionCategory }
type ServiceItem = { key: string; label: string; minutes: number; note: string }

type SettingsState = {
  annualInspectionRate: number
  recurringFireAlarmRate: number
  fireAlarmServiceRate: number
  sprinklerAnnualRate: number
  sprinklerServiceRate: number
  verificationRate: number
  adminBufferMinutes: number
  setupBufferMinutes: number
  travelProfile: TravelProfile
  customTravelMinutes: number
  estimatedRoundTripKm: number
  inspectionTechnicians: number
  fireAlarmTechnicians: number
  sprinklerTechnicians: number
  miscCost: number
  truckChargeCrd: number
  hydrantFixedPrice: number
  backflowAnnualFixedPrice: number
  backflowServiceFirstPrice: number
  backflowServiceAdditionalPrice: number
  fiveYearFdcOnlyFixedPrice: number
  fiveYearFdcStandpipeFixedPrice: number
}

type ServiceMeta = { serviceType: ServiceTypeKey; backflowMode: BackflowMode }
type SavedQuoteSnapshot = {
  activeTab: ActiveTab
  quoteAddresses: Record<ActiveTab, string>
  inspectionCounts: Record<string, number>
  serviceCounts: Record<string, number>
  serviceMeta: ServiceMeta
  inspectionItems: InspectionItem[]
  settings: SettingsState
  itemNotes: Record<string, string>
}

type SavedQuote = {
  id: number
  template: string
  address: string
  total: number
  savedAt: string
  snapshot: SavedQuoteSnapshot
}

const inspectionCategoryGroups: { key: string; label: string; categories: InspectionCategory[] }[] = [
  { key: 'fireAlarmSystem', label: 'Fire Alarm System', categories: ['Fire Alarm Panel', 'Annunciator', 'Indicating Devices', 'Signalling Equipment', 'Auxiliary Equipment', 'Passive Devices'] },
  { key: 'otherEquipment', label: 'Other Equipment', categories: ['Other Equipment'] },
  { key: 'sprinklerSystems', label: 'Sprinkler Systems', categories: ['Sprinkler System', 'Interval Testing', 'Backflows'] },
]

const initialInspectionItems: InspectionItem[] = [
  { key: 'controlUnits', label: 'Control Units', minutes: 30, category: 'Fire Alarm Panel' },
  { key: 'nodes', label: 'Nodes', minutes: 30, category: 'Fire Alarm Panel' },
  { key: 'boosters', label: 'Boosters', minutes: 15, category: 'Fire Alarm Panel' },
  { key: 'addressablePanels', label: 'Addressable', minutes: 30, category: 'Fire Alarm Panel' },
  { key: 'annunciator4to8', label: 'Annunciator 4 - 8 Zone', minutes: 15, category: 'Annunciator' },
  { key: 'annunciator8to12', label: 'Annunciator 8 - 12 Zone', minutes: 30, category: 'Annunciator' },
  { key: 'annunciator12to20', label: 'Annunciator 12 - 20 Zone', minutes: 45, category: 'Annunciator' },
  { key: 'annunciator20to40', label: 'Annunciator 20 - 40 Zone', minutes: 60, category: 'Annunciator' },
  { key: 'remoteTrouble', label: 'Remote Trouble', minutes: 5, category: 'Annunciator' },
  { key: 'heatDetectors', label: 'Heat Detectors', minutes: 4, category: 'Indicating Devices' },
  { key: 'smokeDetectors', label: 'Smoke Detectors', minutes: 5, category: 'Indicating Devices' },
  { key: 'pullStations', label: 'Pull Stations', minutes: 2, category: 'Indicating Devices' },
  { key: 'twoStagePullStations', label: 'Two-Stage Pull Stations', minutes: 2.5, category: 'Indicating Devices' },
  { key: 'sprinklerSwitches', label: 'Sprinkler Switch', minutes: 3, category: 'Indicating Devices' },
  { key: 'ductSmoke', label: 'Duct Smoke', minutes: 30, category: 'Indicating Devices' },
  { key: 'signalCombined', label: 'Horns, Strobes, & Bells', minutes: 2, category: 'Signalling Equipment' },
  { key: 'monitoring', label: 'Monitoring', minutes: 15, category: 'Auxiliary Equipment' },
  { key: 'fanShutdowns', label: 'Fan Shutdowns', minutes: 10, category: 'Auxiliary Equipment' },
  { key: 'doorHolders', label: 'Door Holders', minutes: 2, category: 'Auxiliary Equipment' },
  { key: 'elevatorShaft', label: 'Elevator Shaft', minutes: 10, category: 'Auxiliary Equipment' },
  { key: 'elevatorHoming', label: 'Elevator Homing', minutes: 30, category: 'Auxiliary Equipment' },
  { key: 'kitchenHood', label: 'Kitchen Hood Suppression System', minutes: 10, category: 'Auxiliary Equipment' },
  { key: 'firePump', label: 'Fire Pump', minutes: 20, category: 'Auxiliary Equipment' },
  { key: 'hoses', label: 'Hoses', minutes: 8, category: 'Other Equipment' },
  { key: 'extinguishers', label: 'Extinguishers', minutes: 3, category: 'Other Equipment' },
  { key: 'emergencyLightingSelfContained', label: 'Emergency Lighting - Self-Contained', minutes: 3, category: 'Other Equipment' },
  { key: 'emergencyLightingMultiHead', label: 'Emergency Lighting - Control with Multi-Heads', minutes: 5, category: 'Other Equipment' },
  { key: 'otherSmokeAlarms', label: 'Smoke Alarms', minutes: 2, category: 'Other Equipment' },
  { key: 'passiveDevices', label: 'Passive Devices', minutes: 0.5, category: 'Passive Devices' },
  { key: 'standpipeFdcOnly', label: 'Standpipe / FDC Only', minutes: 90, category: 'Sprinkler System' },
  { key: 'drypipeValves', label: 'Drypipe Valves', minutes: 30, category: 'Sprinkler System' },
  { key: 'wetValves', label: 'Wet Valves', minutes: 10, category: 'Sprinkler System' },
  { key: 'sprinklerTampers', label: 'Tampers', minutes: 2, category: 'Sprinkler System' },
  { key: 'sprinklerCompressors', label: 'Compressors', minutes: 20, category: 'Sprinkler System' },
  { key: 'glycolSystems', label: 'Glycol Systems', minutes: 120, category: 'Sprinkler System' },
  { key: 'fireZones', label: '# of Fire Zones (Common Area Sprinkler Head Inspection)', minutes: 10, category: 'Sprinkler System' },
  { key: 'fireHydrants', label: 'Fire Hydrants', minutes: 60, category: 'Sprinkler System' },
  { key: 'sprinkler3YearTripTest', label: '3-Year Full Trip Test', minutes: 90, category: 'Interval Testing' },
  { key: 'sprinkler5YearFdcOnly', label: '5-Year FDC Only', minutes: 180, category: 'Interval Testing' },
  { key: 'sprinkler5YearFdcStandpipe', label: '5-Year FDC and Standpipe', minutes: 330, category: 'Interval Testing' },
  { key: 'sprinklerBackflowsAnnual', label: 'Backflows (Annual)', minutes: 30, category: 'Backflows' },
  { key: 'sprinklerBackflowsService', label: 'Backflows (Outside Annual)', minutes: 30, category: 'Backflows' },
]

const initialServiceItems: ServiceItem[] = [
  { key: 'smokeDetector', label: 'Smoke Detector', minutes: 30, note: '15 min x 2 techs or 30 min x 1 tech' },
  { key: 'heatDetector', label: 'Heat Detector', minutes: 30, note: '15 min x 2 techs or 30 min x 1 tech' },
  { key: 'pullStation', label: 'Pull Station', minutes: 30, note: '15 min x 2 techs or 30 min x 1 tech' },
  { key: 'hornBuzzerPiezo', label: 'Horn / Buzzer / Piezo', minutes: 30, note: '15 min x 2 techs' },
  { key: 'bell', label: 'Bell', minutes: 60, note: '30 min x 2 techs' },
  { key: 'ductSmokeDetector', label: 'Duct Smoke Detector', minutes: 90, note: 'Varies from 30 min to 3 hrs' },
  { key: 'panelBatteriesInspection', label: 'Panel Batteries during Inspection', minutes: 15, note: '15 minutes' },
  { key: 'panelBatteriesRepair', label: 'Panel Batteries during Repairs', minutes: 30, note: '30 minutes including bell ring and measurements' },
  { key: 'smokeAlarm', label: 'Smoke Alarm', minutes: 15, note: '15 minutes each' },
  { key: 'emergencyLightBatteryTypical', label: 'Emergency Light Battery - Typical', minutes: 15, note: '15 minutes' },
  { key: 'emergencyLightBatteryDifficult', label: 'Emergency Light Battery - Difficult', minutes: 30, note: '30 minutes' },
  { key: 'exitSignBattery', label: 'Exit Sign Battery', minutes: 10, note: '10 minutes' },
  { key: 'newCmpbe', label: 'New CM-PB-E', minutes: 30, note: '30 minutes' },
  { key: 'newRemoteElu', label: 'New Remote ELU', minutes: 90, note: '1.5 hours' },
  { key: 'newExit', label: 'New Exit', minutes: 30, note: '30 minutes' },
  { key: 'newLightHead', label: 'New Light Head', minutes: 15, note: '15 minutes' },
  { key: 'fireExtinguishers', label: 'Fire Extinguishers', minutes: 7.5, note: '2 extinguishers per 15 minutes' },
  { key: 'fireExtinguisherMounting', label: 'Fire Extinguisher + Mounting', minutes: 15, note: '1 extinguisher per 15 minutes' },
  { key: 'fireExtinguisherCabinet', label: 'Fire Extinguisher Cabinet', minutes: 30, note: '30 min first, 15 min each additional' },
  { key: 'fireHose', label: 'Fire Hose', minutes: 15, note: '15 minutes' },
  { key: 'compressor', label: 'Compressor', minutes: 270, note: 'Specialized review item' },
  { key: 'testing3YearSprinkler', label: '3 Year Testing - Sprinkler', minutes: 90, note: '1.5 hrs + 1 hr per additional dry pipe valve' },
  { key: 'testing5YearSprinkler', label: '5 Year Testing - Sprinkler', minutes: 330, note: 'Class-based review item' },
  { key: 'backflowTesting', label: 'Back Flow Testing', minutes: 45, note: 'Uses special pricing rules' },
  { key: 'backflowRepair', label: 'Back Flow Repair', minutes: 60, note: 'Review required' },
  { key: 'backflowRepairCheckValve', label: 'Back Flow Repair - Check Valve', minutes: 240, note: '3 hrs plus extra buffer included' },
  { key: 'sprinklerHeadReplacement', label: 'Sprinkler Head Replacement', minutes: 30, note: 'Requires FA tech to silence / disconnect bells' },
  { key: 'escutcheonReplacement', label: 'Escutcheon Replacement', minutes: 10, note: 'Quoted at 10 min each' },
  { key: 'isolationValveReplacement', label: 'Isolation Valve Replacement', minutes: 120, note: '2 hrs with electrician or experienced FA tech' },
  { key: 'hydrantFlowTesting', label: 'Hydrant Flow Testing', minutes: 60, note: '1 hour per hydrant' },
  { key: 'quarterlySprinklerTesting', label: 'Quarterly Sprinkler Testing', minutes: 90, note: 'Typical 6-storey building' },
  { key: 'semiAnnualSprinklerTesting', label: 'Semi-Annual Sprinkler Testing', minutes: 120, note: 'Typical 6-storey building' },
  { key: 'winterization', label: 'Winterization', minutes: 30, note: '30 min setup + 10 min per low point' },
]

const defaultSettings = (): SettingsState => ({
  annualInspectionRate: 95,
  recurringFireAlarmRate: 110,
  fireAlarmServiceRate: 125,
  sprinklerAnnualRate: 125,
  sprinklerServiceRate: 145,
  verificationRate: 125,
  adminBufferMinutes: 30,
  setupBufferMinutes: 20,
  travelProfile: 'crd',
  customTravelMinutes: 0,
  estimatedRoundTripKm: 0,
  inspectionTechnicians: 1,
  fireAlarmTechnicians: 1,
  sprinklerTechnicians: 0,
  miscCost: 0,
  truckChargeCrd: 24.95,
  hydrantFixedPrice: 150,
  backflowAnnualFixedPrice: 70,
  backflowServiceFirstPrice: 145,
  backflowServiceAdditionalPrice: 70,
  fiveYearFdcOnlyFixedPrice: 525,
  fiveYearFdcStandpipeFixedPrice: 975,
})

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(Math.round(Number(value || 0)))
}

function formatHours(minutes: number) {
  return `${(Number(minutes || 0) / 60).toFixed(2)} hrs`
}

function roundQuarterDay(days: number) {
  return Math.ceil(Number(days || 0) * 4) / 4
}

function formatDays(days: number) {
  return `${roundQuarterDay(days).toFixed(2)} days`
}

function buildInspectionCounts(items: InspectionItem[]) {
  return Object.fromEntries(items.map((item) => [item.key, 0]))
}

function buildServiceCounts(items: ServiceItem[]) {
  return Object.fromEntries([...items.map((item) => [item.key, 0]), ['winterizationLowPoints', 0], ['additionalDryPipeValves', 0]])
}

function NumberField({ label, value, onChange, disabled = false, step = '1', helper }: { label: string; value: number; onChange: (value: number) => void; disabled?: boolean; step?: string; helper?: string }) {
  return (
    <Form.Group>
      <Form.Label className="quotation-tool__field-label">{label}</Form.Label>
      <Form.Control type="number" min={0} step={step} disabled={disabled} value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value || 0)))} />
      {helper ? <div className="quotation-tool__helper-text">{helper}</div> : null}
    </Form.Group>
  )
}

function SummaryRow({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`quotation-tool__summary-row${bold ? ' quotation-tool__summary-row--bold' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

function serviceItemTotalMinutes(key: string, minutes: number, counts: Record<string, number>) {
  const qty = Number(counts[key] || 0)
  if (key === 'fireExtinguisherCabinet') return qty <= 0 ? 0 : 30 + Math.max(0, qty - 1) * 15
  if (key === 'winterization') return qty * 30 + Number(counts.winterizationLowPoints || 0) * 10
  if (key === 'testing3YearSprinkler') {
    return qty * 90 + Number(counts.additionalDryPipeValves || 0) * 60
  }
  return Math.round(qty * minutes)
}

export default function QuotationToolPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('inspection')
  const [showSettings, setShowSettings] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
    fireAlarmSystem: false,
    otherEquipment: false,
    sprinklerSystems: false,
  })
  const [inspectionItems, setInspectionItems] = useState<InspectionItem[]>(initialInspectionItems)
  const [serviceItems] = useState<ServiceItem[]>(initialServiceItems)
  const [inspectionCounts, setInspectionCounts] = useState<Record<string, number>>(buildInspectionCounts(initialInspectionItems))
  const [serviceCounts, setServiceCounts] = useState<Record<string, number>>(buildServiceCounts(initialServiceItems))
  const [quoteAddresses, setQuoteAddresses] = useState<Record<ActiveTab, string>>({ inspection: '', service: '', verification: '' })
  const [serviceMeta, setServiceMeta] = useState<ServiceMeta>({ serviceType: 'fireAlarmService', backflowMode: 'service' })
  const [settings, setSettings] = useState<SettingsState>(defaultSettings)
  const [savedQuotes, setSavedQuotes] = useState<SavedQuote[]>([])
  const [pricingLocked, setPricingLocked] = useState(true)
  const [pendingUnlock, setPendingUnlock] = useState(false)
  const [changeReason, setChangeReason] = useState('')
  const [changeReasonError, setChangeReasonError] = useState('')
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({})
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({})
  const [newItemDraft, setNewItemDraft] = useState<{ label: string; minutes: number; category: InspectionCategory }>({ label: '', minutes: 0, category: inspectionCategories[0] })

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SAVED_QUOTES_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as SavedQuote[]
      if (Array.isArray(parsed)) setSavedQuotes(parsed)
    } catch {
      /* ignore invalid session cache */
    }
  }, [])

  useEffect(() => {
    try {
      sessionStorage.setItem(SAVED_QUOTES_KEY, JSON.stringify(savedQuotes))
    } catch {
      /* ignore storage failures */
    }
  }, [savedQuotes])

  const groupedInspectionItems = useMemo(
    () =>
      inspectionCategories.reduce(
        (acc, category) => {
          acc[category] = inspectionItems.filter((item) => item.category === category)
          return acc
        },
        {} as Record<InspectionCategory, InspectionItem[]>,
      ),
    [inspectionItems],
  )

  const inspectionTechnicians = Math.max(1, Number(settings.inspectionTechnicians || 1))
  const totalTechs = Math.max(1, Number(settings.fireAlarmTechnicians || 1)) + Number(settings.sprinklerTechnicians || 0)
  const travelMinutes = Number(settings.customTravelMinutes || 0)

  const hasSprinklerWork = useMemo(
    () =>
      inspectionItems.some(
        (item) =>
          ['Sprinkler System', 'Interval Testing', 'Backflows'].includes(item.category) &&
          Number(inspectionCounts[item.key] || 0) > 0,
      ),
    [inspectionCounts, inspectionItems],
  )

  const inspectionTruckCount = 1 + (hasSprinklerWork && Number(settings.sprinklerTechnicians || 0) > 0 ? 1 : 0)

  const truckCharge = useMemo(
    () =>
      settings.travelProfile === 'crd'
        ? settings.truckChargeCrd * inspectionTruckCount
        : Number(settings.estimatedRoundTripKm || 0) * 0.15 * inspectionTruckCount,
    [inspectionTruckCount, settings.estimatedRoundTripKm, settings.travelProfile, settings.truckChargeCrd],
  )

  const fixedInspectionPricing = useMemo(() => {
    const hydrants = Number(inspectionCounts.fireHydrants || 0) * settings.hydrantFixedPrice
    const fdcOnly = Number(inspectionCounts.sprinkler5YearFdcOnly || 0) * settings.fiveYearFdcOnlyFixedPrice
    const fdcStandpipe = Number(inspectionCounts.sprinkler5YearFdcStandpipe || 0) * settings.fiveYearFdcStandpipeFixedPrice
    const annualBackflows = Number(inspectionCounts.sprinklerBackflowsAnnual || 0) * settings.backflowAnnualFixedPrice
    const serviceBackflowQty = Number(inspectionCounts.sprinklerBackflowsService || 0)
    const serviceBackflows =
      serviceBackflowQty > 0
        ? settings.backflowServiceFirstPrice + Math.max(0, serviceBackflowQty - 1) * settings.backflowServiceAdditionalPrice
        : 0
    return { total: hydrants + fdcOnly + fdcStandpipe + annualBackflows + serviceBackflows }
  }, [inspectionCounts, settings])

  const inspectionResults = useMemo(() => {
    const itemMinutes = inspectionItems.reduce((sum, item) => sum + Number(inspectionCounts[item.key] || 0) * item.minutes, 0)
    const rawMinutes = itemMinutes + travelMinutes * inspectionTechnicians + settings.adminBufferMinutes + settings.setupBufferMinutes
    const totalEstimatedHoursMinutes = Math.max(rawMinutes, 60)
    const adjustedForTwoTechsMinutes = totalEstimatedHoursMinutes / 2
    const inspectionDays = roundQuarterDay(adjustedForTwoTechsMinutes / 60 / 7.5)
    const laborCost = (totalEstimatedHoursMinutes / 60) * settings.annualInspectionRate
    const preTaxTotal = laborCost + fixedInspectionPricing.total + Number(settings.miscCost || 0)
    return {
      itemMinutes,
      rawMinutes,
      minimumMinutes: 60,
      totalEstimatedHoursMinutes,
      adjustedForTwoTechsMinutes,
      inspectionDays,
      laborCost: Math.round(laborCost),
      preTaxTotal: Math.round(preTaxTotal),
      truckCharge: Math.round(truckCharge),
      finalTotal: Math.round(preTaxTotal) + Math.round(truckCharge),
    }
  }, [fixedInspectionPricing.total, inspectionCounts, inspectionItems, inspectionTechnicians, settings, travelMinutes, truckCharge])

  const serviceResults = useMemo(() => {
    const selectedType = serviceTypeOptions[serviceMeta.serviceType]
    const hourlyRate = Number(settings[selectedType.rateKey] || 0)
    const itemMinutes = serviceItems.reduce((sum, item) => {
      const qty = Number(serviceCounts[item.key] || 0)
      if (item.key === 'fireExtinguisherCabinet') return qty <= 0 ? sum : sum + 30 + Math.max(0, qty - 1) * 15
      if (item.key === 'winterization') return sum + qty * 30 + Number(serviceCounts.winterizationLowPoints || 0) * 10
      if (item.key === 'testing3YearSprinkler') return sum + qty * 90 + Number(serviceCounts.additionalDryPipeValves || 0) * 60
      return sum + qty * item.minutes
    }, 0)
    const rawMinutes = itemMinutes + travelMinutes * totalTechs + settings.adminBufferMinutes
    const totalMinutes = Math.max(rawMinutes, selectedType.minimumMinutes)
    let laborCost = (totalMinutes / 60) * hourlyRate
    if (selectedType.reportProcessingHours > 0) laborCost += selectedType.reportProcessingHours * hourlyRate
    const backflowQty = Number(serviceCounts.backflowTesting || 0)
    const backflowSpecialPrice =
      serviceMeta.backflowMode === 'annual'
        ? backflowQty * settings.backflowAnnualFixedPrice
        : backflowQty > 0
          ? settings.backflowServiceFirstPrice + Math.max(0, backflowQty - 1) * settings.backflowServiceAdditionalPrice
          : 0
    const serviceTruckCharge =
      settings.travelProfile === 'crd'
        ? settings.truckChargeCrd * (1 + (Number(settings.sprinklerTechnicians || 0) > 0 ? 1 : 0))
        : Number(settings.estimatedRoundTripKm || 0) * 0.15 * (1 + (Number(settings.sprinklerTechnicians || 0) > 0 ? 1 : 0))
    const preTaxTotal = laborCost + Number(settings.miscCost || 0) + backflowSpecialPrice
    return {
      itemMinutes,
      rawMinutes,
      minimumMinutes: selectedType.minimumMinutes,
      totalMinutes,
      hourlyRate,
      laborCost: Math.round(laborCost),
      backflowSpecialPrice: Math.round(backflowSpecialPrice),
      preTaxTotal: Math.round(preTaxTotal),
      truckCharge: Math.round(serviceTruckCharge),
      finalTotal: Math.round(preTaxTotal) + Math.round(serviceTruckCharge),
      hasReportProcessing: selectedType.reportProcessingHours > 0,
    }
  }, [serviceCounts, serviceItems, serviceMeta, settings, totalTechs, travelMinutes])

  const currentResult = activeTab === 'inspection' ? inspectionResults : activeTab === 'service' ? serviceResults : null

  function unlockChanges() {
    if (!changeReason.trim()) {
      setChangeReasonError('Please enter a reason before unlocking.')
      return
    }
    setPricingLocked(false)
    setPendingUnlock(false)
    setChangeReason('')
    setChangeReasonError('')
  }

  function handleInspectionMinutesChange(key: string, value: number) {
    setInspectionItems((prev) => prev.map((item) => (item.key === key ? { ...item, minutes: value } : item)))
  }

  function handleInspectionDelete(key: string) {
    const item = inspectionItems.find((entry) => entry.key === key)
    if (!window.confirm(`Delete ${item?.label || 'this line item'}?`)) return
    setInspectionItems((prev) => prev.filter((entry) => entry.key !== key))
    setInspectionCounts((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    setItemNotes((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    setExpandedNotes((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  function addInspectionItem() {
    if (!newItemDraft.label.trim()) return
    const key = `${newItemDraft.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`
    const nextItem: InspectionItem = { key, label: newItemDraft.label.trim(), minutes: Number(newItemDraft.minutes || 0), category: newItemDraft.category }
    setInspectionItems((prev) => [...prev, nextItem])
    setInspectionCounts((prev) => ({ ...prev, [key]: 0 }))
    setNewItemDraft({ label: '', minutes: 0, category: inspectionCategories[0] })
  }

  function buildQuoteSnapshot(): SavedQuoteSnapshot {
    return { activeTab, quoteAddresses, inspectionCounts, serviceCounts, serviceMeta, inspectionItems, settings, itemNotes }
  }

  function restoreSavedQuote(quote: SavedQuote) {
    const snapshot = quote.snapshot
    setActiveTab(snapshot.activeTab)
    setQuoteAddresses(snapshot.quoteAddresses)
    setInspectionItems(snapshot.inspectionItems)
    setInspectionCounts(snapshot.inspectionCounts)
    setServiceCounts(snapshot.serviceCounts)
    setServiceMeta(snapshot.serviceMeta)
    setSettings(snapshot.settings)
    setItemNotes(snapshot.itemNotes || {})
  }

  function clearCurrentQuoteInputs() {
    if (activeTab === 'inspection') {
      setInspectionCounts(buildInspectionCounts(inspectionItems))
      setQuoteAddresses((prev) => ({ ...prev, inspection: '' }))
      return
    }
    if (activeTab === 'service') {
      setServiceCounts(buildServiceCounts(serviceItems))
      setQuoteAddresses((prev) => ({ ...prev, service: '' }))
      return
    }
    setQuoteAddresses((prev) => ({ ...prev, verification: '' }))
  }

  function saveCurrentQuote() {
    const template = activeTab === 'inspection' ? 'New Service Location' : activeTab === 'service' ? 'Service & Returns' : 'Verification Inspections'
    const entry: SavedQuote = {
      id: Date.now(),
      template,
      address: quoteAddresses[activeTab].trim() || 'No address entered',
      total: currentResult?.finalTotal ?? 0,
      savedAt: new Date().toLocaleString(),
      snapshot: buildQuoteSnapshot(),
    }
    setSavedQuotes((prev) => [entry, ...prev])
    clearCurrentQuoteInputs()
  }

  function resetCounts() {
    setInspectionCounts(buildInspectionCounts(inspectionItems))
    setServiceCounts(buildServiceCounts(serviceItems))
    setSettings((prev) => ({ ...prev, miscCost: 0 }))
    setQuoteAddresses({ inspection: '', service: '', verification: '' })
  }

  return (
    <div className="quotation-tool-page py-3 px-2">
      <Card className="app-surface-card quotation-tool-hero">
        <Card.Body className="p-3 p-md-4">
          <div className="quotation-tool-hero__content">
            <div className="quotation-tool-hero__brand">
              <img src="/cantec-logo-horizontal.png" alt="Cantec" className="quotation-tool-hero__logo" />
              <div>
                <div className="quotation-tool-hero__eyebrow">Internal staff tool</div>
                <h1 className="processing-page-title mb-1">Quotation Tool</h1>
                <p className="processing-page-subtitle mb-0">
                  Estimate inspections, service work, and related travel charges without leaving the app shell.
                </p>
              </div>
            </div>
            <div className="quotation-tool-hero__badges">
              <Button variant="outline-secondary" size="sm" onClick={() => setShowSettings((prev) => !prev)}>
                <i className="bi bi-gear me-2" aria-hidden />
                {showSettings ? 'Hide settings' : 'Show settings'}
              </Button>
              <Badge bg="light" text="dark" pill>Frontend-only v1</Badge>
              <Badge bg="secondary" pill>Browser saved quotes</Badge>
            </div>
          </div>
        </Card.Body>
      </Card>

      <Row className="g-4 mt-0">
        <Col xl={8}>
          {showSettings ? (
            <Card className="app-surface-card quotation-tool-settings-card mb-4">
              <Card.Header className="fw-semibold d-flex align-items-center gap-2">
                <i className="bi bi-gear" aria-hidden />
                Settings
              </Card.Header>
              <Card.Body className="quotation-tool__stack">
                <Card className="quotation-tool__soft-card">
                  <Card.Body>
                    <div className="quotation-tool__section-title"><i className="bi bi-lock" aria-hidden />Locked-change workflow</div>
                    <div className="quotation-tool__helper-text">Rates and editable minutes stay locked until a reason is entered.</div>
                    <div className="d-flex flex-column gap-2 mt-3">
                      {pricingLocked && !pendingUnlock ? <Button variant="outline-secondary" onClick={() => { setPendingUnlock(true); setChangeReasonError('') }}>Unlock editable values</Button> : null}
                      {pricingLocked && pendingUnlock ? <>
                        <Form.Control as="textarea" rows={3} value={changeReason} onChange={(e) => setChangeReason(e.target.value)} placeholder="Why are you changing locked quotation values?" />
                        {changeReasonError ? <Alert variant="danger" className="py-2 mb-0">{changeReasonError}</Alert> : null}
                        <div className="d-flex gap-2">
                          <Button onClick={unlockChanges}>Yes, unlock</Button>
                          <Button variant="outline-secondary" onClick={() => { setPendingUnlock(false); setChangeReason(''); setChangeReasonError('') }}>Cancel</Button>
                        </div>
                      </> : null}
                      {!pricingLocked ? <Button variant="outline-secondary" onClick={() => setPricingLocked(true)}>Lock values again</Button> : null}
                    </div>
                  </Card.Body>
                </Card>

                <Row className="g-3">
                  <Col md={6}><NumberField label="Annual inspection rate" value={settings.annualInspectionRate} onChange={(value) => setSettings((prev) => ({ ...prev, annualInspectionRate: value }))} disabled={pricingLocked} /></Col>
                  <Col md={6}><NumberField label="FA recurring rate" value={settings.recurringFireAlarmRate} onChange={(value) => setSettings((prev) => ({ ...prev, recurringFireAlarmRate: value }))} disabled={pricingLocked} /></Col>
                  <Col md={6}><NumberField label="FA service rate" value={settings.fireAlarmServiceRate} onChange={(value) => setSettings((prev) => ({ ...prev, fireAlarmServiceRate: value }))} disabled={pricingLocked} /></Col>
                  <Col md={6}><NumberField label="Sprinkler annual rate" value={settings.sprinklerAnnualRate} onChange={(value) => setSettings((prev) => ({ ...prev, sprinklerAnnualRate: value }))} disabled={pricingLocked} /></Col>
                  <Col md={6}><NumberField label="Sprinkler service rate" value={settings.sprinklerServiceRate} onChange={(value) => setSettings((prev) => ({ ...prev, sprinklerServiceRate: value }))} disabled={pricingLocked} /></Col>
                  <Col md={6}><NumberField label="Verification rate" value={settings.verificationRate} onChange={(value) => setSettings((prev) => ({ ...prev, verificationRate: value }))} disabled={pricingLocked} /></Col>
                  <Col md={6}><NumberField label="Truck charge (CRD)" value={settings.truckChargeCrd} onChange={(value) => setSettings((prev) => ({ ...prev, truckChargeCrd: value }))} disabled={pricingLocked} step="0.01" /></Col>
                  <Col md={6}><NumberField label="Hydrant fixed rate" value={settings.hydrantFixedPrice} onChange={(value) => setSettings((prev) => ({ ...prev, hydrantFixedPrice: value }))} disabled={pricingLocked} step="0.01" /></Col>
                  <Col md={6}><NumberField label="Annual backflow rate" value={settings.backflowAnnualFixedPrice} onChange={(value) => setSettings((prev) => ({ ...prev, backflowAnnualFixedPrice: value }))} disabled={pricingLocked} step="0.01" /></Col>
                  <Col md={6}><NumberField label="Service backflow first" value={settings.backflowServiceFirstPrice} onChange={(value) => setSettings((prev) => ({ ...prev, backflowServiceFirstPrice: value }))} disabled={pricingLocked} step="0.01" /></Col>
                  <Col md={6}><NumberField label="Service backflow additional" value={settings.backflowServiceAdditionalPrice} onChange={(value) => setSettings((prev) => ({ ...prev, backflowServiceAdditionalPrice: value }))} disabled={pricingLocked} step="0.01" /></Col>
                  <Col md={6}><NumberField label="5-year FDC only" value={settings.fiveYearFdcOnlyFixedPrice} onChange={(value) => setSettings((prev) => ({ ...prev, fiveYearFdcOnlyFixedPrice: value }))} disabled={pricingLocked} step="0.01" /></Col>
                  <Col md={6}><NumberField label="5-year FDC + standpipe" value={settings.fiveYearFdcStandpipeFixedPrice} onChange={(value) => setSettings((prev) => ({ ...prev, fiveYearFdcStandpipeFixedPrice: value }))} disabled={pricingLocked} step="0.01" /></Col>
                  <Col md={6}><NumberField label="Admin buffer minutes" value={settings.adminBufferMinutes} onChange={(value) => setSettings((prev) => ({ ...prev, adminBufferMinutes: value }))} disabled={pricingLocked} /></Col>
                  <Col md={6}><NumberField label="Setup / cleanup minutes" value={settings.setupBufferMinutes} onChange={(value) => setSettings((prev) => ({ ...prev, setupBufferMinutes: value }))} disabled={pricingLocked} /></Col>
                  <Col md={6}><NumberField label="Misc cost" value={settings.miscCost} onChange={(value) => setSettings((prev) => ({ ...prev, miscCost: value }))} step="0.01" /></Col>
                  <Col md={6}><NumberField label="Inspection technicians" value={settings.inspectionTechnicians} onChange={(value) => setSettings((prev) => ({ ...prev, inspectionTechnicians: value || 1 }))} helper="Used for travel minutes on inspection quotes." /></Col>
                  <Col md={6}><NumberField label="FA technicians" value={settings.fireAlarmTechnicians} onChange={(value) => setSettings((prev) => ({ ...prev, fireAlarmTechnicians: value || 1 }))} /></Col>
                  <Col md={6}><NumberField label="Sprinkler tech / vans" value={settings.sprinklerTechnicians} onChange={(value) => setSettings((prev) => ({ ...prev, sprinklerTechnicians: value }))} /></Col>
                  <Col md={6}><Form.Group><Form.Label className="quotation-tool__field-label">Travel profile</Form.Label><Form.Select value={settings.travelProfile} onChange={(e) => setSettings((prev) => ({ ...prev, travelProfile: e.target.value as TravelProfile }))}>{Object.entries(travelProfiles).map(([key, profile]) => <option key={key} value={key}>{profile.label}</option>)}</Form.Select></Form.Group></Col>
                  <Col md={6}><NumberField label="Travel minutes round-trip" value={settings.customTravelMinutes} onChange={(value) => setSettings((prev) => ({ ...prev, customTravelMinutes: value }))} disabled={pricingLocked} /></Col>
                  <Col md={6}><NumberField label="Round-trip KM" value={settings.estimatedRoundTripKm} onChange={(value) => setSettings((prev) => ({ ...prev, estimatedRoundTripKm: value }))} disabled={pricingLocked} step="0.1" /></Col>
                </Row>
              </Card.Body>
            </Card>
          ) : null}

          {!showSettings ? (
          <Card className="app-surface-card quotation-tool-main-card">
            <Card.Body className="p-3 p-md-4">
              <Tabs activeKey={activeTab} onSelect={(key) => setActiveTab((key as ActiveTab) || 'inspection')} className="quotation-tool-tabs mb-4">
                <Tab eventKey="inspection" title={<span className="quotation-tool-tab-title"><i className="bi bi-building" aria-hidden />New Service Location</span>}>
                  <div className="quotation-tool__stack">
                    <Form.Group>
                      <Form.Label>Quote address</Form.Label>
                      <Form.Control value={quoteAddresses.inspection} onChange={(e) => setQuoteAddresses((prev) => ({ ...prev, inspection: e.target.value }))} placeholder="Enter site address" />
                    </Form.Group>

                    <Card className="quotation-tool__soft-card">
                      <Card.Body>
                        <div className="quotation-tool__section-title"><i className="bi bi-plus-circle" aria-hidden />Add custom inspection item</div>
                        <Row className="g-3 align-items-end">
                          <Col md={5}><Form.Group><Form.Label>Label</Form.Label><Form.Control value={newItemDraft.label} onChange={(e) => setNewItemDraft((prev) => ({ ...prev, label: e.target.value }))} /></Form.Group></Col>
                          <Col md={2}><Form.Group><Form.Label>Minutes</Form.Label><Form.Control type="number" min={0} step="0.25" value={newItemDraft.minutes} onChange={(e) => setNewItemDraft((prev) => ({ ...prev, minutes: Math.max(0, Number(e.target.value || 0)) }))} /></Form.Group></Col>
                          <Col md={3}><Form.Group><Form.Label>Section</Form.Label><Form.Select value={newItemDraft.category} onChange={(e) => setNewItemDraft((prev) => ({ ...prev, category: e.target.value as InspectionCategory }))}>{inspectionCategories.map((category) => <option key={category} value={category}>{category}</option>)}</Form.Select></Form.Group></Col>
                          <Col md={2}><Button className="w-100" onClick={addInspectionItem}>Add item</Button></Col>
                        </Row>
                      </Card.Body>
                    </Card>

                    {inspectionCategoryGroups.map((group) => (
                      <Card key={group.key} className="quotation-tool__group-card">
                        <Card.Header
                          className="quotation-tool__group-header quotation-tool__group-header--toggle"
                          role="button"
                          onClick={() =>
                            setCollapsedGroups((prev) => ({
                              ...prev,
                              [group.key]: !prev[group.key],
                            }))
                          }
                        >
                          <div className="quotation-tool__group-title">
                            <span>{group.label}</span>
                            <Badge bg="light" text="dark" pill>{group.categories.flatMap((category) => groupedInspectionItems[category] || []).length}</Badge>
                          </div>
                          <i className={`bi ${collapsedGroups[group.key] ? 'bi-chevron-down' : 'bi-chevron-up'}`} aria-hidden />
                        </Card.Header>
                        {!collapsedGroups[group.key] ? (
                          <Card.Body className="quotation-tool__stack">
                            {group.categories.map((category) => (
                              <div key={category}>
                                <div className="quotation-tool__subheading"><span>{category}</span><Badge bg="secondary" pill>{(groupedInspectionItems[category] || []).length}</Badge></div>
                                {category === 'Passive Devices' ? <Alert variant="warning" className="py-2 small">The minutes shown are for visual inspection only, not testing.</Alert> : null}
                                <div className="quotation-tool__line-list">
                                  {(groupedInspectionItems[category] || []).map((item) => (
                                    <div key={item.key} className="quotation-tool__line-item quotation-tool__line-item--compact">
                                      <div className="quotation-tool__line-main">
                                        <div className="quotation-tool__line-left">
                                          <i className="bi bi-grip-vertical quotation-tool__grip" aria-hidden />
                                          <div className="quotation-tool__line-label-wrap">
                                            <div className="quotation-tool__line-label">{item.label}</div>
                                          </div>
                                          <button
                                            type="button"
                                            className="quotation-tool__row-chevron"
                                            onClick={() =>
                                              setExpandedNotes((prev) => ({
                                                ...prev,
                                                [item.key]: !prev[item.key],
                                              }))
                                            }
                                            aria-label={expandedNotes[item.key] ? 'Hide notes' : 'Show notes'}
                                            aria-expanded={!!expandedNotes[item.key]}
                                          >
                                            <i
                                              className={`bi ${expandedNotes[item.key] ? 'bi-chevron-down' : 'bi-chevron-right'}`}
                                              aria-hidden
                                            />
                                          </button>
                                        </div>
                                        <div className="quotation-tool__line-controls">
                                          <Form.Control type="number" min={0} value={inspectionCounts[item.key] || ''} placeholder="Qty" onChange={(e) => setInspectionCounts((prev) => ({ ...prev, [item.key]: Math.max(0, Number(e.target.value || 0)) }))} />
                                          <Form.Control type="number" min={0} step="0.25" disabled={pricingLocked} value={item.minutes} onChange={(e) => handleInspectionMinutesChange(item.key, Math.max(0, Number(e.target.value || 0)))} />
                                          <div className="quotation-tool__line-total">{Math.round((inspectionCounts[item.key] || 0) * item.minutes)}m</div>
                                          <Button variant="light" className="quotation-tool__icon-button" onClick={() => handleInspectionDelete(item.key)}><i className="bi bi-trash" aria-hidden /></Button>
                                        </div>
                                      </div>
                                      {expandedNotes[item.key] ? (
                                        <div className="quotation-tool__line-note">
                                          <Form.Control
                                            as="textarea"
                                            rows={3}
                                            value={itemNotes[item.key] || ''}
                                            onChange={(e) =>
                                              setItemNotes((prev) => ({
                                                ...prev,
                                                [item.key]: e.target.value,
                                              }))
                                            }
                                            placeholder="Add quotation notes, device-specific comments, procedural nuances, or updates here."
                                          />
                                        </div>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </Card.Body>
                        ) : null}
                      </Card>
                    ))}
                  </div>
                </Tab>

                <Tab eventKey="service" title={<span className="quotation-tool-tab-title"><i className="bi bi-wrench-adjustable" aria-hidden />Service & Returns</span>}>
                  <div className="quotation-tool__stack">
                    <Row className="g-3">
                      <Col md={6}><Form.Group><Form.Label>Quote address</Form.Label><Form.Control value={quoteAddresses.service} onChange={(e) => setQuoteAddresses((prev) => ({ ...prev, service: e.target.value }))} placeholder="Enter site address" /></Form.Group></Col>
                      <Col md={3}><Form.Group><Form.Label>Service type</Form.Label><Form.Select value={serviceMeta.serviceType} onChange={(e) => setServiceMeta((prev) => ({ ...prev, serviceType: e.target.value as ServiceTypeKey }))}>{Object.entries(serviceTypeOptions).map(([key, option]) => <option key={key} value={key}>{option.label}</option>)}</Form.Select></Form.Group></Col>
                      <Col md={3}><Form.Group><Form.Label>Backflow pricing</Form.Label><Form.Select value={serviceMeta.backflowMode} onChange={(e) => setServiceMeta((prev) => ({ ...prev, backflowMode: e.target.value as BackflowMode }))}><option value="service">Service call</option><option value="annual">During annual inspection</option></Form.Select></Form.Group></Col>
                    </Row>
                    <div className="quotation-tool__line-list">
                      {serviceItems.map((item) => (
                        <div key={item.key} className="quotation-tool__line-item quotation-tool__line-item--compact">
                          <div className="quotation-tool__line-main">
                            <div className="quotation-tool__line-left">
                              <i className="bi bi-grip-vertical quotation-tool__grip" aria-hidden />
                              <div className="quotation-tool__line-label-wrap">
                                <div className="quotation-tool__line-label">{item.label}</div>
                                <div className="quotation-tool__helper-text">{item.note}</div>
                              </div>
                              <button
                                type="button"
                                className="quotation-tool__row-chevron"
                                onClick={() =>
                                  setExpandedNotes((prev) => ({
                                    ...prev,
                                    [item.key]: !prev[item.key],
                                  }))
                                }
                                aria-label={expandedNotes[item.key] ? 'Hide notes' : 'Show notes'}
                                aria-expanded={!!expandedNotes[item.key]}
                              >
                                <i
                                  className={`bi ${expandedNotes[item.key] ? 'bi-chevron-down' : 'bi-chevron-right'}`}
                                  aria-hidden
                                />
                              </button>
                            </div>
                            <div className="quotation-tool__line-controls quotation-tool__line-controls--service">
                              <Form.Control type="number" min={0} value={serviceCounts[item.key] || ''} placeholder="Qty" onChange={(e) => setServiceCounts((prev) => ({ ...prev, [item.key]: Math.max(0, Number(e.target.value || 0)) }))} />
                              <Form.Control type="number" min={0} step="0.25" value={item.minutes} disabled />
                              <div className="quotation-tool__line-total">{serviceItemTotalMinutes(item.key, item.minutes, serviceCounts)}m</div>
                              <Button variant="light" className="quotation-tool__icon-button" disabled><i className="bi bi-lock" aria-hidden /></Button>
                            </div>
                          </div>
                          {expandedNotes[item.key] ? (
                            <div className="quotation-tool__line-note">
                              <Form.Control
                                as="textarea"
                                rows={3}
                                value={itemNotes[item.key] || ''}
                                onChange={(e) =>
                                  setItemNotes((prev) => ({
                                    ...prev,
                                    [item.key]: e.target.value,
                                  }))
                                }
                                placeholder="Add quotation notes, device-specific comments, procedural nuances, or updates here."
                              />
                            </div>
                          ) : null}
                          {item.key === 'winterization' || item.key === 'testing3YearSprinkler' ? (
                            <div className="quotation-tool__line-secondary">
                              {item.key === 'winterization' ? <Form.Control type="number" min={0} value={serviceCounts.winterizationLowPoints || ''} onChange={(e) => setServiceCounts((prev) => ({ ...prev, winterizationLowPoints: Math.max(0, Number(e.target.value || 0)) }))} placeholder="Extra low points" /> : null}
                              {item.key === 'testing3YearSprinkler' ? <Form.Control type="number" min={0} value={serviceCounts.additionalDryPipeValves || ''} onChange={(e) => setServiceCounts((prev) => ({ ...prev, additionalDryPipeValves: Math.max(0, Number(e.target.value || 0)) }))} placeholder="Additional dry pipe valves" /> : null}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </Tab>

                <Tab eventKey="verification" title={<span className="quotation-tool-tab-title"><i className="bi bi-clipboard-data" aria-hidden />Verification Inspections</span>}>
                  <Form.Group className="mb-3">
                    <Form.Label>Quote address</Form.Label>
                    <Form.Control value={quoteAddresses.verification} onChange={(e) => setQuoteAddresses((prev) => ({ ...prev, verification: e.target.value }))} placeholder="Enter site address" />
                  </Form.Group>
                  <Alert variant="secondary" className="mb-0">Verification calculations are staged for a later iteration. The page is routed and ready inside the app shell.</Alert>
                </Tab>
              </Tabs>

              <div className="d-flex flex-wrap gap-2 pt-3">
                <Button onClick={resetCounts}>Reset counts</Button>
                <Button variant="outline-secondary" disabled>Print quote summary (next step)</Button>
              </div>
            </Card.Body>
          </Card>
          ) : null}
        </Col>

        <Col xl={4}>
          <div className="quotation-tool-sidebar">
            <Card className="app-surface-card quotation-tool-summary-card">
              <Card.Header className="fw-semibold">Estimate Summary</Card.Header>
              <Card.Body className="quotation-tool__stack">
                {activeTab === 'inspection' && inspectionResults.rawMinutes < inspectionResults.minimumMinutes ? <Alert variant="warning" className="py-2 mb-0">Minimum annual inspection charge applied: 1 hour.</Alert> : null}
                {activeTab === 'service' && serviceResults.rawMinutes < serviceResults.minimumMinutes ? <Alert variant="warning" className="py-2 mb-0">Minimum charge applied: {serviceResults.minimumMinutes === 120 ? '2 hours for verifications.' : '1 hour for service.'}</Alert> : null}

                <div className="quotation-tool__summary-block">
                  <SummaryRow label="Quote address" value={quoteAddresses[activeTab] || '-'} />
                  <SummaryRow label="Device / task minutes" value={`${activeTab === 'inspection' ? inspectionResults.itemMinutes : activeTab === 'service' ? serviceResults.itemMinutes : 0} min`} />
                  <SummaryRow label="Travel minutes" value={`${activeTab === 'inspection' ? travelMinutes * inspectionTechnicians : travelMinutes * totalTechs} min`} />
                  <SummaryRow label="Total technicians" value={`${activeTab === 'inspection' ? inspectionTechnicians : totalTechs}`} />
                </div>

                <div className="quotation-tool__summary-block quotation-tool__summary-block--bordered">
                  {activeTab === 'inspection' ? <SummaryRow label="Inspection rate applied" value={formatCurrency(settings.annualInspectionRate)} /> : null}
                  {activeTab === 'service' ? <SummaryRow label="Service type" value={serviceTypeOptions[serviceMeta.serviceType].label} /> : null}
                  {activeTab === 'service' ? <SummaryRow label="Hourly rate applied" value={formatCurrency(serviceResults.hourlyRate)} /> : null}
                  <SummaryRow label="Total estimated hours" value={activeTab === 'inspection' ? formatHours(inspectionResults.totalEstimatedHoursMinutes) : activeTab === 'service' ? formatHours(serviceResults.totalMinutes) : '-'} />
                  {activeTab === 'inspection' ? <SummaryRow label="Adjusted for 2 technicians" value={formatHours(inspectionResults.adjustedForTwoTechsMinutes)} /> : null}
                  {activeTab === 'inspection' ? <SummaryRow label="Inspection days (7.5 hr/day)" value={formatDays(inspectionResults.inspectionDays)} /> : null}
                  <SummaryRow label="Labor cost" value={activeTab === 'inspection' ? formatCurrency(inspectionResults.laborCost) : activeTab === 'service' ? formatCurrency(serviceResults.laborCost) : '-'} />
                  {activeTab === 'inspection' ? <SummaryRow label="Fixed sprinkler pricing" value={formatCurrency(fixedInspectionPricing.total)} /> : null}
                  {activeTab === 'service' ? <SummaryRow label="Backflow special pricing" value={formatCurrency(serviceResults.backflowSpecialPrice)} /> : null}
                  {activeTab === 'service' && serviceResults.hasReportProcessing ? <SummaryRow label="Verification report processing" value={formatCurrency(settings.verificationRate)} /> : null}
                  <SummaryRow label="Pre-tax total" value={activeTab === 'inspection' ? formatCurrency(inspectionResults.preTaxTotal) : activeTab === 'service' ? formatCurrency(serviceResults.preTaxTotal) : '-'} />
                  <SummaryRow label="Truck charge" value={activeTab === 'inspection' ? formatCurrency(inspectionResults.truckCharge) : activeTab === 'service' ? formatCurrency(serviceResults.truckCharge) : '-'} />
                  <SummaryRow label="Quoted total" value={activeTab === 'inspection' ? formatCurrency(inspectionResults.finalTotal) : activeTab === 'service' ? formatCurrency(serviceResults.finalTotal) : '-'} bold />
                </div>

                <Button className="w-100" onClick={saveCurrentQuote}><i className="bi bi-save me-2" aria-hidden />Save quote</Button>
              </Card.Body>
            </Card>

            <Card className="app-surface-card quotation-tool-saved-card">
              <Card.Header className="fw-semibold">Saved Quotes</Card.Header>
              <Card.Body>
                {savedQuotes.length === 0 ? (
                  <div className="text-muted small">No saved quotes yet.</div>
                ) : (
                  <ListGroup variant="flush" className="quotation-tool__saved-list">
                    {savedQuotes.map((quote) => (
                      <ListGroup.Item key={quote.id} action onClick={() => restoreSavedQuote(quote)} className="quotation-tool__saved-item">
                        <div className="d-flex justify-content-between align-items-start gap-2">
                          <div>
                            <div className="fw-semibold text-body">{quote.template}</div>
                            <div className="small text-muted">{quote.address}</div>
                            <div className="quotation-tool__helper-text">Saved {quote.savedAt}</div>
                          </div>
                          <Badge bg="light" text="dark" pill>{formatCurrency(quote.total)}</Badge>
                        </div>
                      </ListGroup.Item>
                    ))}
                  </ListGroup>
                )}
              </Card.Body>
            </Card>
          </div>
        </Col>
      </Row>
    </div>
  )
}
