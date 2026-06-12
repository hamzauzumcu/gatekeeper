import { useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import ImportPage from './ImportPage'
import CandidatesPage from './CandidatesPage'

type ApiStatus = 'checking' | 'ok' | 'error'

const STATUS_LABEL: Record<ApiStatus, string> = {
  checking: 'kontrol ediliyor…',
  ok: 'çalışıyor',
  error: 'erişilemiyor',
}

export default function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking')

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d: { ok: boolean }) => setApiStatus(d.ok ? 'ok' : 'error'))
      .catch(() => setApiStatus('error'))
  }, [])

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="flex items-center justify-between border-b pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Gatekeeper</h1>
        <Badge variant={apiStatus === 'ok' ? 'secondary' : apiStatus === 'error' ? 'destructive' : 'outline'}>
          API: {STATUS_LABEL[apiStatus]}
        </Badge>
      </header>

      <Tabs defaultValue="candidates" className="mt-6">
        <TabsList>
          <TabsTrigger value="candidates">Adaylar</TabsTrigger>
          <TabsTrigger value="import">CSV İçe Aktar</TabsTrigger>
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
