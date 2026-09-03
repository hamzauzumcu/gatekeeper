import { useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { HugeiconsIcon } from '@hugeicons/react'
import type { IconSvgElement } from '@hugeicons/react'
import {
  Calendar03Icon,
  Logout03Icon,
  Moon02Icon,
  SecurityCheckIcon,
  Settings01Icon,
  Sun03Icon,
  Upload03Icon,
  UserMultipleIcon,
  UserSearch01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import ImportPage from './ImportPage'
import CandidatesPage from './CandidatesPage'
import SettingsPage from './SettingsPage'
import LeavePage from './LeavePage'
import AdminPage from './AdminPage'
import LoginPage from './LoginPage'
import NotificationBell from './components/NotificationBell'
import BuildBadge from './components/BuildBadge'
import { getUser, logout, can, type User } from '@/lib/auth'
import { useDarkMode } from '@/lib/theme'
import { cn } from '@/lib/utils'

// Top-level modules of the tool. Recruiting is the original applicant workflow;
// leave is HR time-off management; admin is user & permission management. Which
// modules a user sees depends on their permissions.
type Module = 'recruiting' | 'leave' | 'admin'

// Recruiting sub-tabs, each gated by a permission.
type RecruitingTab = 'candidates' | 'import' | 'settings'

type Route = { module: Module; tab: RecruitingTab }

// Every screen has its own URL: /leave, /admin, and /recruiting/<tab>.
function pathFor(module: Module, tab: RecruitingTab): string {
  return module === 'recruiting' ? `/recruiting/${tab}` : `/${module}`
}

// Unknown or partial paths fall back to recruiting/candidates so stale or
// mistyped links still land somewhere sensible.
function parsePath(pathname: string): Route {
  const [first, second] = pathname.split('/').filter(Boolean)
  if (first === 'leave' || first === 'admin') return { module: first, tab: 'candidates' }
  const tab = second === 'import' || second === 'settings' ? second : 'candidates'
  return { module: 'recruiting', tab }
}

export default function App() {
  const [user, setUser] = useState<User | null>(() => getUser())
  const [dark, setDark] = useDarkMode()
  const [route, setRoute] = useState<Route>(() => parsePath(window.location.pathname))
  // A notification click or a shared deep link (?applicant=<id>&note=<id>)
  // requests opening a specific note; the candidates tab consumes this once it
  // mounts/renders and clears it via onOpenNoteHandled. Captured in the
  // initializer so the link survives the login screen.
  const [openNote, setOpenNote] = useState<{ applicantId: number; noteId: number } | null>(() => {
    const params = new URLSearchParams(window.location.search)
    const applicantId = Number(params.get('applicant'))
    const noteId = Number(params.get('note'))
    return Number.isInteger(applicantId) && applicantId > 0 && Number.isInteger(noteId) && noteId > 0
      ? { applicantId, noteId }
      : null
  })

  // Strip the deep-link params so a refresh doesn't re-open the note.
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname)
  }, [])

  // Browser back/forward moves between screens.
  useEffect(() => {
    const onPop = () => setRoute(parsePath(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Which modules/tabs this user may see, in display order.
  const canRecruiting = user ? can(user, 'view_applications') || can(user, 'recruiting_admin') : false
  const modules: { key: Module; label: string; icon: IconSvgElement }[] = user
    ? [
        ...(canRecruiting ? [{ key: 'recruiting' as const, label: 'Recruiting', icon: UserSearch01Icon }] : []),
        ...(can(user, 'manage_leave') ? [{ key: 'leave' as const, label: 'Leave', icon: Calendar03Icon }] : []),
        ...(user.isAdmin ? [{ key: 'admin' as const, label: 'Admin', icon: SecurityCheckIcon }] : []),
      ]
    : []
  const recruitingTabs: { key: RecruitingTab; label: string; icon: IconSvgElement }[] = user
    ? [
        ...(can(user, 'view_applications') ? [{ key: 'candidates' as const, label: 'Candidates', icon: UserMultipleIcon }] : []),
        ...(can(user, 'recruiting_admin') ? [{ key: 'import' as const, label: 'Import CSV', icon: Upload03Icon }] : []),
        ...(can(user, 'recruiting_admin') ? [{ key: 'settings' as const, label: 'Settings', icon: Settings01Icon }] : []),
      ]
    : []

  // Fall back to the first permitted module/tab if the current one isn't allowed.
  const activeModule: Module | undefined = modules.some((m) => m.key === route.module)
    ? route.module
    : modules[0]?.key
  const activeTab: RecruitingTab = recruitingTabs.some((t) => t.key === route.tab)
    ? route.tab
    : (recruitingTabs[0]?.key ?? 'candidates')

  // If permissions forced a fallback away from the requested path, rewrite the
  // address bar so the URL always matches what's on screen.
  useEffect(() => {
    if (!user || !activeModule) return
    const path = pathFor(activeModule, activeTab)
    if (window.location.pathname !== path) window.history.replaceState(null, '', path)
  }, [user, activeModule, activeTab])

  if (!user) {
    return <LoginPage onLogin={setUser} />
  }

  function handleLogout() {
    void logout()
    setUser(null)
  }

  function navigate(module: Module, tab?: RecruitingTab) {
    const next = { module, tab: tab ?? route.tab }
    const path = pathFor(next.module, next.tab)
    if (window.location.pathname !== path) window.history.pushState(null, '', path)
    setRoute(next)
  }

  function handleOpenNote(applicantId: number, noteId: number) {
    navigate('recruiting', 'candidates')
    setOpenNote({ applicantId, noteId })
  }

  return (
    <div className="mx-auto w-full max-w-[1800px] px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex items-center justify-between gap-3 border-b pb-4">
        <div className="flex min-w-0 items-center gap-4 sm:gap-6">
          <div className="flex shrink-0 flex-col items-start gap-1">
            <button
              type="button"
              onClick={() => modules[0] && navigate(modules[0].key)}
              className="block text-xl font-semibold leading-none tracking-tight sm:text-2xl"
            >
              Gatekeeper
            </button>
            <BuildBadge />
          </div>
          <nav className="flex items-center gap-1">
            {modules.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => navigate(m.key)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  activeModule === m.key
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <HugeiconsIcon icon={m.icon} className="size-4 shrink-0" />
                {m.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex min-w-0 items-center gap-1 sm:gap-3">
          <NotificationBell user={user.username} onOpenNote={handleOpenNote} />
          <span className="hidden max-w-[12rem] truncate text-sm text-muted-foreground sm:inline">{user.fullName}</span>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <HugeiconsIcon icon={Logout03Icon} className="size-3.5 shrink-0" />
            Sign out
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setDark(!dark)} aria-label="Toggle theme">
            {dark ? <HugeiconsIcon icon={Sun03Icon} className="h-4 w-4" /> : <HugeiconsIcon icon={Moon02Icon} className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      {activeModule === 'recruiting' && recruitingTabs.length > 0 ? (
        <Tabs value={activeTab} onValueChange={(v) => navigate('recruiting', v as RecruitingTab)} className="mt-6">
          <TabsList className="max-w-full overflow-x-auto">
            {recruitingTabs.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
                <HugeiconsIcon icon={t.icon} className="size-3.5 shrink-0" />
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {can(user, 'view_applications') && (
            <TabsContent value="candidates" className="mt-4">
              <CandidatesPage user={user} openNote={openNote} onOpenNoteHandled={() => setOpenNote(null)} />
            </TabsContent>
          )}

          {can(user, 'recruiting_admin') && (
            <TabsContent value="import" className="mt-4">
              <ImportPage />
            </TabsContent>
          )}

          {can(user, 'recruiting_admin') && (
            <TabsContent value="settings" className="mt-4">
              <SettingsPage />
            </TabsContent>
          )}
        </Tabs>
      ) : activeModule === 'admin' ? (
        <div className="mt-6">
          <AdminPage user={user} />
        </div>
      ) : activeModule === 'leave' ? (
        <div className="mt-6">
          <LeavePage user={user} />
        </div>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">
          You don't have access to any modules yet. Ask an admin to grant you permissions.
        </p>
      )}
    </div>
  )
}
