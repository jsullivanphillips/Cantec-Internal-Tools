import React, { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Calculator,
  ShieldAlert,
  Wrench,
  History,
  Trash2,
  Plus,
  Settings,
  Save,
  Building2,
  GripVertical,
  FolderOpen,
  TriangleAlert,
  ImageOff,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

const LOGO_SRC = "/mnt/data/CANTEC Fire Alarms LOGO horz.png";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(Math.round(Number(value || 0)));

const formatHours = (minutes: number) => `${(Number(minutes || 0) / 60).toFixed(2)} hrs`;
const roundQuarterDay = (days: number) => Math.ceil(Number(days || 0) * 4) / 4;
const formatDays = (days: number) => `${roundQuarterDay(days).toFixed(2)} days`;

const travelProfiles = {
  crd: { label: "Within CRD" },
  outsideCrd: { label: "Outside CRD" },
} as const;

const serviceTypeOptions = {
  recurringFireAlarm: { label: "Fire Alarm (Recurring Service)", rateKey: "recurringFireAlarmRate", minimumMinutes: 60, reportProcessingHours: 0 },
  fireAlarmService: { label: "Fire Alarm (Service)", rateKey: "fireAlarmServiceRate", minimumMinutes: 60, reportProcessingHours: 0 },
  sprinklerAnnual: { label: "Sprinkler (Annual)", rateKey: "sprinklerAnnualRate", minimumMinutes: 60, reportProcessingHours: 0 },
  sprinklerService: { label: "Sprinkler (Service)", rateKey: "sprinklerServiceRate", minimumMinutes: 60, reportProcessingHours: 0 },
  verification: { label: "Verifications", rateKey: "verificationRate", minimumMinutes: 120, reportProcessingHours: 1 },
} as const;

const inspectionCategories = [
  "Fire Alarm Panel",
  "Annunciator",
  "Indicating Devices",
  "Signalling Equipment",
  "Auxiliary Equipment",
  "Other Equipment",
  "Passive Devices",
  "Sprinkler System",
  "Interval Testing",
  "Backflows",
] as const;

type InspectionCategory = (typeof inspectionCategories)[number];

const inspectionCategoryGroups: { key: string; label: string; categories: InspectionCategory[] }[] = [
  {
    key: "fireAlarmSystem",
    label: "Fire Alarm System",
    categories: [
      "Fire Alarm Panel",
      "Annunciator",
      "Indicating Devices",
      "Signalling Equipment",
      "Auxiliary Equipment",
      "Passive Devices",
    ],
  },
  {
    key: "otherEquipment",
    label: "Other Equipment",
    categories: ["Other Equipment"],
  },
  {
    key: "sprinklerSystems",
    label: "Sprinkler Systems",
    categories: ["Sprinkler System", "Interval Testing", "Backflows"],
  },
];

type InspectionItem = {
  key: string;
  label: string;
  minutes: number;
  category: InspectionCategory;
  fixedPrice?: number;
};

type ServiceItem = {
  key: string;
  label: string;
  minutes: number;
  note: string;
};

const initialInspectionItems: InspectionItem[] = [
  { key: "controlUnits", label: "Control Units", minutes: 30, category: "Fire Alarm Panel" },
  { key: "nodes", label: "Nodes", minutes: 30, category: "Fire Alarm Panel" },
  { key: "boosters", label: "Boosters", minutes: 15, category: "Fire Alarm Panel" },
  { key: "addressablePanels", label: "Addressable", minutes: 30, category: "Fire Alarm Panel" },
  { key: "annunciator4to8", label: "Annunciator 4 - 8 Zone", minutes: 15, category: "Annunciator" },
  { key: "annunciator8to12", label: "Annunciator 8 - 12 Zone", minutes: 30, category: "Annunciator" },
  { key: "annunciator12to20", label: "Annunciator 12 - 20 Zone", minutes: 45, category: "Annunciator" },
  { key: "annunciator20to40", label: "Annunciator 20 - 40 Zone", minutes: 60, category: "Annunciator" },
  { key: "remoteTrouble", label: "Remote Trouble", minutes: 5, category: "Annunciator" },
  { key: "heatDetectors", label: "Heat Detectors", minutes: 4, category: "Indicating Devices" },
  { key: "smokeDetectors", label: "Smoke Detectors", minutes: 5, category: "Indicating Devices" },
  { key: "pullStations", label: "Pull Stations", minutes: 2, category: "Indicating Devices" },
  { key: "twoStagePullStations", label: "Two-Stage Pull Stations", minutes: 2.5, category: "Indicating Devices" },
  { key: "sprinklerSwitches", label: "Sprinkler Switch", minutes: 3, category: "Indicating Devices" },
  { key: "ductSmoke", label: "Duct Smoke", minutes: 30, category: "Indicating Devices" },
  { key: "signalCombined", label: "Horns, Strobes, & Bells", minutes: 2, category: "Signalling Equipment" },
  { key: "monitoring", label: "Monitoring", minutes: 15, category: "Auxiliary Equipment" },
  { key: "fanShutdowns", label: "Fan Shutdowns", minutes: 10, category: "Auxiliary Equipment" },
  { key: "doorHolders", label: "Door Holders", minutes: 2, category: "Auxiliary Equipment" },
  { key: "elevatorShaft", label: "Elevator Shaft", minutes: 10, category: "Auxiliary Equipment" },
  { key: "elevatorHoming", label: "Elevator Homing", minutes: 30, category: "Auxiliary Equipment" },
  { key: "kitchenHood", label: "Kitchen Hood Suppression System", minutes: 10, category: "Auxiliary Equipment" },
  { key: "firePump", label: "Fire Pump", minutes: 20, category: "Auxiliary Equipment" },
  { key: "hoses", label: "Hoses", minutes: 8, category: "Other Equipment" },
  { key: "extinguishers", label: "Extinguishers", minutes: 3, category: "Other Equipment" },
  { key: "emergencyLightingSelfContained", label: "Emergency Lighting - Self-Contained", minutes: 3, category: "Other Equipment" },
  { key: "emergencyLightingMultiHead", label: "Emergency Lighting - Control with Multi-Heads", minutes: 5, category: "Other Equipment" },
  { key: "otherSmokeAlarms", label: "Smoke Alarms", minutes: 2, category: "Other Equipment" },
  { key: "passiveDevices", label: "Passive Devices", minutes: 0.5, category: "Passive Devices" },
  { key: "standpipeFdcOnly", label: "Standpipe / FDC Only", minutes: 90, category: "Sprinkler System" },
  { key: "drypipeValves", label: "Drypipe Valves", minutes: 30, category: "Sprinkler System" },
  { key: "wetValves", label: "Wet Valves", minutes: 10, category: "Sprinkler System" },
  { key: "sprinklerTampers", label: "Tampers", minutes: 2, category: "Sprinkler System" },
  { key: "sprinklerCompressors", label: "Compressors", minutes: 20, category: "Sprinkler System" },
  { key: "glycolSystems", label: "Glycol Systems", minutes: 120, category: "Sprinkler System" },
  { key: "fireZones", label: "# of Fire Zones (Common Area Sprinkler Head Inspection)", minutes: 10, category: "Sprinkler System" },
  { key: "fireHydrants", label: "Fire Hydrants", minutes: 60, category: "Sprinkler System", fixedPrice: 150 },
  { key: "sprinkler3YearTripTest", label: "3-Year Full Trip Test", minutes: 90, category: "Interval Testing" },
  { key: "sprinkler5YearFdcOnly", label: "5-Year FDC Only", minutes: 180, category: "Interval Testing", fixedPrice: 525 },
  { key: "sprinkler5YearFdcStandpipe", label: "5-Year FDC and Standpipe", minutes: 330, category: "Interval Testing", fixedPrice: 975 },
  { key: "sprinklerBackflowsAnnual", label: "Backflows (Annual)", minutes: 30, category: "Backflows", fixedPrice: 70 },
  { key: "sprinklerBackflowsService", label: "Backflows (Outside Annual)", minutes: 30, category: "Backflows" },
];

const initialServiceItems: ServiceItem[] = [
  { key: "smokeDetector", label: "Smoke Detector", minutes: 30, note: "15 min x 2 techs or 30 min x 1 tech" },
  { key: "heatDetector", label: "Heat Detector", minutes: 30, note: "15 min x 2 techs or 30 min x 1 tech" },
  { key: "pullStation", label: "Pull Station", minutes: 30, note: "15 min x 2 techs or 30 min x 1 tech" },
  { key: "hornBuzzerPiezo", label: "Horn / Buzzer / Piezo", minutes: 30, note: "15 min x 2 techs" },
  { key: "bell", label: "Bell", minutes: 60, note: "30 min x 2 techs" },
  { key: "ductSmokeDetector", label: "Duct Smoke Detector", minutes: 90, note: "Varies from 30 min to 3 hrs" },
  { key: "panelBatteriesInspection", label: "Panel Batteries during Inspection", minutes: 15, note: "15 minutes" },
  { key: "panelBatteriesRepair", label: "Panel Batteries during Repairs", minutes: 30, note: "30 minutes including bell ring and measurements" },
  { key: "smokeAlarm", label: "Smoke Alarm", minutes: 15, note: "15 minutes each" },
  { key: "emergencyLightBatteryTypical", label: "Emergency Light Battery - Typical", minutes: 15, note: "15 minutes" },
  { key: "emergencyLightBatteryDifficult", label: "Emergency Light Battery - Difficult", minutes: 30, note: "30 minutes" },
  { key: "exitSignBattery", label: "Exit Sign Battery", minutes: 10, note: "10 minutes" },
  { key: "newCmpbe", label: "New CM-PB-E", minutes: 30, note: "30 minutes" },
  { key: "newRemoteElu", label: "New Remote ELU", minutes: 90, note: "1.5 hours" },
  { key: "newExit", label: "New Exit", minutes: 30, note: "30 minutes" },
  { key: "newLightHead", label: "New Light Head", minutes: 15, note: "15 minutes" },
  { key: "fireExtinguishers", label: "Fire Extinguishers", minutes: 7.5, note: "2 extinguishers per 15 minutes" },
  { key: "fireExtinguisherMounting", label: "Fire Extinguisher + Mounting", minutes: 15, note: "1 extinguisher per 15 minutes" },
  { key: "fireExtinguisherCabinet", label: "Fire Extinguisher Cabinet", minutes: 30, note: "30 min first, 15 min each additional" },
  { key: "fireHose", label: "Fire Hose", minutes: 15, note: "15 minutes" },
  { key: "compressor", label: "Compressor", minutes: 270, note: "Specialized review item" },
  { key: "testing3YearSprinkler", label: "3 Year Testing - Sprinkler", minutes: 90, note: "1.5 hrs + 1 hr per additional dry pipe valve" },
  { key: "testing5YearSprinkler", label: "5 Year Testing - Sprinkler", minutes: 330, note: "Class-based review item" },
  { key: "backflowTesting", label: "Back Flow Testing", minutes: 45, note: "Uses special pricing rules" },
  { key: "backflowRepair", label: "Back Flow Repair", minutes: 60, note: "Review required" },
  { key: "backflowRepairCheckValve", label: "Back Flow Repair - Check Valve", minutes: 240, note: "3 hrs plus extra buffer included" },
  { key: "sprinklerHeadReplacement", label: "Sprinkler Head Replacement", minutes: 30, note: "Requires FA tech to silence / disconnect bells" },
  { key: "escutcheonReplacement", label: "Escutcheon Replacement", minutes: 10, note: "Quoted at 10 min each" },
  { key: "isolationValveReplacement", label: "Isolation Valve Replacement", minutes: 120, note: "2 hrs with electrician or experienced FA tech" },
  { key: "hydrantFlowTesting", label: "Hydrant Flow Testing", minutes: 60, note: "1 hour per hydrant" },
  { key: "quarterlySprinklerTesting", label: "Quarterly Sprinkler Testing", minutes: 90, note: "Typical 6-storey building" },
  { key: "semiAnnualSprinklerTesting", label: "Semi-Annual Sprinkler Testing", minutes: 120, note: "Typical 6-storey building" },
  { key: "winterization", label: "Winterization", minutes: 30, note: "30 min setup + 10 min per low point" },
];

type SettingsState = {
  annualInspectionRate: number;
  recurringFireAlarmRate: number;
  fireAlarmServiceRate: number;
  sprinklerAnnualRate: number;
  sprinklerServiceRate: number;
  verificationRate: number;
  adminBufferMinutes: number;
  setupBufferMinutes: number;
  travelProfile: keyof typeof travelProfiles;
  customTravelMinutes: number;
  estimatedRoundTripKm: number;
  inspectionTechnicians: number;
  fireAlarmTechnicians: number;
  sprinklerTechnicians: number;
  miscCost: number;
  truckChargeCrd: number;
  hydrantFixedPrice: number;
  backflowAnnualFixedPrice: number;
  backflowServiceFirstPrice: number;
  backflowServiceAdditionalPrice: number;
  fiveYearFdcOnlyFixedPrice: number;
  fiveYearFdcStandpipeFixedPrice: number;
};

type SavedQuoteSnapshot = {
  activeTab: string;
  quoteAddresses: Record<string, string>;
  inspectionCounts: Record<string, number>;
  serviceCounts: Record<string, number>;
  serviceMeta: { serviceType: keyof typeof serviceTypeOptions; backflowMode: "service" | "annual" };
  inspectionItems: InspectionItem[];
  settings: SettingsState;
  itemNotes: Record<string, string>;
};

type SavedQuote = {
  id: number;
  template: string;
  address: string;
  total: number;
  savedAt: string;
  snapshot: SavedQuoteSnapshot;
};

type DropTarget = { category: InspectionCategory; targetKey: string | null } | null;

function NumberField({ label, value, onChange, helper, disabled = false, step = "1" }: { label: string; value: number; onChange: (value: number) => void; helper?: string; disabled?: boolean; step?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-slate-600">{label}</Label>
      <Input type="number" min="0" step={step} disabled={disabled} value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value || 0)))} className="h-8" />
      {helper ? <p className="text-[10px] text-slate-500">{helper}</p> : null}
    </div>
  );
}

