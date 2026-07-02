import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Sun, Moon } from 'lucide-react'
import ImportPage from './ImportPage'
import CandidatesPage from './CandidatesPage'
import SettingsPage from './SettingsPage'
import LeavePage from './LeavePage'
import LoginPage from './LoginPage'
import NotificationBell from './components/NotificationBell'
import { getUser, logout, type User } from '@/lib/auth'
import { useDarkMode } from '@/lib/theme'
import { cn } from '@/lib/utils'

// Top-level modules of the tool. Recruiting is the original applicant workflow;
// leave is HR time-off management. The header switches between them.
type Module = 'recruiting' | 'leave'
const MODULES: { key: Module; label: string }[] = [
  { key: 'recruiting', label: 'Recruiting' },
  { key: 'leave', label: 'Leave' },
]

export default function App() {
  const [user, setUser] = useState<User | null>(() => getUser())
  const [dark, setDark] = useDarkMode()
  const [module, setModule] = useState<Module>('recruiting')
  const [tab, setTab] = useState('candidates')
  // A notification click requests opening a specific note; the candidates tab
  // consumes this once it mounts/renders and clears it via onOpenNoteHandled.
  const [openNote, setOpenNote] = useState<{ applicantId: number; noteId: number } | null>(null)

  if (!user) {
    return <LoginPage onLogin={setUser} />
  }

  function handleLogout() {
    logout()
    setUser(null)
  }

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
            onClick={() => setModule('recruiting')}
            className="shrink-0 text-xl font-semibold tracking-tight sm:text-2xl"
          >
            Gatekeeper
          </button>
          <nav className="flex items-center gap-1">
            {MODULES.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setModule(m.key)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  module === m.key
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

      {module === 'recruiting' ? (
        <Tabs value={tab} onValueChange={setTab} className="mt-6">
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="candidates">Candidates</TabsTrigger>
            <TabsTrigger value="import">Import CSV</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="candidates" className="mt-4">
            <CandidatesPage openNote={openNote} onOpenNoteHandled={() => setOpenNote(null)} />
          </TabsContent>

          <TabsContent value="import" className="mt-4">
            <ImportPage />
          </TabsContent>

          <TabsContent value="settings" className="mt-4">
            <SettingsPage />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="mt-6">
          <LeavePage user={user} />
        </div>
      )}
    </div>
  )
}
