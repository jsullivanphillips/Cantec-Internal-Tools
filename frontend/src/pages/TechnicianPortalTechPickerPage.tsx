import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Form, Spinner } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { apiJson } from '../lib/apiClient'

type PortalTechnician = {
  id: string
  name: string
}

type TechniciansResponse = {
  technicians: PortalTechnician[]
}

type SessionTechnicianResponse = {
  technician: PortalTechnician | null
}

export default function TechnicianPortalTechPickerPage() {
  const nav = useNavigate()
  const [technicians, setTechnicians] = useState<PortalTechnician[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [submittingId, setSubmittingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const session = await apiJson<SessionTechnicianResponse>('/api/technician_portal/session/technician')
        if (cancelled) return
        if (session.technician) {
          nav('/tech/start', { replace: true })
          return
        }
      } catch {
        /* no session tech — stay on picker */
      }
      try {
        const data = await apiJson<TechniciansResponse>('/api/technician_portal/technicians')
        if (cancelled) return
        setTechnicians(data.technicians ?? [])
      } catch {
        if (!cancelled) setError('Could not load technicians.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [nav])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return technicians
    return technicians.filter(
      (t) => t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q),
    )
  }, [technicians, query])

  const onSelect = useCallback(
    async (tech: PortalTechnician) => {
      setSubmittingId(tech.id)
      setError(null)
      try {
        await apiJson('/api/technician_portal/session/technician', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: tech.id, name: tech.name }),
        })
        nav('/tech/start', { replace: true })
      } catch {
        setError('Could not save your selection. Try again.')
        setSubmittingId(null)
      }
    },
    [nav],
  )

  return (
    <div className="container py-4" style={{ maxWidth: '28rem' }}>
      <h1 className="h4 mb-1">Who is testing today?</h1>
      <p className="text-muted small mb-3">Select your name to continue.</p>

      {error ? (
        <Alert variant="danger" className="small">
          {error}
        </Alert>
      ) : null}

      <Form.Control
        type="search"
        placeholder="Search by name…"
        className="mb-3"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={loading}
        autoFocus
      />

      {loading ? (
        <div className="text-center py-4">
          <Spinner animation="border" size="sm" className="me-2" />
          Loading technicians…
        </div>
      ) : filtered.length === 0 ? (
        <Alert variant="secondary" className="small mb-0">
          No technicians match your search.
        </Alert>
      ) : (
        <div className="d-flex flex-column gap-2">
          {filtered.map((tech) => (
            <Card key={tech.id} className="shadow-sm">
              <Card.Body className="p-2">
                <Button
                  variant="outline-primary"
                  className="w-100 text-start"
                  disabled={submittingId != null}
                  onClick={() => void onSelect(tech)}
                >
                  {submittingId === tech.id ? (
                    <>
                      <Spinner size="sm" animation="border" className="me-2" />
                      Saving…
                    </>
                  ) : (
                    tech.name
                  )}
                </Button>
              </Card.Body>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
