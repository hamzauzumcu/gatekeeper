import { useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import ImportPage from './ImportPage'
import CandidatesPage from './CandidatesPage'
import LoginPage from './LoginPage'
import { getUser, logout, type User } from '@/lib/auth'

type ApiStatus = 'checking' | 'ok' | 'error'

const STATUS_LABEL: Record<ApiStatus, string> = {
  checking: 'checking…',
  ok: 'running',
  error: 'unreachable',
}

export default function App() {
  const [user, setUser] = useState<User | null>(() => getUser())
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking')

  useEffect(() => {
    if (!user) return
    fetch('/api/health')
      .then((r) => r.json())
      .then((d: { ok: boolean }) => setApiStatus(d.ok ? 'ok' : 'error'))
      .catch(() => setApiStatus('error'))
  }, [user])

  if (!user) {
    return <LoginPage onLogin={setUser} />
  }

  function handleLogout() {
    logout()
    setUser(null)
    setApiStatus('checking')
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="flex items-center justify-between border-b pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Gatekeeper</h1>
        <div className="flex items-center gap-3">
          <Badge variant={apiStatus === 'ok' ? 'secondary' : apiStatus === 'error' ? 'destructive' : 'outline'}>
            API: {STATUS_LABEL[apiStatus]}
          </Badge>
          <span className="text-sm text-muted-foreground">{user.fullName}</span>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            Sign out
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
