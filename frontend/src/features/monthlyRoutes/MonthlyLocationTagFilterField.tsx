import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Form } from 'react-bootstrap'

type Props = {
  label: string
  placeholder?: string
  options: string[]
  selected: string[]
  blockedTags?: string[]
  onChange: (tags: string[]) => void
}

function tagKey(tag: string): string {
  return tag.trim().toLowerCase()
}

export default function MonthlyLocationTagFilterField({
  label,
  placeholder = 'Search tags…',
  options,
  selected,
  blockedTags = [],
  onChange,
}: Props) {
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const selectedKeys = useMemo(() => new Set(selected.map(tagKey)), [selected])
  const blockedKeys = useMemo(() => new Set(blockedTags.map(tagKey)), [blockedTags])

  const menuOptions = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return options.filter((tag) => {
      const key = tagKey(tag)
      if (selectedKeys.has(key) || blockedKeys.has(key)) return false
      if (!needle) return false
      return tag.toLowerCase().includes(needle)
    })
  }, [blockedKeys, options, query, selectedKeys])

  const showMenu = open && query.trim().length > 0

  useEffect(() => {
    if (!showMenu) {
      setActiveIndex(-1)
      return
    }
    if (menuOptions.length === 0) {
      setActiveIndex(-1)
      return
    }
    setActiveIndex((index) => (index >= 0 && index < menuOptions.length ? index : 0))
  }, [menuOptions, showMenu])

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  const addTag = (tag: string) => {
    const key = tagKey(tag)
    if (selectedKeys.has(key) || blockedKeys.has(key)) return
    onChange([...selected, tag])
    setQuery('')
    setOpen(false)
    inputRef.current?.focus()
  }

  const removeTag = (tag: string) => {
    const key = tagKey(tag)
    onChange(selected.filter((item) => tagKey(item) !== key))
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!showMenu || menuOptions.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % menuOptions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (index <= 0 ? menuOptions.length - 1 : index - 1))
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault()
      addTag(menuOptions[activeIndex])
    }
  }

  return (
    <div ref={rootRef} className="monthly-locations-filter-field monthly-locations-table-filters__tag">
      <span className="monthly-locations-filter-field__label">{label}</span>
      <div
        className="monthly-locations-filter-field__control"
        onClick={() => inputRef.current?.focus()}
      >
        {selected.map((tag) => (
          <span key={tag} className="monthly-locations-filter-field__chip">
            {tag}
            <button
              type="button"
              className="monthly-locations-filter-field__chip-remove"
              aria-label={`Remove tag ${tag}`}
              onClick={(event) => {
                event.stopPropagation()
                removeTag(tag)
              }}
            >
              ×
            </button>
          </span>
        ))}
        <Form.Control
          ref={inputRef}
          type="search"
          size="sm"
          className="monthly-locations-filter-field__input"
          value={query}
          placeholder={selected.length === 0 ? placeholder : 'Add tag…'}
          role="combobox"
          aria-expanded={showMenu}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-label={label}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onInputKeyDown}
        />
      </div>
      {showMenu ? (
        <ul id={listboxId} className="monthly-locations-filter-field__menu" role="listbox">
          {menuOptions.length === 0 ? (
            <li className="monthly-locations-filter-field__empty" role="presentation">
              No matching tags
            </li>
          ) : (
            menuOptions.map((tag, index) => (
              <li key={tag} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={activeIndex === index}
                  className={[
                    'monthly-locations-filter-field__option',
                    activeIndex === index ? 'monthly-locations-filter-field__option--active' : null,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => addTag(tag)}
                >
                  {tag}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}
