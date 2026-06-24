import { useEffect, useRef, useState } from 'react'
import type { AppUser } from '@/lib/users'

// Find an in-progress @mention immediately before the caret. Returns the start
// index of the '@' and the partial handle typed so far, or null if the caret
// isn't inside a mention token.
function activeMention(value: string, caret: number): { start: number; query: string } | null {
  // Walk back from the caret over word characters.
  let i = caret
  while (i > 0 && /[A-Za-z0-9_]/.test(value[i - 1])) i--
  if (i === 0 || value[i - 1] !== '@') return null
  const start = i - 1
  // The '@' must start a token (preceded by whitespace or start of text), so we
  // don't trigger inside emails like "name@host".
  const before = start > 0 ? value[start - 1] : ' '
  if (!/\s/.test(before) && before !== '') return null
  return { start, query: value.slice(i, caret) }
}

type Props = {
  value: string
  onChange: (value: string) => void
  users: AppUser[]
  // Forwarded to the underlying textarea. onKeyDown is called only when the
  // mention menu isn't consuming the key.
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  rows?: number
  className?: string
  autoFocus?: boolean
}

export default function MentionTextarea({
  value,
  onChange,
  users,
  onKeyDown,
  onPaste,
  placeholder,
  rows,
  className,
  autoFocus,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [query, setQuery] = useState<{ start: number; text: string } | null>(null)
  const [active, setActive] = useState(0)

  const matches = query
    ? users
        .filter((u) => {
          const q = query.text.toLowerCase()
          return (
            q === '' ||
            u.username.toLowerCase().includes(q) ||
            u.full_name.toLowerCase().includes(q)
          )
        })
        .slice(0, 6)
    : []
  const menuOpen = matches.length > 0

  useEffect(() => {
    setActive(0)
  }, [query?.text])

  function syncMention(el: HTMLTextAreaElement) {
    const m = activeMention(el.value, el.selectionStart ?? el.value.length)
    setQuery(m ? { start: m.start, text: m.query } : null)
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value)
    syncMention(e.target)
  }

  function pick(user: AppUser) {
    if (!query) return
    const el = ref.current
    const caret = el?.selectionStart ?? value.length
    const next = `${value.slice(0, query.start)}@${user.username} ${value.slice(caret)}`
    onChange(next)
    setQuery(null)
    // Restore focus and place the caret just after the inserted handle.
    const pos = query.start + user.username.length + 2
    requestAnimationFrame(() => {
      if (el) {
        el.focus()
        el.setSelectionRange(pos, pos)
      }
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (menuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((i) => (i + 1) % matches.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((i) => (i - 1 + matches.length) % matches.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pick(matches[active])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setQuery(null)
        return
      }
    }
    onKeyDown?.(e)
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={onPaste}
        onClick={(e) => syncMention(e.currentTarget)}
        onBlur={() => setTimeout(() => setQuery(null), 120)}
        placeholder={placeholder}
        rows={rows}
        autoFocus={autoFocus}
        className={className}
      />
      {menuOpen && (
        <ul className="absolute z-30 mt-1 w-56 overflow-hidden rounded-md border bg-popover py-1 text-popover-foreground shadow-md">
          {matches.map((u, i) => (
            <li key={u.id}>
              <button
                type="button"
                // Use mousedown so the pick fires before the textarea blur closes the menu.
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(u)
                }}
                className={[
                  'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm',
                  i === active ? 'bg-accent text-accent-foreground' : '',
                ].join(' ')}
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: u.color ?? '#94a3b8' }}
                />
                <span className="font-medium">{u.full_name}</span>
                <span className="text-xs text-muted-foreground">@{u.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
