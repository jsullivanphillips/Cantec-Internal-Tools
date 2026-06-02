export default function RunDetailsStopSiteReadOnlyField({
  label,
  value,
  multiline,
}: {
  label: string
  value: string | null | undefined
  multiline?: boolean
}) {
  const display = (value || '').trim() || '—'
  return (
    <div
      className={`pw-mock-field-row${multiline ? ' pw-mock-field-row--multiline' : ''}`}
    >
      <div className="pw-mock-field-label">{label}</div>
      <div className="pw-mock-field-value">{display}</div>
    </div>
  )
}
