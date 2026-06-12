import { apiJson } from '../../lib/apiClient'
import type { ServiceTradeDeficienciesPayload } from './monthlyRoutesShared'

export const SERVICE_TRADE_DEFICIENCY_APP_BASE =
  'https://app.servicetrade.com/deficiency/details/id'

export function serviceTradeDeficiencyUrl(deficiencyId: number): string {
  return `${SERVICE_TRADE_DEFICIENCY_APP_BASE}/${deficiencyId}`
}

export async function fetchServiceTradeDeficiencies(
  locationId: number,
): Promise<ServiceTradeDeficienciesPayload> {
  return apiJson<ServiceTradeDeficienciesPayload>(
    `/api/monthly_routes/library/${locationId}/service_trade_deficiencies`,
  )
}

export function formatServiceTradeDeficiencyError(err: unknown): string {
  if (err && typeof err === 'object') {
    const o = err as { error?: unknown; code?: unknown }
    if (typeof o.error === 'string' && o.error.trim()) return o.error
    if (o.code === 'no_servicetrade_link') {
      return 'This site is not linked to ServiceTrade.'
    }
    if (o.code === 'service_trade_config') {
      return 'ServiceTrade is not configured on the server.'
    }
    if (o.code === 'service_trade_unavailable') {
      return 'Could not reach ServiceTrade. Try again later.'
    }
  }
  if (typeof err === 'string' && err.trim()) return err
  return 'Could not load ServiceTrade deficiencies.'
}
