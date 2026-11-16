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
  UserGroupIcon,
  UserMultipleIcon,
  UserSearch01Icon,
  UserStatusIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import ImportPage from './ImportPage'
import CandidatesPage from './CandidatesPage'
import SettingsPage from './SettingsPage'
import LeavePage from './LeavePage'
import PresencePage from './PresencePage'
import AdminPage from './AdminPage'
import LoginPage from './LoginPage'
import NotificationBell from './components/NotificationBell'
import BuildBadge from './components/BuildBadge'
import { getUser, logout, can, type User } from '@/lib/auth'
import { useDarkMode } from '@/lib/theme'
import { cn } from '@/lib/utils'

// Top-level modules of the tool. Recruiting is the original applicant workflow;
// employees groups the people-facing HR screens (leave, Slack presence); admin
// is user & permission management. Which modules a user sees depends on their
// permissions.
type Module = 'recruiting' | 'employees' | 'admin'

// Sub-tabs of the modules that have them, each gated by a permission.
type RecruitingTab = 'candidates' | 'import' | 'settings'
type EmployeesTab = 'leave' | 'presence'

type Route = { module: Module; tab: RecruitingTab; employeesTab: EmployeesTab }

// Every screen has its own URL: /admin, /recruiting/<tab> and /employees/<tab>.
function pathFor(route: Route): string {
  if (route.module === 'recruiting') return `/recruiting/${route.tab}`
  if (route.module === 'employees') return `/employees/${route.employeesTab}`
  return `/${route.module}`
}

// Unknown or partial paths fall back to recruiting/candidates so stale or
// mistyped links still land somewhere sensible. The old /leave URL still works.
function parsePath(pathname: string): Route {
  const [first, second] = pathname.split('/').filter(Boolean)
  const base = { tab: 'candidates' as RecruitingTab, employeesTab: 'leave' as EmployeesTab }
  if (first === 'admin') return { ...base, module: 'admin' }
  if (first === 'leave') return { ...base, module: 'employees' }
  if (first === 'employees') {
    return { ...base, module: 'employees', employeesTab: second === 'presence' ? 'presence' : 'leave' }
  }
  const tab = second === 'import' || second === 'settings' ? second : 'candidates'
  return { ...base, module: 'recruiting', tab }
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
  const employeesTabs: { key: EmployeesTab; label: string; icon: IconSvgElement }[] = user
    ? [
        ...(can(user, 'manage_leave') ? [{ key: 'leave' as const, label: 'Leave', icon: Calendar03Icon }] : []),
        ...(can(user, 'view_presence') ? [{ key: 'presence' as const, label: 'Slack presence', icon: UserStatusIcon }] : []),
      ]
    : []
  const canRecruiting = user ? can(user, 'view_applications') || can(user, 'recruiting_admin') : false
  const modules: { key: Module; label: string; icon: IconSvgElement }[] = user
    ? [
        ...(canRecruiting ? [{ key: 'recruiting' as const, label: 'Recruiting', icon: UserSearch01Icon }] : []),
        ...(employeesTabs.length > 0 ? [{ key: 'employees' as const, label: 'Employees', icon: UserGroupIcon }] : []),
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
  const activeEmployeesTab: EmployeesTab = employeesTabs.some((t) => t.key === route.employeesTab)
    ? route.employeesTab
    : (employeesTabs[0]?.key ?? 'leave')

  // If permissions forced a fallback away from the requested path, rewrite the
  // address bar so the URL always matches what's on screen.
  useEffect(() => {
    if (!user || !activeModule) return
    const path = pathFor({ module: activeModule, tab: activeTab, employeesTab: activeEmployeesTab })
    if (window.location.pathname !== path) window.history.replaceState(null, '', path)
  }, [user, activeModule, activeTab, activeEmployeesTab])

  if (!user) {
    return <LoginPage onLogin={setUser} />
  }

  function handleLogout() {
    void logout()
    setUser(null)
  }

  function navigate(module: Module, tab?: RecruitingTab, employeesTab?: EmployeesTab) {
    const next: Route = { module, tab: tab ?? route.tab, employeesTab: employeesTab ?? route.employeesTab }
    const path = pathFor(next)
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
      ) : activeModule === 'employees' && employeesTabs.length > 0 ? (
        <Tabs
          value={activeEmployeesTab}
          onValueChange={(v) => navigate('employees', undefined, v as EmployeesTab)}
          className="mt-6"
        >
          <TabsList className="max-w-full overflow-x-auto">
            {employeesTabs.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
                <HugeiconsIcon icon={t.icon} className="size-3.5 shrink-0" />
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {can(user, 'manage_leave') && (
            <TabsContent value="leave" className="mt-4">
              <LeavePage user={user} />
            </TabsContent>
          )}

          {can(user, 'view_presence') && (
            <TabsContent value="presence" className="mt-4">
              <PresencePage />
            </TabsContent>
          )}
        </Tabs>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">
          You don't have access to any modules yet. Ask an admin to grant you permissions.
        </p>
      )}
    </div>
  )
}
