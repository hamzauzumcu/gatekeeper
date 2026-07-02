import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Sun, Moon } from 'lucide-react'
import ImportPage from './ImportPage'
import CandidatesPage from './CandidatesPage'
import SettingsPage from './SettingsPage'
import LeavePage from './LeavePage'
import AdminPage from './AdminPage'
import LoginPage from './LoginPage'
import NotificationBell from './components/NotificationBell'
import { getUser, logout, can, type User } from '@/lib/auth'
import { useDarkMode } from '@/lib/theme'
import { cn } from '@/lib/utils'

// Top-level modules of the tool. Recruiting is the original applicant workflow;
// leave is HR time-off management; admin is user & permission management. Which
// modules a user sees depends on their permissions.
type Module = 'recruiting' | 'leave' | 'admin'

// Recruiting sub-tabs, each gated by a permission.
type RecruitingTab = 'candidates' | 'import' | 'settings'

export default function App() {
  const [user, setUser] = useState<User | null>(() => getUser())
  const [dark, setDark] = useDarkMode()
  const [module, setModule] = useState<Module>('recruiting')
  const [tab, setTab] = useState<RecruitingTab>('candidates')
  // A notification click requests opening a specific note; the candidates tab
  // consumes this once it mounts/renders and clears it via onOpenNoteHandled.
  const [openNote, setOpenNote] = useState<{ applicantId: number; noteId: number } | null>(null)

  if (!user) {
    return <LoginPage onLogin={setUser} />
  }

  function handleLogout() {
    void logout()
    setUser(null)
  }

  // Which modules/tabs this user may see, in display order.
  const canRecruiting = can(user, 'view_applications') || can(user, 'recruiting_admin')
  const modules: { key: Module; label: string }[] = [
    ...(canRecruiting ? [{ key: 'recruiting' as const, label: 'Recruiting' }] : []),
    { key: 'leave' as const, label: 'Leave' },
    ...(user.isAdmin ? [{ key: 'admin' as const, label: 'Admin' }] : []),
  ]
  const recruitingTabs: { key: RecruitingTab; label: string }[] = [
    ...(can(user, 'view_applications') ? [{ key: 'candidates' as const, label: 'Candidates' }] : []),
    ...(can(user, 'recruiting_admin') ? [{ key: 'import' as const, label: 'Import CSV' }] : []),
    ...(can(user, 'recruiting_admin') ? [{ key: 'settings' as const, label: 'Settings' }] : []),
  ]

  // Fall back to the first permitted module/tab if the current one isn't allowed.
  const activeModule: Module = modules.some((m) => m.key === module) ? module : modules[0].key
  const activeTab: RecruitingTab =
    recruitingTabs.some((t) => t.key === tab) ? tab : (recruitingTabs[0]?.key ?? 'candidates')

  function handleOpenNote(applicantId: number, noteId: number) {
    setModule('recruiting')
    setTab('candidates')
    setOpenNote({ applicantId, noteId })
  }

  return (
    <div className="mx-auto w-full max-w-[1800px] px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex items-center justify-between gap-3 border-b pb-4">
        <div className="flex min-w-0 items-center gap-4 sm:gap-6">
          <button
            type="button"
            onClick={() => setModule(modules[0].key)}
            className="shrink-0 text-xl font-semibold tracking-tight sm:text-2xl"
          >
            Gatekeeper
          </button>
          <nav className="flex items-center gap-1">
            {modules.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setModule(m.key)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  activeModule === m.key
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex min-w-0 items-center gap-1 sm:gap-3">
          <NotificationBell user={user.username} onOpenNote={handleOpenNote} />
          <span className="hidden max-w-[12rem] truncate text-sm text-muted-foreground sm:inline">{user.fullName}</span>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            Sign out
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setDark(!dark)} aria-label="Toggle theme">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      {activeModule === 'recruiting' && recruitingTabs.length > 0 ? (
        <Tabs value={activeTab} onValueChange={(v) => setTab(v as RecruitingTab)} className="mt-6">
          <TabsList className="max-w-full overflow-x-auto">
            {recruitingTabs.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
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
      ) : (
        <div className="mt-6">
          <LeavePage user={user} />
        </div>
      )}
    </div>
  )
}
