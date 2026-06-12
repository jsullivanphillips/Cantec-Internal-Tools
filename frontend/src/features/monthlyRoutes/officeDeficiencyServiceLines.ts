export const OFFICE_DEFICIENCY_SERVICE_LINES = [
  { value: 'alarm_system', label: 'Alarm Systems' },
  { value: 'emergency_light', label: 'Emergency Light' },
  { value: 'extinguishers', label: 'Extinguishers' },
] as const

export type OfficeDeficiencyServiceLine =
  (typeof OFFICE_DEFICIENCY_SERVICE_LINES)[number]['value']

export const DEFAULT_OFFICE_DEFICIENCY_SERVICE_LINE: OfficeDeficiencyServiceLine =
  'alarm_system'
