import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/apiClient'
import { Spinner } from 'react-bootstrap'

export default function WebhookStatusPage() {
  const [data, setData] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    apiFetch('/webhooks/status/data')
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
  }, [])

  if (!data) {
    return (
      <div className="text-center py-5">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="container py-4">
      <h1 className="h4 mb-3">Webhook status</h1>
      <pre className="bg-white border rounded p-3">{JSON.stringify(data, null, 2)}</pre>
    </div>
  )
}
