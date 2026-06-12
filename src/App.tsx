import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Sun, Moon } from 'lucide-react'
import ImportPage from './ImportPage'
import CandidatesPage from './CandidatesPage'
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
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="flex items-center justify-between border-b pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Gatekeeper</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{user.fullName}</span>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            Sign out
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setDark(!dark)} aria-label="Toggle theme">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      <Tabs defaultValue="candidates" className="mt-6">
        <TabsList>
          <TabsTrigger value="candidates">Candidates</TabsTrigger>
          <TabsTrigger value="import">Import CSV</TabsTrigger>
        </TabsList>

        <TabsContent value="candidates" className="mt-4">
          <CandidatesPage />
        </TabsContent>

        <TabsContent value="import" className="mt-4">
          <ImportPage />
        </TabsContent>
      </Tabs>
    </div>
  )
}
