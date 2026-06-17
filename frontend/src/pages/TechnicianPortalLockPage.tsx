import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, Form, Spinner } from 'react-bootstrap'
import { useNavigate } from 'react-router-dom'
import { apiFetch, apiJson } from '../lib/apiClient'

type PortalMeResponse = {
  unlocked: boolean
  configured: boolean
  technician?: { id: string | null; name: string | null } | null
}

const PIN_PATTERN = /^[0-9]{1,12}$/

export default function TechnicianPortalLockPage() {
  const nav = useNavigate()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [logoFailed, setLogoFailed] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const me = await apiJson<PortalMeResponse>('/api/technician_portal/me')
        if (cancelled) return
        setConfigured(!!me.configured)
        if (me.unlocked) {
          if (me.technician?.name) {
            nav('/tech/home', { replace: true })
          } else {
            nav('/tech/technician', { replace: true })
          }
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
          try {
            const me = await apiJson<PortalMeResponse>('/api/technician_portal/me')
            if (me.technician?.name) {
              nav('/tech/home', { replace: true })
            } else {
              nav('/tech/technician', { replace: true })
            }
          } catch {
            nav('/tech/technician', { replace: true })
          }
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
    <div className="portal-lock-scene">
      <div className="portal-lock-scene__mesh" aria-hidden="true" />

      <div className="portal-lock-page">
        <header className="portal-lock-brand">
          {!logoFailed ? (
            <img
              src="/cantec-logo-horizontal.png"
              alt="Cantec"
              className="portal-lock-brand__logo"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <h1 className="portal-lock-brand__fallback">Cantec</h1>
          )}
          <p className="portal-lock-brand__product">Monthly Bell Testing</p>
        </header>

        <section className="portal-lock-glass" aria-label="PIN entry">
          {configured === false ? (
            <div className="portal-lock-notice portal-lock-notice--warning" role="status">
              The portal is not yet configured on this server.
            </div>
          ) : null}

          <Form onSubmit={onSubmit} className="portal-lock-form">
            <Form.Group className="portal-lock-field" controlId="techPortalPin">
              <Form.Control
                ref={inputRef}
                className="portal-lock-pin-input"
                type="tel"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                enterKeyHint="go"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="Enter PIN"
                disabled={submitting}
              />
            </Form.Group>

            {error ? (
              <div className="portal-lock-notice portal-lock-notice--error" role="alert">
                {error}
              </div>
            ) : null}

            <Button
              type="submit"
              className="portal-lock-submit w-100"
              disabled={submitting || !pin.trim()}
            >
              {submitting ? (
                <>
                  <Spinner size="sm" animation="border" className="me-2" /> Submitting…
                </>
              ) : (
                'Submit'
              )}
            </Button>
          </Form>
        </section>
      </div>
    </div>
  )
}
