import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Alert, Button, Card, Form, Spinner } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { apiFetch, apiJson } from '../lib/apiClient'

type PortalMeResponse = {
  unlocked: boolean
  configured: boolean
}

const PIN_PATTERN = /^[0-9]{1,12}$/

export default function TechnicianPortalLockPage() {
  const nav = useNavigate()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const me = await apiJson<PortalMeResponse>('/api/technician_portal/me')
        if (cancelled) return
        setConfigured(!!me.configured)
        if (me.unlocked) {
          nav('/tech/start', { replace: true })
        }
      } catch {
        if (cancelled) return
        setConfigured(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [nav])

  useEffect(() => {
    if (configured) inputRef.current?.focus()
  }, [configured])

  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      setError(null)
      const trimmed = pin.trim()
      if (!PIN_PATTERN.test(trimmed)) {
        setError('Enter your portal PIN.')
        return
      }
      setSubmitting(true)
      try {
        const res = await apiFetch('/api/technician_portal/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: trimmed }),
        })
        if (res.ok) {
          nav('/tech/start', { replace: true })
          return
        }
        if (res.status === 503) {
          setError('Technician portal is not configured. Ask the office to set TECHNICIAN_PORTAL_PIN.')
        } else {
          setError('Incorrect PIN. Try again.')
        }
        setPin('')
        inputRef.current?.focus()
      } catch {
        setError('Network error. Check your connection and try again.')
      } finally {
        setSubmitting(false)
      }
    },
    [nav, pin]
  )

  return (
    <div className="container py-5 d-flex justify-content-center">
      <Card className="shadow-sm" style={{ maxWidth: '24rem', width: '100%' }}>
        <Card.Body className="p-4">
          <h1 className="h4 mb-1">Technician Portal</h1>
          <div className="text-muted small mb-3">Enter your portal PIN to start a route.</div>
          {configured === false ? (
            <Alert variant="warning" className="small mb-3">
              The portal is not yet configured on this server.
            </Alert>
          ) : null}
          <Form onSubmit={onSubmit}>
            <Form.Group className="mb-3" controlId="techPortalPin">
              <Form.Label className="small mb-1">PIN</Form.Label>
              <Form.Control
                ref={inputRef}
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="••••"
                size="lg"
                disabled={submitting}
              />
            </Form.Group>
            {error ? (
              <Alert variant="danger" className="small mb-3">
                {error}
              </Alert>
            ) : null}
            <div className="d-grid">
              <Button type="submit" variant="primary" size="lg" disabled={submitting || !pin.trim()}>
                {submitting ? (
                  <>
                    <Spinner size="sm" animation="border" className="me-2" /> Unlocking…
                  </>
                ) : (
                  'Unlock'
                )}
              </Button>
            </div>
          </Form>
        </Card.Body>
      </Card>
    </div>
  )
}
