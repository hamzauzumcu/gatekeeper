import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Sun, Moon } from 'lucide-react'
import ImportPage from './ImportPage'
import CandidatesPage from './CandidatesPage'
import SettingsPage from './SettingsPage'
import LoginPage from './LoginPage'
import { getUser, logout, type User } from '@/lib/auth'
import { useDarkMode } from '@/lib/theme'

export default function App() {
  const [user, setUser] = useState<User | null>(() => getUser())
  const [dark, setDark] = useDarkMode()

  if (!user) {
    return <LoginPage onLogin={setUser} />
  }

  function handleLogout() {
    logout()
    setUser(null)
  }

  return (
    <div className="mx-auto w-full max-w-[1800px] px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex items-center justify-between gap-3 border-b pb-4">
        <h1 className="shrink-0 text-xl font-semibold tracking-tight sm:text-2xl">Gatekeeper</h1>
        <div className="flex min-w-0 items-center gap-1 sm:gap-3">
          <span className="hidden max-w-[12rem] truncate text-sm text-muted-foreground sm:inline">{user.fullName}</span>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            Sign out
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setDark(!dark)} aria-label="Toggle theme">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      <Tabs defaultValue="candidates" className="mt-6">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="candidates">Candidates</TabsTrigger>
          <TabsTrigger value="import">Import CSV</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="candidates" className="mt-4">
          <CandidatesPage />
        </TabsContent>

        <TabsContent value="import" className="mt-4">
          <ImportPage />
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <SettingsPage />
        </TabsContent>
      </Tabs>
    </div>
  )
}
