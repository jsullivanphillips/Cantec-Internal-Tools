export type SlaJobRow = {
  quote_id: number
  job_id: number
  location_address: string | null
  deficiency_service_line: string | null
  quote_created_by: string | null
  job_created_by: string | null
  deficiency_reported_on: string | null
  quote_created_on: string | null
  quote_accepted_on: string
  scheduled_on: string
  scheduled_date: string | null
  days_deficiency_to_quote: number | null
  days_quote_to_approval: number | null
  days_approval_to_scheduled: number
  days_deficiency_to_scheduled: number | null
  business_days: number
  within_sla: boolean
  job_url: string
}

export type SlaMissingScheduleJobRow = {
  quote_id: number
  job_id: number | null
  location_address: string | null
  deficiency_service_line: string | null
  quote_created_by: string | null
  job_created_by: string | null
  deficiency_reported_on: string | null
  quote_created_on: string | null
  quote_accepted_on: string | null
  scheduled_date: null
  no_job_created: boolean
  no_job_record: boolean
  job_url: string
  days_since_approval?: number | null
}
