type HeroFilterPillProps = {
  id: string
  icon: string
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

export default function HeroFilterPill({ id, icon, label, checked, onChange }: HeroFilterPillProps) {
  return (
    <button
      type="button"
      id={id}
      role="checkbox"
      aria-checked={checked}
      className={`run-review-filter__btn monthly-hero-filter${
        checked ? ' run-review-filter__btn--active' : ''
      }`}
      onClick={() => onChange(!checked)}
    >
      <i className={`bi ${icon}`} aria-hidden />
      {label}
    </button>
  )
}
