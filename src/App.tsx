import { useEffect, useState } from 'react'
import ImportPage from './ImportPage'

type Tab = 'dashboard' | 'import'

export default function App() {
  const [apiStatus, setApiStatus] = useState<'checking' | 'ok' | 'error'>('checking')
  const [tab, setTab] = useState<Tab>('dashboard')

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

      <nav className="tabs">
        <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}>
          Panel
        </button>
        <button className={tab === 'import' ? 'active' : ''} onClick={() => setTab('import')}>
          CSV İçe Aktar
        </button>
      </nav>

      <main>
        {tab === 'dashboard' ? (
          <p>HR aday analiz paneli — iskelet hazır. Aday listesi ve analiz bir sonraki adım.</p>
        ) : (
          <ImportPage />
        )}
      </main>
    </div>
  )
}
