import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiJson } from '../lib/apiClient'
import { Spinner } from 'react-bootstrap'

export default function KeyByBarcodePage() {
  const { barcode } = useParams<{ barcode: string }>()
  const nav = useNavigate()

  useEffect(() => {
    if (!barcode) return
    ;(async () => {
      try {
        const d = await apiJson<{ id: number }>(`/api/keys/resolve-barcode/${encodeURIComponent(barcode)}`)
        nav(`/keys/${d.id}`, { replace: true })
      } catch {
        nav('/keys', { replace: true })
      }
    })()
  }, [barcode, nav])

  return (
    <div className="text-center py-5">
      <Spinner />
    </div>
  )
}
