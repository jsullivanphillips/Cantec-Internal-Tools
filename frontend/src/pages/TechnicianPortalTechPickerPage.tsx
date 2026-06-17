import { useCallback, useEffect, useMemo, useState } from 'react'
import { Form, Spinner } from 'react-bootstrap'
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
          nav('/tech/home', { replace: true })
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
        nav('/tech/home', { replace: true })
      } catch {
        setError('Could not save your selection. Try again.')
        setSubmittingId(null)
      }
    },
    [nav],
  )

  return (
    <div className="portal-picker-scene">
      <div className="portal-picker-scene__mesh" aria-hidden="true" />

      <div className="portal-picker-page">
        <header className="portal-picker-header">
          <h1 className="portal-picker-header__title">Welcome</h1>
          <p className="portal-picker-header__subtitle">Select your name from the list to continue.</p>
        </header>

        <section className="portal-picker-glass" aria-label="Technician selection">
          {error ? (
            <div className="portal-flow-notice portal-flow-notice--error" role="alert">
              {error}
            </div>
          ) : null}

          <Form.Control
            type="search"
            placeholder="Search by name…"
            className="portal-glass-input mb-3"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={loading}
            autoFocus
          />

          {loading ? (
            <div className="portal-picker-status" role="status">
              <Spinner animation="border" size="sm" className="me-2" />
              Loading technicians…
            </div>
          ) : filtered.length === 0 ? (
            <div className="portal-flow-notice portal-flow-notice--muted" role="status">
              No technicians match your search.
            </div>
          ) : (
            <ul className="portal-tech-list">
              {filtered.map((tech) => {
                const isSubmitting = submittingId === tech.id
                const isDisabled = submittingId != null

                return (
                  <li key={tech.id}>
                    <button
                      type="button"
                      className="portal-tech-option"
                      disabled={isDisabled}
                      onClick={() => void onSelect(tech)}
                    >
                      {isSubmitting ? (
                        <>
                          <Spinner size="sm" animation="border" className="me-2" />
                          Saving…
                        </>
                      ) : (
                        tech.name
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