function SummaryRow({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 ${bold ? "font-semibold text-slate-900" : "text-slate-700"}`}>
      <span>{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function QuantityInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const displayValue = value === 0 ? "" : String(value);
  return <Input className="h-7 px-2 text-xs" type="number" min="0" value={displayValue} placeholder="Qty" onChange={(e) => onChange(Math.max(0, Number(e.target.value || 0)))} onFocus={(e) => e.target.select()} />;
}

function LogoBlock() {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex h-16 w-[260px] items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-slate-500">
        <ImageOff className="mr-2 h-4 w-4" /> Cantec Fire Alarms
      </div>
    );
  }
  return <img src={LOGO_SRC} alt="Cantec Fire Alarms" className="h-16 w-auto rounded object-contain" onError={() => setFailed(true)} />;
}

function InspectionItemRow({ item, quantity, pricingLocked, isDragging, isDropTarget, note, isExpanded, onToggleNotes, onNoteChange, onQuantityChange, onMinutesChange, onDelete, onDragStart, onDragEnd, onDragEnterRow, onDropOnItem }: { item: InspectionItem; quantity: number; pricingLocked: boolean; isDragging: boolean; isDropTarget: boolean; note: string; isExpanded: boolean; onToggleNotes: () => void; onNoteChange: (value: string) => void; onQuantityChange: (key: string, value: number) => void; onMinutesChange: (key: string, value: number) => void; onDelete: (key: string) => void; onDragStart: (key: string) => void; onDragEnd: () => void; onDragEnterRow: (targetKey: string) => void; onDropOnItem: (targetKey: string, category: InspectionCategory) => void; }) {
  const lineMinutes = Number(quantity || 0) * Number(item.minutes || 0);
  return (
    <>
      {isDropTarget ? <div className="h-2 rounded bg-blue-200" /> : null}
      <div className={`rounded-lg border border-slate-200 bg-white transition-all duration-150 ${isDragging ? "z-10 scale-[1.02] opacity-80 shadow-xl ring-2 ring-blue-200" : ""}`} draggable onDragStart={() => onDragStart(item.key)} onDragEnd={onDragEnd} onDragOver={(e) => e.preventDefault()} onDragEnter={() => onDragEnterRow(item.key)} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDropOnItem(item.key, item.category); }}>
        <div className="grid grid-cols-[16px_minmax(0,1fr)_18px_64px_72px_72px_30px] items-center gap-2 px-2 py-1.5">
          <GripVertical className="h-4 w-4 cursor-grab text-slate-400" />
          <div className="min-w-0"><p className="truncate text-[12px] font-medium text-slate-900">{item.label}</p></div>
          <button type="button" className="flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-slate-100" onClick={onToggleNotes} title="Show quotation notes">
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          <QuantityInput value={quantity} onChange={(value) => onQuantityChange(item.key, value)} />
          <div className="rounded-md bg-slate-100 px-1 py-0.5"><Input className="h-6 border-0 bg-slate-100 px-2 text-xs shadow-none focus-visible:ring-0" type="number" min="0" step="0.25" disabled={pricingLocked} value={item.minutes} placeholder="Mins" onChange={(e) => onMinutesChange(item.key, Math.max(0, Number(e.target.value || 0)))} /></div>
          <div className="flex h-7 items-center justify-center rounded-md bg-slate-100 px-1 text-[10px] text-slate-600">{lineMinutes}m</div>
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => onDelete(item.key)}><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
        {isExpanded ? (
          <div className="border-t border-slate-200 px-2 py-2">
            <Textarea value={note} onChange={(e) => onNoteChange(e.target.value)} placeholder="Add quotation notes, device-specific comments, procedural nuances, or updates here." rows={3} className="text-sm" />
          </div>
        ) : null}
      </div>
    </>
  );
}

export default function FireAlarmQuotationApp() {
  const [activeTab, setActiveTab] = useState("inspection");
  const [showSettingsSidebar, setShowSettingsSidebar] = useState(false);
  const [showSavedSidebar, setShowSavedSidebar] = useState(false);
  const [pricingLocked, setPricingLocked] = useState(true);
  const [pendingUnlock, setPendingUnlock] = useState(false);
  const [changeReason, setChangeReason] = useState("");
  const [changeReasonError, setChangeReasonError] = useState("");
  const [savedQuotes, setSavedQuotes] = useState<SavedQuote[]>([]);
  const [recentSavedOpen, setRecentSavedOpen] = useState(false);
  const [inspectionItems, setInspectionItems] = useState<InspectionItem[]>(initialInspectionItems);
  const [serviceItems] = useState<ServiceItem[]>(initialServiceItems);
  const [draggedInspectionKey, setDraggedInspectionKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [newItemDraft, setNewItemDraft] = useState<{ label: string; minutes: number; category: InspectionCategory }>({ label: "", minutes: 0, category: inspectionCategories[0] });
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({ fireAlarmSystem: false, otherEquipment: false, sprinklerSystems: false });
  const [quoteAddresses, setQuoteAddresses] = useState<Record<string, string>>({ inspection: "", service: "", verification: "" });
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});

  const [settings, setSettings] = useState<SettingsState>({ annualInspectionRate: 95, recurringFireAlarmRate: 110, fireAlarmServiceRate: 125, sprinklerAnnualRate: 125, sprinklerServiceRate: 145, verificationRate: 125, adminBufferMinutes: 30, setupBufferMinutes: 20, travelProfile: "crd", customTravelMinutes: 0, estimatedRoundTripKm: 0, inspectionTechnicians: 1, fireAlarmTechnicians: 1, sprinklerTechnicians: 0, miscCost: 0, truckChargeCrd: 24.95, hydrantFixedPrice: 150, backflowAnnualFixedPrice: 70, backflowServiceFirstPrice: 145, backflowServiceAdditionalPrice: 70, fiveYearFdcOnlyFixedPrice: 525, fiveYearFdcStandpipeFixedPrice: 975 });

  const [inspectionCounts, setInspectionCounts] = useState<Record<string, number>>(Object.fromEntries(initialInspectionItems.map((item) => [item.key, 0])));
  const [serviceCounts, setServiceCounts] = useState<Record<string, number>>(Object.fromEntries([...initialServiceItems.map((item) => [item.key, 0]), ["winterizationLowPoints", 0], ["additionalDryPipeValves", 0]]));
  const [serviceMeta, setServiceMeta] = useState<{ serviceType: keyof typeof serviceTypeOptions; backflowMode: "service" | "annual" }>({ serviceType: "fireAlarmService", backflowMode: "service" });

  const groupedInspectionItems = useMemo(() => inspectionCategories.reduce((acc, category) => { acc[category] = inspectionItems.filter((item) => item.category === category); return acc; }, {} as Record<InspectionCategory, InspectionItem[]>), [inspectionItems]);

  const totalTechs = Math.max(1, Number(settings.fireAlarmTechnicians || 1)) + Number(settings.sprinklerTechnicians || 0);
  const inspectionTechnicians = Math.max(1, Number(settings.inspectionTechnicians || 1));
  const travelMinutes = Number(settings.customTravelMinutes || 0);
  const hasSprinklerWork = useMemo(() => inspectionItems.some((item) => ["Sprinkler System", "Interval Testing", "Backflows"].includes(item.category) && Number(inspectionCounts[item.key] || 0) > 0), [inspectionItems, inspectionCounts]);
  const inspectionTruckCount = 1 + (hasSprinklerWork && Number(settings.sprinklerTechnicians || 0) > 0 ? 1 : 0);
  const truckCharge = useMemo(() => settings.travelProfile === "crd" ? settings.truckChargeCrd * inspectionTruckCount : Number(settings.estimatedRoundTripKm || 0) * 0.15 * inspectionTruckCount, [settings.travelProfile, settings.estimatedRoundTripKm, settings.truckChargeCrd, inspectionTruckCount]);

  const fixedInspectionPricing = useMemo(() => {
    const hydrants = Number(inspectionCounts.fireHydrants || 0) * settings.hydrantFixedPrice;
    const fdcOnly = Number(inspectionCounts.sprinkler5YearFdcOnly || 0) * settings.fiveYearFdcOnlyFixedPrice;
    const fdcStandpipe = Number(inspectionCounts.sprinkler5YearFdcStandpipe || 0) * settings.fiveYearFdcStandpipeFixedPrice;
    const annualBackflows = Number(inspectionCounts.sprinklerBackflowsAnnual || 0) * settings.backflowAnnualFixedPrice;
    const serviceBackflowQty = Number(inspectionCounts.sprinklerBackflowsService || 0);
    const serviceBackflows = serviceBackflowQty > 0 ? settings.backflowServiceFirstPrice + Math.max(0, serviceBackflowQty - 1) * settings.backflowServiceAdditionalPrice : 0;
    return { total: hydrants + fdcOnly + fdcStandpipe + annualBackflows + serviceBackflows };
  }, [inspectionCounts, settings]);

  const inspectionResults = useMemo(() => {
    const itemMinutes = inspectionItems.reduce((sum, item) => sum + Number(inspectionCounts[item.key] || 0) * item.minutes, 0);
    const rawMinutes = itemMinutes + travelMinutes * inspectionTechnicians + settings.adminBufferMinutes + settings.setupBufferMinutes;
    const totalEstimatedHoursMinutes = Math.max(rawMinutes, 60);
    const adjustedForTwoTechsMinutes = totalEstimatedHoursMinutes / 2;
    const inspectionDays = roundQuarterDay(adjustedForTwoTechsMinutes / 60 / 7.5);
    const laborCost = (totalEstimatedHoursMinutes / 60) * settings.annualInspectionRate;
    const preTaxTotal = laborCost + fixedInspectionPricing.total + Number(settings.miscCost || 0);
    return { itemMinutes, rawMinutes, minimumMinutes: 60, totalEstimatedHoursMinutes, adjustedForTwoTechsMinutes, inspectionDays, laborCost: Math.round(laborCost), preTaxTotal: Math.round(preTaxTotal), truckCharge: Math.round(truckCharge), finalTotal: Math.round(preTaxTotal) + Math.round(truckCharge) };
  }, [inspectionItems, inspectionCounts, travelMinutes, inspectionTechnicians, settings, truckCharge, fixedInspectionPricing.total]);

  const serviceResults = useMemo(() => {
    const selectedType = serviceTypeOptions[serviceMeta.serviceType];
    const hourlyRate = Number(settings[selectedType.rateKey] || 0);
    const itemMinutes = serviceItems.reduce((sum, item) => {
      const qty = Number(serviceCounts[item.key] || 0);
      if (item.key === "fireExtinguisherCabinet") return qty <= 0 ? sum : sum + 30 + Math.max(0, qty - 1) * 15;
      if (item.key === "winterization") return sum + qty * 30 + Number(serviceCounts.winterizationLowPoints || 0) * 10;
      if (item.key === "testing3YearSprinkler") return sum + qty * 90 + Number(serviceCounts.additionalDryPipeValves || 0) * 60;
      return sum + qty * item.minutes;
    }, 0);
    const rawMinutes = itemMinutes + travelMinutes * totalTechs + settings.adminBufferMinutes;
    const totalMinutes = Math.max(rawMinutes, selectedType.minimumMinutes);
    let laborCost = (totalMinutes / 60) * hourlyRate;
    if (selectedType.reportProcessingHours > 0) laborCost += selectedType.reportProcessingHours * hourlyRate;
    const backflowQty = Number(serviceCounts.backflowTesting || 0);
    const backflowSpecialPrice = serviceMeta.backflowMode === "annual" ? backflowQty * settings.backflowAnnualFixedPrice : backflowQty > 0 ? settings.backflowServiceFirstPrice + Math.max(0, backflowQty - 1) * settings.backflowServiceAdditionalPrice : 0;
    const serviceTruckCharge = settings.travelProfile === "crd" ? settings.truckChargeCrd * (1 + (Number(settings.sprinklerTechnicians || 0) > 0 ? 1 : 0)) : Number(settings.estimatedRoundTripKm || 0) * 0.15 * (1 + (Number(settings.sprinklerTechnicians || 0) > 0 ? 1 : 0));
    const preTaxTotal = laborCost + Number(settings.miscCost || 0) + backflowSpecialPrice;
    return { itemMinutes, rawMinutes, minimumMinutes: selectedType.minimumMinutes, totalMinutes, hourlyRate, laborCost: Math.round(laborCost), backflowSpecialPrice: Math.round(backflowSpecialPrice), preTaxTotal: Math.round(preTaxTotal), truckCharge: Math.round(serviceTruckCharge), finalTotal: Math.round(preTaxTotal) + Math.round(serviceTruckCharge), hasReportProcessing: selectedType.reportProcessingHours > 0 };
  }, [serviceItems, serviceCounts, serviceMeta, travelMinutes, totalTechs, settings]);

  const currentResult = activeTab === "inspection" ? inspectionResults : activeTab === "service" ? serviceResults : null;

  const unlockChanges = () => {
    if (!changeReason.trim()) { setChangeReasonError("Please enter a reason before unlocking."); return; }
    setPricingLocked(false);
    setPendingUnlock(false);
    setChangeReason("");
    setChangeReasonError("");
  };

  const handleInspectionMinutesChange = (key: string, value: number) => setInspectionItems((prev) => prev.map((item) => item.key === key ? { ...item, minutes: value } : item));
  const handleInspectionDelete = (key: string) => {
    const target = inspectionItems.find((item) => item.key === key);
    const confirmed = window.confirm(`Are you sure you want to delete ${target?.label || "this row"}?`);
    if (!confirmed) return;
    setInspectionItems((prev) => prev.filter((item) => item.key !== key));
    setInspectionCounts((prev) => { const next = { ...prev }; delete next[key]; return next; });
    setItemNotes((prev) => { const next = { ...prev }; delete next[key]; return next; });
    setExpandedNotes((prev) => { const next = { ...prev }; delete next[key]; return next; });
  };

  const commitDrop = (target: DropTarget) => {
    if (!draggedInspectionKey || !target) return;
    setInspectionItems((prev) => {
      const draggedItem = prev.find((item) => item.key === draggedInspectionKey);
      if (!draggedItem) return prev;
      const remaining = prev.filter((item) => item.key !== draggedInspectionKey);
      const updatedDragged = { ...draggedItem, category: target.category };
      if (!target.targetKey) {
        const categoryItems = remaining.filter((item) => item.category === target.category);
        if (categoryItems.length === 0) return [...remaining, updatedDragged];
        const lastKey = categoryItems[categoryItems.length - 1].key;
        const insertIndex = remaining.findIndex((item) => item.key === lastKey) + 1;
        return [...remaining.slice(0, insertIndex), updatedDragged, ...remaining.slice(insertIndex)];
      }
      const targetIndex = remaining.findIndex((item) => item.key === target.targetKey);
      if (targetIndex === -1) return [...remaining, updatedDragged];
      return [...remaining.slice(0, targetIndex), updatedDragged, ...remaining.slice(targetIndex)];
    });
    setDraggedInspectionKey(null);
    setDropTarget(null);
  };

  const addInspectionItem = () => {
    if (!newItemDraft.label.trim()) return;
    const key = `${newItemDraft.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
    const newItem: InspectionItem = { key, label: newItemDraft.label.trim(), minutes: Number(newItemDraft.minutes || 0), category: newItemDraft.category };
    setInspectionItems((prev) => [...prev, newItem]);
    setInspectionCounts((prev) => ({ ...prev, [key]: 0 }));
    setItemNotes((prev) => ({ ...prev, [key]: "" }));
    setNewItemDraft({ label: "", minutes: 0, category: inspectionCategories[0] });
  };

  const buildQuoteSnapshot = (): SavedQuoteSnapshot => ({ activeTab, quoteAddresses, inspectionCounts, serviceCounts, serviceMeta, inspectionItems, settings, itemNotes });
  const restoreSavedQuote = (quote: SavedQuote) => {
    if (!quote.snapshot) return;
    setActiveTab(quote.snapshot.activeTab);
    setQuoteAddresses(quote.snapshot.quoteAddresses);
    setInspectionCounts(quote.snapshot.inspectionCounts);
    setServiceCounts(quote.snapshot.serviceCounts);
    setServiceMeta(quote.snapshot.serviceMeta);
    setInspectionItems(quote.snapshot.inspectionItems);
    setSettings(quote.snapshot.settings);
    setItemNotes(quote.snapshot.itemNotes || {});
    setShowSavedSidebar(false);
  };

  const clearCurrentQuoteInputs = () => {
    if (activeTab === "inspection") {
      setInspectionCounts(Object.fromEntries(inspectionItems.map((item) => [item.key, 0])));
      setQuoteAddresses((prev) => ({ ...prev, inspection: "" }));
      return;
    }
    if (activeTab === "service") {
      setServiceCounts(Object.fromEntries([...serviceItems.map((item) => [item.key, 0]), ["winterizationLowPoints", 0], ["additionalDryPipeValves", 0]]));
      setQuoteAddresses((prev) => ({ ...prev, service: "" }));
      return;
    }
    setQuoteAddresses((prev) => ({ ...prev, verification: "" }));
  };

  const saveCurrentQuote = () => {
    const address = quoteAddresses[activeTab]?.trim();
    const templateName = activeTab === "inspection" ? "New Service Location" : activeTab === "service" ? "Service & Returns" : "Verification Inspections";
    const entry: SavedQuote = { id: Date.now(), template: templateName, address: address || "No address entered", total: currentResult ? currentResult.finalTotal : 0, savedAt: new Date().toLocaleString(), snapshot: buildQuoteSnapshot() };
    setSavedQuotes((prev) => [entry, ...prev]);
    clearCurrentQuoteInputs();
  };

  const resetCounts = () => {
    setInspectionCounts(Object.fromEntries(inspectionItems.map((item) => [item.key, 0])));
    setServiceCounts(Object.fromEntries([...serviceItems.map((item) => [item.key, 0]), ["winterizationLowPoints", 0], ["additionalDryPipeValves", 0]]));
    setSettings((prev) => ({ ...prev, miscCost: 0 }));
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-[1550px] space-y-5">
        <div className="flex flex-col gap-4 rounded-2xl bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <LogoBlock />
            <div>
              <div className="flex items-center gap-2 text-sm text-slate-500"><ShieldAlert className="h-4 w-4" /> Internal Staff Tool</div>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Cantec&apos;s Quotation Calculator</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" title="Saved quotes" onClick={() => setShowSavedSidebar((v) => !v)}><FolderOpen className="h-4 w-4" /></Button>
            <Button variant="outline" size="icon" title="Settings" onClick={() => setShowSettingsSidebar((v) => !v)}><Settings className="h-4 w-4" /></Button>
            <Badge className="rounded-full px-4 py-2 text-sm">Preview Build v2.6</Badge>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.55fr_0.9fr]">
          <div className="space-y-5">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
              <TabsList className="grid w-full grid-cols-3 rounded-2xl bg-white p-1 shadow-sm">
                <TabsTrigger value="inspection" className="rounded-xl"><Building2 className="mr-2 h-4 w-4" />New Service Location</TabsTrigger>
                <TabsTrigger value="service" className="rounded-xl"><Wrench className="mr-2 h-4 w-4" />Service & Returns</TabsTrigger>
                <TabsTrigger value="verification" className="rounded-xl"><Calculator className="mr-2 h-4 w-4" />Verification Inspections</TabsTrigger>
              </TabsList>

              <TabsContent value="inspection" className="m-0">
                <Card className="rounded-2xl border-0 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" /> New Service Location</CardTitle>
                    <CardDescription>Drag rows to reorder within or between sections. Edit minutes when unlocked.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Quote Address</Label>
                      <Input className="h-8" value={quoteAddresses.inspection} onChange={(e) => setQuoteAddresses((prev) => ({ ...prev, inspection: e.target.value }))} placeholder="Enter site address" />
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-800"><Plus className="h-4 w-4" /> Add New Item</div>
                      <div className="grid gap-2 md:grid-cols-[minmax(0,1.4fr)_100px_220px_90px] md:items-end">
                        <div><Label className="text-[11px] text-slate-600">Label</Label><Input className="h-8" value={newItemDraft.label} onChange={(e) => setNewItemDraft((prev) => ({ ...prev, label: e.target.value }))} /></div>
                        <div><Label className="text-[11px] text-slate-600">Minutes</Label><Input className="h-8" type="number" min="0" step="0.25" value={newItemDraft.minutes} onChange={(e) => setNewItemDraft((prev) => ({ ...prev, minutes: Math.max(0, Number(e.target.value || 0)) }))} /></div>
                        <div><Label className="text-[11px] text-slate-600">Section</Label><Select value={newItemDraft.category} onValueChange={(value: InspectionCategory) => setNewItemDraft((prev) => ({ ...prev, category: value }))}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger><SelectContent>{inspectionCategories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select></div>
                        <Button className="h-8" onClick={addInspectionItem}>Add</Button>
                      </div>
                    </div>

                    {inspectionCategoryGroups.map((group) => {
                      const groupItems = group.categories.flatMap((category) => groupedInspectionItems[category] || []);
                      return (
                        <div key={group.key} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <button type="button" className="flex w-full items-center justify-between" onClick={() => setCollapsedGroups((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}>
                            <div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-slate-900">{group.label}</h3><Badge variant="secondary" className="rounded-full">{groupItems.length}</Badge></div>
                            <span className="text-sm text-slate-500">{collapsedGroups[group.key] ? "+" : "−"}</span>
                          </button>
                          {!collapsedGroups[group.key] ? (
                            <div className="space-y-3">
                              {group.categories.map((category) => (
                                <div key={category} className="space-y-2 rounded-lg border border-slate-200 bg-white/70 p-3" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); commitDrop({ category, targetKey: null }); }}>
                                  <div className="flex items-center gap-2"><h4 className="text-sm font-medium text-slate-900">{category}</h4><Badge variant="secondary" className="rounded-full">{(groupedInspectionItems[category] || []).length}</Badge></div>
                                  {category === "Passive Devices" ? <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>The minutes shown are for visual inspection only, not testing. We typically do not test passive devices every year.</span></div> : null}
                                  <div className="space-y-1">
                                    {(groupedInspectionItems[category] || []).map((item) => (
                                      <InspectionItemRow key={item.key} item={item} quantity={inspectionCounts[item.key] || 0} pricingLocked={pricingLocked} isDragging={draggedInspectionKey === item.key} isDropTarget={dropTarget?.targetKey === item.key && draggedInspectionKey !== item.key} note={itemNotes[item.key] || ""} isExpanded={!!expandedNotes[item.key]} onToggleNotes={() => setExpandedNotes((prev) => ({ ...prev, [item.key]: !prev[item.key] }))} onNoteChange={(value) => setItemNotes((prev) => ({ ...prev, [item.key]: value }))} onQuantityChange={(key, value) => setInspectionCounts((prev) => ({ ...prev, [key]: value }))} onMinutesChange={handleInspectionMinutesChange} onDelete={handleInspectionDelete} onDragStart={(key) => setDraggedInspectionKey(key)} onDragEnd={() => { setDraggedInspectionKey(null); setDropTarget(null); }} onDragEnterRow={(targetKey) => setDropTarget({ category, targetKey })} onDropOnItem={(targetKey, targetCategory) => commitDrop({ category: targetCategory, targetKey })} />
                                    ))}
                                    <div className={`h-2 rounded ${dropTarget?.category === category && dropTarget?.targetKey === null ? "bg-blue-200" : "bg-transparent"}`} onDragOver={(e) => { e.preventDefault(); setDropTarget({ category, targetKey: null }); }} onDrop={(e) => { e.preventDefault(); commitDrop({ category, targetKey: null }); }} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="service" className="m-0">
                <Card className="rounded-2xl border-0 shadow-sm">
                  <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2"><Wrench className="h-5 w-5" /> Service & Returns</CardTitle><CardDescription>Estimate service calls, tests, and returns with fixed internal timing rules.</CardDescription></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1"><Label className="text-xs text-slate-600">Quote Address</Label><Input className="h-8" value={quoteAddresses.service} onChange={(e) => setQuoteAddresses((prev) => ({ ...prev, service: e.target.value }))} placeholder="Enter site address" /></div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1"><Label className="text-xs text-slate-600">Service Type</Label><Select value={serviceMeta.serviceType} onValueChange={(value: keyof typeof serviceTypeOptions) => setServiceMeta((p) => ({ ...p, serviceType: value }))}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(serviceTypeOptions).map(([key, option]) => <SelectItem key={key} value={key}>{option.label}</SelectItem>)}</SelectContent></Select></div>
                      <div className="space-y-1"><Label className="text-xs text-slate-600">Backflow Pricing Mode</Label><Select value={serviceMeta.backflowMode} onValueChange={(value: "service" | "annual") => setServiceMeta((p) => ({ ...p, backflowMode: value }))}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="service">Service Call</SelectItem><SelectItem value="annual">During Annual Inspection</SelectItem></SelectContent></Select></div>
                    </div>
                    <div className="max-h-[860px] space-y-1.5 overflow-y-auto pr-1">
                      {serviceItems.map((item) => (
                        <div key={item.key} className="rounded-lg border border-slate-200 bg-white px-2 py-2">
                          <div className="grid gap-2 md:grid-cols-[minmax(0,1.7fr)_116px] md:items-center">
                            <div><div className="flex flex-wrap items-center gap-2"><p className="text-[13px] font-medium text-slate-900">{item.label}</p><Badge variant="secondary" className="rounded-full">{item.minutes} min</Badge></div><p className="mt-0.5 text-[10px] text-slate-600">{item.note}</p></div>
                            <div className="space-y-1"><QuantityInput value={serviceCounts[item.key]} onChange={(value) => setServiceCounts((prev) => ({ ...prev, [item.key]: value }))} />{item.key === "winterization" ? <QuantityInput value={serviceCounts.winterizationLowPoints} onChange={(value) => setServiceCounts((prev) => ({ ...prev, winterizationLowPoints: value }))} /> : null}{item.key === "testing3YearSprinkler" ? <QuantityInput value={serviceCounts.additionalDryPipeValves} onChange={(value) => setServiceCounts((prev) => ({ ...prev, additionalDryPipeValves: value }))} /> : null}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="verification" className="m-0">
                <Card className="rounded-2xl border-0 shadow-sm">
                  <CardHeader><CardTitle>Verification Inspections</CardTitle><CardDescription>Placeholder tab staged for the third calculator.</CardDescription></CardHeader>
                  <CardContent className="space-y-4"><div className="space-y-1"><Label className="text-xs text-slate-600">Quote Address</Label><Input className="h-8" value={quoteAddresses.verification} onChange={(e) => setQuoteAddresses((prev) => ({ ...prev, verification: e.target.value }))} placeholder="Enter site address" /></div><div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">This tab is ready for the future verification calculator build.</div></CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          <div className="space-y-5">
            {showSettingsSidebar ? (
              <Card className="rounded-2xl border-0 shadow-sm">
                <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5" /> Settings</CardTitle><CardDescription>Locked-change workflow and admin controls.</CardDescription></CardHeader>
                <CardContent className="space-y-5">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="font-medium text-slate-900">Locked-change workflow</p>
                    <p className="mt-1 text-sm text-slate-600">Rates and estimated minutes stay locked unless a reason is entered.</p>
                    <div className="mt-3 space-y-3">
                      {pricingLocked && !pendingUnlock ? <Button variant="outline" onClick={() => { setPendingUnlock(true); setChangeReasonError(""); }}>Are you sure you want to change it?</Button> : null}
                      {pricingLocked && pendingUnlock ? <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><Textarea rows={3} value={changeReason} onChange={(e) => setChangeReason(e.target.value)} placeholder="Enter reason for changing locked quotation values" />{changeReasonError ? <p className="text-sm text-red-600">{changeReasonError}</p> : null}<div className="flex gap-2"><Button onClick={unlockChanges}>Yes, unlock</Button><Button variant="outline" onClick={() => { setPendingUnlock(false); setChangeReason(""); setChangeReasonError(""); }}>Cancel</Button></div></div> : null}
                      {!pricingLocked ? <Button variant="outline" onClick={() => setPricingLocked(true)}>Lock Values Again</Button> : null}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <NumberField label="Annual Inspection Rate" value={settings.annualInspectionRate} onChange={(v) => setSettings((p) => ({ ...p, annualInspectionRate: v }))} disabled={pricingLocked} />
                    <NumberField label="FA Recurring Rate" value={settings.recurringFireAlarmRate} onChange={(v) => setSettings((p) => ({ ...p, recurringFireAlarmRate: v }))} disabled={pricingLocked} />
                    <NumberField label="FA Service Rate" value={settings.fireAlarmServiceRate} onChange={(v) => setSettings((p) => ({ ...p, fireAlarmServiceRate: v }))} disabled={pricingLocked} />
                    <NumberField label="Sprinkler Annual Rate" value={settings.sprinklerAnnualRate} onChange={(v) => setSettings((p) => ({ ...p, sprinklerAnnualRate: v }))} disabled={pricingLocked} />
                    <NumberField label="Sprinkler Service Rate" value={settings.sprinklerServiceRate} onChange={(v) => setSettings((p) => ({ ...p, sprinklerServiceRate: v }))} disabled={pricingLocked} />
                    <NumberField label="Verification Rate" value={settings.verificationRate} onChange={(v) => setSettings((p) => ({ ...p, verificationRate: v }))} disabled={pricingLocked} />
                    <NumberField label="Truck Charge (CRD)" value={settings.truckChargeCrd} onChange={(v) => setSettings((p) => ({ ...p, truckChargeCrd: v }))} disabled={pricingLocked} step="0.01" />
                    <NumberField label="Hydrant Fixed Rate" value={settings.hydrantFixedPrice} onChange={(v) => setSettings((p) => ({ ...p, hydrantFixedPrice: v }))} disabled={pricingLocked} step="0.01" />
                    <NumberField label="Annual Backflow Rate" value={settings.backflowAnnualFixedPrice} onChange={(v) => setSettings((p) => ({ ...p, backflowAnnualFixedPrice: v }))} disabled={pricingLocked} step="0.01" />
                    <NumberField label="Service Backflow First" value={settings.backflowServiceFirstPrice} onChange={(v) => setSettings((p) => ({ ...p, backflowServiceFirstPrice: v }))} disabled={pricingLocked} step="0.01" />
                    <NumberField label="Service Backflow Additional" value={settings.backflowServiceAdditionalPrice} onChange={(v) => setSettings((p) => ({ ...p, backflowServiceAdditionalPrice: v }))} disabled={pricingLocked} step="0.01" />
                    <NumberField label="5-Year FDC Only" value={settings.fiveYearFdcOnlyFixedPrice} onChange={(v) => setSettings((p) => ({ ...p, fiveYearFdcOnlyFixedPrice: v }))} disabled={pricingLocked} step="0.01" />
                    <NumberField label="5-Year FDC + Standpipe" value={settings.fiveYearFdcStandpipeFixedPrice} onChange={(v) => setSettings((p) => ({ ...p, fiveYearFdcStandpipeFixedPrice: v }))} disabled={pricingLocked} step="0.01" />
                    <NumberField label="Admin Buffer Min" value={settings.adminBufferMinutes} onChange={(v) => setSettings((p) => ({ ...p, adminBufferMinutes: v }))} disabled={pricingLocked} />
                    <NumberField label="Setup/Cleanup Min" value={settings.setupBufferMinutes} onChange={(v) => setSettings((p) => ({ ...p, setupBufferMinutes: v }))} disabled={pricingLocked} />
                    <NumberField label="Misc Cost" value={settings.miscCost} onChange={(v) => setSettings((p) => ({ ...p, miscCost: v }))} />
                    <NumberField label="Inspection Technicians" value={settings.inspectionTechnicians} onChange={(v) => setSettings((p) => ({ ...p, inspectionTechnicians: v || 1 }))} helper="Used for travel minutes only." />
                    <NumberField label="FA Technicians" value={settings.fireAlarmTechnicians} onChange={(v) => setSettings((p) => ({ ...p, fireAlarmTechnicians: v || 1 }))} />
                    <NumberField label="Sprinkler Tech / Vans" value={settings.sprinklerTechnicians} onChange={(v) => setSettings((p) => ({ ...p, sprinklerTechnicians: v }))} />
                    <div className="space-y-1"><Label className="text-[11px] text-slate-600">Travel Profile</Label><Select value={settings.travelProfile} onValueChange={(value: keyof typeof travelProfiles) => setSettings((p) => ({ ...p, travelProfile: value }))}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(travelProfiles).map(([key, profile]) => <SelectItem key={key} value={key}>{profile.label}</SelectItem>)}</SelectContent></Select></div>
                    <NumberField label="Travel Minutes RT" value={settings.customTravelMinutes} onChange={(v) => setSettings((p) => ({ ...p, customTravelMinutes: v }))} disabled={pricingLocked} />
                    <NumberField label="Round Trip KM" value={settings.estimatedRoundTripKm} onChange={(v) => setSettings((p) => ({ ...p, estimatedRoundTripKm: v }))} disabled={pricingLocked} step="0.1" />
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="mb-3 flex items-center gap-2"><History className="h-4 w-4 text-slate-500" /><p className="font-medium text-slate-900">Inspection Device Minutes</p></div>
                    <div className="max-h-[260px] space-y-2 overflow-y-auto pr-1">
                      {inspectionItems.map((item) => (
                        <div key={`settings-${item.key}`} className="grid grid-cols-[minmax(0,1fr)_84px] items-center gap-2">
                          <p className="truncate text-xs text-slate-700">{item.label}</p>
                          <Input className="h-8" type="number" min="0" step="0.25" disabled={pricingLocked} value={item.minutes} onChange={(e) => handleInspectionMinutesChange(item.key, Math.max(0, Number(e.target.value || 0)))} />
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {showSavedSidebar ? (
              <Card className="rounded-2xl border-0 shadow-sm">
                <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2"><FolderOpen className="h-5 w-5" /> Saved Quotes</CardTitle><CardDescription>Open a saved quote to continue editing.</CardDescription></CardHeader>
                <CardContent className="space-y-3">
                  {savedQuotes.length === 0 ? <p className="text-sm text-slate-500">No saved quotes yet.</p> : savedQuotes.map((quote) => <button key={quote.id} type="button" onClick={() => restoreSavedQuote(quote)} className="w-full rounded-lg bg-slate-50 p-3 text-left text-sm hover:bg-slate-100"><div className="flex items-center justify-between gap-3"><p className="font-medium text-slate-900">{quote.template}</p><p className="font-medium text-slate-900">{formatCurrency(quote.total)}</p></div><p className="mt-1 text-slate-600">{quote.address}</p><p className="mt-1 text-xs text-slate-500">Saved {quote.savedAt}</p></button>)}
                </CardContent>
              </Card>
            ) : null}

            <Card className="rounded-2xl border-0 shadow-sm xl:sticky xl:top-4">
              <CardHeader className="pb-3"><CardTitle>Estimate Summary</CardTitle><CardDescription>{activeTab === "inspection" ? "New Service Location summary" : activeTab === "service" ? "Service & Returns summary" : "Verification summary"}</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                {activeTab === "inspection" && inspectionResults.rawMinutes < inspectionResults.minimumMinutes ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Minimum annual inspection charge applied: 1 hour.</div> : null}
                {activeTab === "service" && serviceResults.rawMinutes < serviceResults.minimumMinutes ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Minimum charge applied: {serviceResults.minimumMinutes === 120 ? "2 hours for verifications" : "1 hour for service"}.</div> : null}

                <div className="space-y-2 rounded-2xl bg-slate-50 p-4">
                  <SummaryRow label="Quote Address" value={quoteAddresses[activeTab] || "-"} />
                  <SummaryRow label="Device / Task Minutes" value={`${activeTab === "inspection" ? inspectionResults.itemMinutes : activeTab === "service" ? serviceResults.itemMinutes : 0} min`} />
                  <SummaryRow label="Travel Minutes" value={`${activeTab === "inspection" ? travelMinutes * inspectionTechnicians : travelMinutes * totalTechs} min`} />
                  <SummaryRow label="Total Technicians" value={`${activeTab === "inspection" ? inspectionTechnicians : totalTechs}`} />
                </div>

                <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
                  {activeTab === "inspection" ? <SummaryRow label="Inspection Rate Applied" value={formatCurrency(settings.annualInspectionRate)} /> : null}
                  {activeTab === "service" ? <SummaryRow label="Service Type" value={serviceTypeOptions[serviceMeta.serviceType].label} /> : null}
                  {activeTab === "service" ? <SummaryRow label="Hourly Rate Applied" value={formatCurrency(serviceResults.hourlyRate)} /> : null}
                  <SummaryRow label="Total Estimated Hours" value={activeTab === "inspection" ? formatHours(inspectionResults.totalEstimatedHoursMinutes) : activeTab === "service" ? formatHours(serviceResults.totalMinutes) : "-"} />
                  {activeTab === "inspection" ? <SummaryRow label="Adjusted for 2 Technicians" value={formatHours(inspectionResults.adjustedForTwoTechsMinutes)} /> : null}
                  {activeTab === "inspection" ? <SummaryRow label="Inspection Days (7.5 hr/day)" value={formatDays(inspectionResults.inspectionDays)} /> : null}
                  <SummaryRow label="Labor Cost" value={activeTab === "inspection" ? formatCurrency(inspectionResults.laborCost) : activeTab === "service" ? formatCurrency(serviceResults.laborCost) : "-"} />
                  {activeTab === "inspection" ? <SummaryRow label="Fixed Sprinkler Pricing" value={formatCurrency(fixedInspectionPricing.total)} /> : null}
                  {activeTab === "service" ? <SummaryRow label="Backflow Special Pricing" value={formatCurrency(serviceResults.backflowSpecialPrice)} /> : null}
                  {activeTab === "service" && serviceResults.hasReportProcessing ? <SummaryRow label="Verification Report Processing" value={formatCurrency(settings.verificationRate)} /> : null}
                  <SummaryRow label="Pre-Tax Total" value={activeTab === "inspection" ? formatCurrency(inspectionResults.preTaxTotal) : activeTab === "service" ? formatCurrency(serviceResults.preTaxTotal) : "-"} />
                  <SummaryRow label="Truck Charge" value={activeTab === "inspection" ? formatCurrency(inspectionResults.truckCharge) : activeTab === "service" ? formatCurrency(serviceResults.truckCharge) : "-"} />
                  <Separator />
                  <SummaryRow label="Quoted Total" bold value={activeTab === "inspection" ? formatCurrency(inspectionResults.finalTotal) : activeTab === "service" ? formatCurrency(serviceResults.finalTotal) : "-"} />
                </div>

                <Button className="w-full" onClick={saveCurrentQuote}><Save className="mr-2 h-4 w-4" />Save Quote</Button>
                <div className="rounded-xl border border-slate-200 bg-white p-3"><button type="button" className="flex w-full items-center justify-between text-sm font-medium text-slate-800" onClick={() => setRecentSavedOpen((v) => !v)}><span>Recently Saved</span><span>{recentSavedOpen ? "−" : "+"}</span></button>{recentSavedOpen ? <div className="mt-3 space-y-2">{savedQuotes.slice(0, 5).length === 0 ? <p className="text-sm text-slate-500">No recent saved quotes.</p> : savedQuotes.slice(0, 5).map((quote) => <button key={`recent-${quote.id}`} type="button" onClick={() => restoreSavedQuote(quote)} className="w-full rounded-lg bg-slate-50 p-2 text-left text-sm hover:bg-slate-100"><div className="flex items-center justify-between gap-2"><span className="font-medium text-slate-900">{quote.template}</span><span className="text-slate-900">{formatCurrency(quote.total)}</span></div><div className="mt-1 text-xs text-slate-500">{quote.address}</div></button>)}</div> : null}</div>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="flex flex-wrap gap-3"><Button onClick={resetCounts}>Reset Counts</Button><Button variant="outline">Print Quote Summary (next step)</Button></div>
      </div>
    </div>
  );
}
