import { useEffect, useState } from 'react'

export default function App() {
  const [apiStatus, setApiStatus] = useState<'checking' | 'ok' | 'error'>('checking')

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d: { ok: boolean }) => setApiStatus(d.ok ? 'ok' : 'error'))
      .catch(() => setApiStatus('error'))
  }, [])

  return (
    <div className="shell">
      <header>
        <h1>Gatekeeper</h1>
        <span className={`status status-${apiStatus}`}>
          API: {apiStatus === 'checking' ? 'kontrol ediliyor…' : apiStatus === 'ok' ? 'çalışıyor' : 'erişilemiyor'}
        </span>
      </header>
      <main>
        <p>HR aday analiz paneli — iskelet hazır. Sıradaki adım: veri modeli ve CSV import.</p>
      </main>
    </div>
  )
}
