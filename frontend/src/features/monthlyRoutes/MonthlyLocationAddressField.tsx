import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { apiJson, isAbortError } from '../../lib/apiClient'
import type { GeocodeCandidate } from './monthlyRoutesShared'
import PortalFieldEditActionButtons from './PortalFieldEditActionButtons'
import type { PortalFieldEditActions } from './PortalEditableFieldRow'
import {
  createPortalFieldEditBlurHandler,
  schedulePortalFieldRowScroll,
} from './portalFieldEditRegistry'

const GEOCODE_DEBOUNCE_MS = 250

const CANDIDATES_STYLE: CSSProperties = {
  maxHeight: '11rem',
  overflowY: 'auto',
}

type MonthlyLocationAddressFieldProps = {
  fieldKey: string
  label: string
  hint?: string
  value: string
  readOnly?: boolean
  editingField: string | null
  onEditingFieldChange: (key: string | null) => void
  onSave: (candidate: GeocodeCandidate) => void | Promise<void>
  onRegisterFieldEditActions?: (actions: PortalFieldEditActions) => void
  onUnregisterFieldEditActions?: (fieldKey: string) => void
}

export default function MonthlyLocationAddressField({
  fieldKey,
  label,
  hint,
  value,
  readOnly,
  editingField,
  onEditingFieldChange,
  onSave,
  onRegisterFieldEditActions,
  onUnregisterFieldEditActions,
}: MonthlyLocationAddressFieldProps) {
  const inputId = useId()
  const rowRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const committed = value.trim()
  const editing = !readOnly && editingField === fieldKey

  const [addressQuery, setAddressQuery] = useState(committed)
  const [candidates, setCandidates] = useState<GeocodeCandidate[]>([])
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [selectedCandidate, setSelectedCandidate] = useState<GeocodeCandidate | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  useEffect(() => {
    savingRef.current = saving
  }, [saving])

  useEffect(() => {
    if (!editing) {
      setAddressQuery(committed)
      setCandidates([])
      setLookupLoading(false)
      setLookupError(null)
      setSelectedCandidate(null)
      setValidationError(null)
      setSaving(false)
    }
  }, [committed, editing])

  useEffect(() => {
    if (!editing) return
    const query = addressQuery.trim()
    if (query.length < 3) {
      setCandidates([])
      setLookupLoading(false)
      setLookupError(null)
      return
    }

    let active = true
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLookupLoading(true)
      setLookupError(null)
      const params = new URLSearchParams({ q: query })
      apiJson<{ candidates: GeocodeCandidate[] }>(
        `/api/monthly_routes/geocode_candidates?${params.toString()}`,
        { signal: controller.signal },
      )
        .then((data) => {
          if (active) setCandidates(data.candidates || [])
        })
        .catch((err) => {
          if (!isAbortError(err) && active) {
            setCandidates([])
            setLookupError('Unable to fetch address suggestions.')
          }
        })
        .finally(() => {
          if (active) setLookupLoading(false)
        })
    }, GEOCODE_DEBOUNCE_MS)

    return () => {
      active = false
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [addressQuery, editing])

  useLayoutEffect(() => {
    if (!editing) return undefined
    return schedulePortalFieldRowScroll(rowRef)
  }, [editing])

  const cancel = useCallback(() => {
    if (saving) return
    setAddressQuery(committed)
    setCandidates([])
    setLookupLoading(false)
    setLookupError(null)
    setSelectedCandidate(null)
    setValidationError(null)
    onEditingFieldChange(null)
  }, [committed, onEditingFieldChange, saving])

  const commit = useCallback(async () => {
    if (saving) return
    setValidationError(null)
    if (selectedCandidate) {
      const nextAddress = selectedCandidate.display_address.trim()
      if (nextAddress.toLowerCase() === committed.toLowerCase()) {
        onEditingFieldChange(null)
        return
      }
      setSaving(true)
      try {
        await onSave(selectedCandidate)
        onEditingFieldChange(null)
      } catch {
        // Parent surfaces save errors.
      } finally {
        setSaving(false)
      }
      return
    }

    const query = addressQuery.trim()
    if (!query) {
      setValidationError('Navigation address is required.')
      return
    }
    if (query.toLowerCase() === committed.toLowerCase()) {
      onEditingFieldChange(null)
      return
    }
    setValidationError('Select an address from the search results.')
  }, [addressQuery, committed, onEditingFieldChange, onSave, saving, selectedCandidate])

  const commitRef = useRef(commit)
  const cancelRef = useRef(cancel)
  commitRef.current = commit
  cancelRef.current = cancel

  const handleEditBlur = useMemo(
    () =>
      createPortalFieldEditBlurHandler(
        rowRef,
        () => savingRef.current,
        () => cancelRef.current(),
      ),
    [],
  )

  useLayoutEffect(() => {
    if (!editing) return undefined

    const input = inputRef.current
    try {
      input?.focus({ preventScroll: true })
    } catch {
      input?.focus()
    }

    const actions: PortalFieldEditActions = {
      fieldKey,
      cancel: () => cancelRef.current(),
      save: () => void commitRef.current(),
    }
    onRegisterFieldEditActions?.(actions)

    return () => {
      onUnregisterFieldEditActions?.(fieldKey)
    }
  }, [editing, fieldKey, onRegisterFieldEditActions, onUnregisterFieldEditActions])

  const startEdit = () => {
    if (readOnly) return
    setAddressQuery(committed)
    setCandidates([])
    setLookupError(null)
    setSelectedCandidate(null)
    setValidationError(null)
    onEditingFieldChange(fieldKey)
  }

  const labelBlock = hint ? (
    <>
      <span>{label}</span>
      <span className="pw-mock-field-hint">{hint}</span>
    </>
  ) : (
    label
  )

  const display = committed || '—'

  if (!editing) {
    return (
      <div
        className={`pw-mock-field-row monthly-location-address-field${
          readOnly ? '' : ' pw-mock-field-row--editable'
        }`}
        role={readOnly ? undefined : 'button'}
        tabIndex={readOnly ? undefined : 0}
        onClick={startEdit}
        onKeyDown={(e) => {
          if (readOnly) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            startEdit()
          }
        }}
      >
        <div className="pw-mock-field-label">{labelBlock}</div>
        <div className="pw-mock-field-value">{display}</div>
      </div>
    )
  }

  return (
    <div
      ref={rowRef}
      className="pw-mock-field-row pw-mock-field-row--editing monthly-location-address-field"
    >
      <label className="pw-mock-field-label" htmlFor={inputId}>
        {labelBlock}
      </label>
      <div className="pw-mock-field-value" onBlur={handleEditBlur}>
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          className="pw-mock-field-input"
          value={addressQuery}
          placeholder="Search address (Greater Victoria)"
          disabled={saving}
          onChange={(e) => {
            setAddressQuery(e.target.value)
            setSelectedCandidate(null)
            setValidationError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
          }}
        />
        {!selectedCandidate && lookupLoading ? (
          <div className="monthly-location-address-field-status text-muted">Searching addresses…</div>
        ) : null}
        {!selectedCandidate && lookupError ? (
          <div className="monthly-location-address-field-status text-danger">{lookupError}</div>
        ) : null}
        {!selectedCandidate &&
        !lookupLoading &&
        addressQuery.trim().length >= 3 &&
        candidates.length === 0 &&
        !lookupError ? (
          <div className="monthly-location-address-field-status text-muted">No matching addresses.</div>
        ) : null}
        {!selectedCandidate && candidates.length > 0 ? (
          <div
            className="monthly-location-address-candidates d-flex flex-column gap-1"
            style={CANDIDATES_STYLE}
          >
            {candidates.map((candidate) => (
              <button
                key={`${candidate.display_address}-${candidate.latitude}-${candidate.longitude}`}
                type="button"
                className="monthly-location-address-candidate-btn"
                disabled={saving}
                onClick={() => {
                  setSelectedCandidate(candidate)
                  setAddressQuery(candidate.display_address)
                  setCandidates([])
                  setValidationError(null)
                }}
              >
                {candidate.display_address}
              </button>
            ))}
          </div>
        ) : null}
        {selectedCandidate ? (
          <div className="monthly-location-address-field-status text-success">
            Map pin will use the selected address.
          </div>
        ) : null}
        {validationError ? (
          <div className="monthly-location-address-field-status text-danger">{validationError}</div>
        ) : null}
        <PortalFieldEditActionButtons
          saving={saving}
          onCancel={cancel}
          onSubmit={() => void commit()}
        />
      </div>
    </div>
  )
}
