import { useCallback, useEffect, useRef, useState } from 'react'
import { DropdownMenu } from 'radix-ui'
import { Bell, AtSign, CheckCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
} from '@/lib/notifications'

const POLL_MS = 30_000

// Compact relative time for the notification list (e.g. "5m", "3h", "2d").
function relTime(iso: string): string {
  const then = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').getTime()
  const diff = Date.now() - then
  if (!Number.isFinite(diff)) return ''
  const s = Math.max(0, Math.floor(diff / 1000))
  if (s < 60) return 'now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

type Props = {
  user: string
  // Called when a notification is clicked — App switches to the candidates tab
  // and opens the candidate scrolled to the mentioning note.
  onOpenNote: (applicantId: number, noteId: number) => void
}

export default function NotificationBell({ user, onOpenNote }: Props) {
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const { notifications, unread } = await fetchNotifications(user)
      setItems(notifications)
      setUnread(unread)
    } catch {
      /* transient — next poll retries */
    }
  }, [user])

  // Poll for new notifications; also refresh whenever something elsewhere in the
  // app changes notification state (e.g. a new mention was just posted).
  useEffect(() => {
    void load()
    timer.current = setInterval(load, POLL_MS)
    const onChanged = () => void load()
    window.addEventListener('gk:notifications-changed', onChanged)
    return () => {
      if (timer.current) clearInterval(timer.current)
      window.removeEventListener('gk:notifications-changed', onChanged)
    }
  }, [load])

  // Refresh immediately when the panel is opened.
  useEffect(() => {
    if (open) void load()
  }, [open, load])

  async function handleClick(n: Notification) {
    setOpen(false)
    onOpenNote(n.applicant_id, n.note_id)
    if (!n.read_at) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: 'now' } : x)))
      setUnread((u) => Math.max(0, u - 1))
      try {
        await markNotificationRead(n.id, user)
        window.dispatchEvent(new CustomEvent('gk:notifications-changed'))
      } catch {
        /* will reconcile on next poll */
      }
    }
  }

  async function handleMarkAll() {
    setItems((prev) => prev.map((x) => ({ ...x, read_at: x.read_at ?? 'now' })))
    setUnread(0)
    try {
      await markAllNotificationsRead(user)
      window.dispatchEvent(new CustomEvent('gk:notifications-changed'))
    } catch {
      void load()
    }
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-medium">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={handleMarkAll}
                className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <CheckCheck className="size-3.5" />
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto py-1">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                You're all caught up.
              </p>
            ) : (
              items.map((n) => (
                <DropdownMenu.Item
                  key={n.id}
                  onSelect={(e) => {
                    e.preventDefault()
                    void handleClick(n)
                  }}
                  className={[
                    'flex cursor-pointer gap-2.5 px-3 py-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground',
                    n.read_at ? 'opacity-60' : '',
                  ].join(' ')}
                >
                  <div className="mt-0.5 shrink-0">
                    {!n.read_at ? (
                      <span className="block size-2 rounded-full bg-primary" />
                    ) : (
                      <AtSign className="size-3.5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="leading-snug">
                      <span className="font-medium">{n.actor_name}</span>{' '}
                      <span className="text-muted-foreground">mentioned you</span>
                      {n.applicant_name && (
                        <>
                          {' '}
                          <span className="text-muted-foreground">on</span>{' '}
                          <span className="font-medium">{n.applicant_name}</span>
                        </>
                      )}
                    </p>
                    {n.excerpt && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{n.excerpt}</p>
                    )}
                  </div>
                  <span className="mt-0.5 shrink-0 text-xs text-muted-foreground">
                    {relTime(n.created_at)}
                  </span>
                </DropdownMenu.Item>
              ))
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
