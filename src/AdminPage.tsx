import { useEffect, useState } from 'react'
import { Check, Plus, ShieldCheck, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import type { User } from '@/lib/auth'
import { PERMISSIONS, PERMISSION_META, emptyPermissions, type Permission, type PermissionMap } from '@/lib/permissions'
import {
  fetchAdminUsers,
  createAdminUser,
  updateAdminUser,
  type AdminUser,
  type AdminUserInput,
} from '@/lib/admin'

// The editor works on this draft shape; `id === null` means "creating a new user".
type Draft = {
  id: number | null
  full_name: string
  username: string
  password: string
  color: string
  is_active: boolean
  is_admin: boolean
  permissions: PermissionMap
}

function draftFromUser(u: AdminUser): Draft {
  return {
    id: u.id,
    full_name: u.full_name,
    username: u.username,
    password: '',
    color: u.color ?? '',
    is_active: u.is_active === 1,
    is_admin: u.is_admin === 1,
    permissions: { ...emptyPermissions(), ...u.permissions },
  }
}

function emptyDraft(): Draft {
  return {
    id: null,
    full_name: '',
    username: '',
    password: '',
    color: '',
    is_active: true,
    is_admin: false,
    permissions: emptyPermissions(),
  }
}

// A checkbox-style toggle button matching the app's OptionCheckList pattern.
function Toggle({
  checked,
  onChange,
  disabled,
  label,
  description,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label: string
  description?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors',
        disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent',
        checked && !disabled ? 'border-primary/50 bg-primary/5' : 'border-input',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border',
          checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
        )}
      >
        {checked && <Check className="size-2.5" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>}
      </span>
    </button>
  )
}

export default function AdminPage({ user }: { user: User }) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setLoadError(null)
    try {
      setUsers(await fetchAdminUsers())
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function startCreate() {
    setFormError(null)
    setDraft(emptyDraft())
  }

  function startEdit(u: AdminUser) {
    setFormError(null)
    setDraft(draftFromUser(u))
  }

  function patchDraft(patch: Partial<Draft>) {
    setDraft((d) => (d ? { ...d, ...patch } : d))
  }

  function setPerm(perm: Permission, value: boolean) {
    setDraft((d) => (d ? { ...d, permissions: { ...d.permissions, [perm]: value } } : d))
  }

  async function save() {
    if (!draft) return
    setFormError(null)
    if (!draft.full_name.trim()) return setFormError('Full name is required')
    if (draft.id === null && !draft.username.trim()) return setFormError('Username is required')
    if (draft.id === null && !draft.password) return setFormError('Password is required for a new user')

    const input: AdminUserInput = {
      full_name: draft.full_name.trim(),
      username: draft.username.trim().toLowerCase(),
      password: draft.password,
      color: draft.color.trim() || null,
      is_active: draft.is_active,
      is_admin: draft.is_admin,
      permissions: draft.permissions,
    }
    setSaving(true)
    try {
      if (draft.id === null) {
        await createAdminUser(input)
      } else {
        await updateAdminUser(draft.id, input)
      }
      setDraft(null)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save user')
    } finally {
      setSaving(false)
    }
  }

  const editingSelf = draft?.id != null && draft.username === user.username

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      {/* User list */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle>Users &amp; permissions</CardTitle>
          <Button size="sm" onClick={startCreate}>
            <UserPlus className="mr-1.5 size-4" /> Add user
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : loadError ? (
            <Alert variant="destructive">
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          ) : users.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No users yet.</p>
          ) : (
            <ul className="divide-y">
              {users.map((u) => {
                const selected = draft?.id === u.id
                return (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => startEdit(u)}
                      className={cn(
                        'flex w-full items-center gap-3 px-1 py-3 text-left transition-colors hover:bg-accent/50',
                        selected && 'bg-accent/60',
                      )}
                    >
                      <span
                        className="flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                        style={{ backgroundColor: u.color ?? '#64748b' }}
                      >
                        {u.full_name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-medium">{u.full_name}</span>
                          {u.is_admin === 1 && (
                            <Badge variant="default" className="gap-1">
                              <ShieldCheck className="size-3" /> Full access
                            </Badge>
                          )}
                          {u.is_active !== 1 && <Badge variant="secondary">Inactive</Badge>}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          @{u.username} · {permSummary(u)}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Editor */}
      <div>
        {draft ? (
          <Card>
            <CardHeader>
              <CardTitle>{draft.id === null ? 'New user' : `Edit ${draft.full_name || draft.username}`}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="ad-name">Full name</Label>
                <Input
                  id="ad-name"
                  value={draft.full_name}
                  onChange={(e) => patchDraft({ full_name: e.target.value })}
                  placeholder="Jane Doe"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ad-username">Username</Label>
                <Input
                  id="ad-username"
                  value={draft.username}
                  onChange={(e) => patchDraft({ username: e.target.value })}
                  placeholder="jane"
                  disabled={draft.id !== null}
                  autoComplete="off"
                />
                {draft.id !== null && (
                  <p className="text-xs text-muted-foreground">Username can't be changed.</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ad-password">Password</Label>
                <Input
                  id="ad-password"
                  type="password"
                  value={draft.password}
                  onChange={(e) => patchDraft({ password: e.target.value })}
                  placeholder={draft.id === null ? 'Set a password' : 'Leave blank to keep current'}
                  autoComplete="new-password"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ad-color">Accent color</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="ad-color"
                    type="color"
                    value={draft.color || '#64748b'}
                    onChange={(e) => patchDraft({ color: e.target.value })}
                    className="size-9 shrink-0 cursor-pointer rounded border bg-transparent"
                    aria-label="Accent color"
                  />
                  <Input
                    value={draft.color}
                    onChange={(e) => patchDraft({ color: e.target.value })}
                    placeholder="#2563eb"
                  />
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <Label>Access</Label>
                <Toggle
                  checked={draft.is_admin}
                  onChange={(v) => patchDraft({ is_admin: v })}
                  disabled={editingSelf}
                  label="Full access (admin)"
                  description="Grants every capability plus user management."
                />
                {editingSelf && (
                  <p className="text-xs text-muted-foreground">You can't change your own admin access.</p>
                )}
                {PERMISSIONS.map((perm) => (
                  <Toggle
                    key={perm}
                    checked={draft.is_admin || draft.permissions[perm]}
                    onChange={(v) => setPerm(perm, v)}
                    disabled={draft.is_admin}
                    label={PERMISSION_META[perm].label}
                    description={PERMISSION_META[perm].description}
                  />
                ))}
              </div>

              <div className="space-y-2 pt-1">
                <Label>Status</Label>
                <Toggle
                  checked={draft.is_active}
                  onChange={(v) => patchDraft({ is_active: v })}
                  disabled={editingSelf}
                  label="Active"
                  description="Inactive users can't sign in and are hidden from pickers."
                />
              </div>

              {formError && (
                <Alert variant="destructive">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
                  Cancel
                </Button>
                <Button onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : draft.id === null ? 'Create user' : 'Save changes'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
              <Plus className="size-6" />
              <p>Select a user to edit, or add a new one.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

// One-line summary of a user's granted capabilities for the list row.
function permSummary(u: AdminUser): string {
  if (u.is_admin === 1) return 'All capabilities'
  const granted = PERMISSIONS.filter((p) => u.permissions[p]).map((p) => PERMISSION_META[p].label)
  return granted.length ? granted.join(', ') : 'No capabilities'
}
