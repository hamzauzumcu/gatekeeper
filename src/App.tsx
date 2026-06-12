import { useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import ImportPage from './ImportPage'

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

      <Tabs defaultValue="dashboard" className="mt-6">
        <TabsList>
          <TabsTrigger value="dashboard">Panel</TabsTrigger>
          <TabsTrigger value="import">CSV İçe Aktar</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Panel</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground">
              HR aday analiz paneli — iskelet hazır. Aday listesi ve analiz bir sonraki adım.
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="import" className="mt-4">
          <ImportPage />
        </TabsContent>
      </Tabs>
    </div>
  )
}
