import { useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ChevronDown, Sparkles, TriangleAlert } from 'lucide-react'
import { fetchScoringPrompts, saveScoringPrompt, syncScores, syncCv, clearData, type PositionWithPrompt } from './lib/candidates'
import { formatDate } from './lib/candidates'

function getDefaultPrompt(positionTitle: string): string {
  const lower = positionTitle.toLowerCase()

  if (lower.includes('search ads') || lower.includes('campaign manager') || lower.includes('asa')) {
    return `You are an expert recruiter evaluating candidates for the Apple Search Ads Campaign Manager role.

Evaluate the candidate's CV, cover letter, and application form answers. Score them from 0 to 100 based on the following criteria:

1. Apple Search Ads Experience (0–40 pts): Direct experience with Apple Search Ads (ASA) or Search Ads Advanced. Experience with app store marketing, keyword bidding, and campaign optimization on the Apple platform is highly valued.

2. Digital Marketing & UA Skills (0–25 pts): Paid search (PPC/SEM), mobile user acquisition (UA), app store optimization (ASO), and experience with attribution/analytics tools like AppsFlyer, Adjust, or MMP platforms.

3. Analytics & Performance (0–20 pts): Data-driven approach to campaign management. Experience with ROAS, CPI, CTR, CVR metrics, A/B testing, and reporting tools.

4. Overall Profile (0–15 pts): Relevant education (marketing, business, or technical), career trajectory, communication quality in cover letter, and overall professionalism.

Return ONLY valid JSON: {"score": <integer 0-100>, "reasoning": "<2-3 sentence explanation of the score>"}`
  }

  if (
    lower.includes('backend') ||
    lower.includes('back-end') ||
    lower.includes('back end') ||
    lower.includes('software engineer') ||
    lower.includes('yazılım') ||
    lower.includes('developer')
  ) {
    return `You are an expert technical recruiter evaluating candidates for the Backend Engineer role.

Evaluate the candidate's CV, cover letter, and application form answers. Score them from 0 to 100 based on the following criteria:

1. Backend Development Experience (0–40 pts): Server-side programming with languages such as Node.js, TypeScript, Python, Go, Java, or Rust. Experience building REST or GraphQL APIs, microservices, or distributed systems.

2. Database & Infrastructure (0–25 pts): Proficiency with SQL and/or NoSQL databases. Experience with cloud platforms (AWS, GCP, Azure), containerization (Docker, Kubernetes), and CI/CD pipelines.

3. Software Engineering Practices (0–20 pts): Evidence of clean architecture, test-driven development, code review experience, system design skills, and scalability considerations.

4. Overall Profile (0–15 pts): Computer Science degree or equivalent, relevant open source contributions, career progression, and seniority level alignment.

Return ONLY valid JSON: {"score": <integer 0-100>, "reasoning": "<2-3 sentence explanation of the score>"}`
  }

  return `You are an expert recruiter evaluating candidates for the ${positionTitle} role.

Evaluate the candidate's CV, cover letter, and application form answers. Score them from 0 to 100 based on:

1. Relevant Experience (0–40 pts): Direct experience related to this role's core requirements.

2. Technical / Domain Skills (0–25 pts): Specific skills, tools, and knowledge required for this position.

3. Quality Indicators (0–20 pts): Evidence of strong work quality, problem-solving ability, and professional growth.

4. Overall Profile (0–15 pts): Education, career trajectory, communication quality, and overall fit.

Return ONLY valid JSON: {"score": <integer 0-100>, "reasoning": "<2-3 sentence explanation of the score>"}`
}

function PromptCard({ position, onSaved }: { position: PositionWithPrompt; onSaved: (pos: PositionWithPrompt) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(position.prompt ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const defaultPrompt = getDefaultPrompt(position.title)
  const isDirty = text !== (position.prompt ?? '')
  const isEmpty = !text.trim()

  async function handleSave() {
    if (isEmpty) return
    setSaving(true)
    setError(null)
    try {
      await saveScoringPrompt(position.id, text.trim())
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved({ ...position, prompt: text.trim(), updated_at: new Date().toISOString() })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function loadDefault() {
    setText(defaultPrompt)
  }

  return (
    <div className="rounded-xl border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between bg-muted/40 px-5 py-4 text-left hover:bg-muted/60 transition-colors"
      >
        <div>
          <div className="font-semibold">{position.title}</div>
          {position.updated_at ? (
            <div className="mt-0.5 text-xs text-muted-foreground">
              Last saved: {formatDate(position.updated_at)}
            </div>
          ) : (
            <div className="mt-0.5 text-xs text-amber-600 font-medium">No prompt saved yet</div>
          )}
        </div>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="p-5 space-y-3">
          <div className="flex justify-end">
            {(!text || (text && text !== defaultPrompt && !position.prompt)) && (
              <Button variant="outline" size="sm" onClick={loadDefault}>
                Load Default
              </Button>
            )}
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            placeholder="Enter scoring prompt…"
            className={[
              'w-full resize-none rounded-lg border bg-background px-3 py-2.5 text-sm font-mono leading-relaxed',
              'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              'border-input',
            ].join(' ')}
          />

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || isEmpty || !isDirty}
            >
              {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Prompt'}
            </Button>
            {!text.trim() && (
              <Button variant="outline" size="sm" onClick={loadDefault}>
                Use Default Prompt
              </Button>
            )}
            {isDirty && text.trim() && (
              <button
                type="button"
                onClick={() => setText(position.prompt ?? '')}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Discard changes
              </button>
            )}
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {text.length} chars
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SettingsPage() {
  const [positions, setPositions] = useState<PositionWithPrompt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [syncTotal, setSyncTotal] = useState<number | null>(null)
  const [syncProcessed, setSyncProcessed] = useState(0)
  const [syncFailed, setSyncFailed] = useState(0)
  const [syncRemaining, setSyncRemaining] = useState<number | null>(null)
  const [syncRunning, setSyncRunning] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [batchSize, setBatchSize] = useState(5)
  const stopRef = useRef(false)

  useEffect(() => {
    setLoading(true)
    fetchScoringPrompts()
      .then(setPositions)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  function updatePosition(updated: PositionWithPrompt) {
    setPositions((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
  }

  async function handleStartSync() {
    stopRef.current = false
    setSyncRunning(true)
    setSyncError(null)
    setSyncProcessed(0)
    setSyncFailed(0)
    setSyncTotal(null)
    setSyncRemaining(null)

    try {
      const initial = await syncScores({ dryRun: true })
      const total = initial.pending ?? 0
      setSyncTotal(total)
      setSyncRemaining(total)

      if (total === 0) return

      let remaining = total
      let processed = 0
      let failed = 0

      while (remaining > 0 && !stopRef.current) {
        const r = await syncScores({ limit: batchSize })
        processed += r.processed ?? 0
        failed += r.failed ?? 0
        remaining = r.remaining ?? 0
        setSyncProcessed(processed)
        setSyncFailed(failed)
        setSyncRemaining(remaining)
      }
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncRunning(false)
    }
  }

  function handleStop() {
    stopRef.current = true
  }

  // ── CV Enhancer state ──────────────────────────────────────────────────────
  const [cvTotal, setCvTotal] = useState<number | null>(null)
  const [cvProcessed, setCvProcessed] = useState(0)
  const [cvFailed, setCvFailed] = useState(0)
  const [cvRemaining, setCvRemaining] = useState<number | null>(null)
  const [cvRunning, setCvRunning] = useState(false)
  const [cvError, setCvError] = useState<string | null>(null)
  const [cvErrors, setCvErrors] = useState<{ id: number; error: string }[]>([])
  const [cvBatchSize, setCvBatchSize] = useState(5)
  const cvStopRef = useRef(false)

  async function handleStartCvSync() {
    cvStopRef.current = false
    setCvRunning(true)
    setCvError(null)
    setCvErrors([])
    setCvProcessed(0)
    setCvFailed(0)
    setCvTotal(null)
    setCvRemaining(null)

    try {
      const initial = await syncCv({ dryRun: true })
      const total = initial.pending ?? 0
      setCvTotal(total)
      setCvRemaining(total)

      if (total === 0) return

      let remaining = total
      let processed = 0
      let failed = 0

      while (remaining > 0 && !cvStopRef.current) {
        const r = await syncCv({ limit: cvBatchSize })
        processed += r.processed ?? 0
        failed += r.failed ?? 0
        remaining = r.remaining ?? 0
        if (r.errors?.length) setCvErrors((prev) => [...prev, ...(r.errors ?? [])])
        setCvProcessed(processed)
        setCvFailed(failed)
        setCvRemaining(remaining)
      }
    } catch (e) {
      setCvError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setCvRunning(false)
    }
  }

  function handleStopCv() {
    cvStopRef.current = true
  }

  const promptedCount = positions.filter((p) => p.prompt).length

  // ── Danger Zone state ──────────────────────────────────────────────────────
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  const [deleteRunning, setDeleteRunning] = useState(false)
  const [deleteResult, setDeleteResult] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function handleDeleteAll() {
    setDeleteRunning(true)
    setDeleteResult(null)
    setDeleteError(null)
    setDeleteConfirming(false)
    try {
      const res = await clearData('all_candidates')
      const n = res.deleted ?? 0
      setDeleteResult(`All data deleted — ${n} candidate${n !== 1 ? 's' : ''} removed.`)
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Operation failed')
    } finally {
      setDeleteRunning(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* AI Scoring Prompts */}
      <Card>
        <CardHeader>
          <CardTitle>AI Scoring Prompts</CardTitle>
          <p className="text-sm text-muted-foreground">
            Configure a scoring prompt per position. The AI will evaluate each candidate's CV,
            cover letter, and application answers and return a score from 0 to 100.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-48 rounded-xl border bg-muted/30 animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : positions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No positions found. Import candidates first to create positions.
            </p>
          ) : (
            <>
              <div className="text-xs text-muted-foreground">
                {promptedCount} of {positions.length} position{positions.length !== 1 ? 's' : ''} have a prompt configured.
              </div>
              <div className="space-y-4">
                {positions.map((pos) => (
                  <PromptCard key={pos.id} position={pos} onSaved={updatePosition} />
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Sync Scores */}
      <Card>
        <CardHeader>
          <CardTitle>Sync AI Scores</CardTitle>
          <p className="text-sm text-muted-foreground">
            Run AI scoring for all applications that have a configured prompt but haven't been scored yet.
            Saving a new prompt resets all scores for that position so they are re-evaluated.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label htmlFor="batch-size" className="text-sm text-muted-foreground whitespace-nowrap">
                Batch size:
              </label>
              <input
                id="batch-size"
                type="number"
                min="1"
                max="20"
                value={batchSize}
                onChange={(e) => setBatchSize(Math.min(20, Math.max(1, Number(e.target.value) || 5)))}
                disabled={syncRunning}
                className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50"
              />
            </div>
            {syncRunning ? (
              <Button size="sm" variant="destructive" onClick={handleStop}>
                Stop
              </Button>
            ) : (
              <Button size="sm" onClick={handleStartSync} disabled={promptedCount === 0}>
                Start Sync
              </Button>
            )}
            {promptedCount === 0 && !syncRunning && (
              <span className="text-xs text-muted-foreground">Save at least one prompt first.</span>
            )}
          </div>

          {syncTotal !== null && (
            <div className="space-y-2">
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{
                    width: syncTotal === 0
                      ? '100%'
                      : `${((syncTotal - (syncRemaining ?? syncTotal)) / syncTotal) * 100}%`,
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {syncTotal === 0
                    ? 'All up to date — nothing to score.'
                    : syncRunning
                    ? `Processing… ${syncTotal - (syncRemaining ?? syncTotal)} / ${syncTotal}`
                    : syncRemaining === 0
                    ? `Done — ${syncProcessed} scored${syncFailed > 0 ? `, ${syncFailed} failed` : ''}`
                    : `Stopped — ${syncProcessed} scored, ${syncRemaining} remaining`}
                </span>
                {syncFailed > 0 && (
                  <span className="text-destructive">{syncFailed} failed</span>
                )}
              </div>
            </div>
          )}

          {syncError && <p className="text-sm text-destructive">{syncError}</p>}
        </CardContent>
      </Card>

      {/* Candidate Enhancer AI */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-500" />
            Candidate Enhancer AI
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Parses uploaded CVs with AI and extracts structured data. Run manually to process new or
            unprocessed CVs without re-importing.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {['Deneyim (yıl)', 'Üniversite', 'Bölüm', 'İş Geçmişi', 'Beceriler', 'Diller'].map((label) => (
              <span
                key={label}
                className="inline-flex items-center rounded-full border bg-muted/50 px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
              >
                {label}
              </span>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label htmlFor="cv-batch-size" className="text-sm text-muted-foreground whitespace-nowrap">
                Batch size:
              </label>
              <input
                id="cv-batch-size"
                type="number"
                min="1"
                max="20"
                value={cvBatchSize}
                onChange={(e) => setCvBatchSize(Math.min(20, Math.max(1, Number(e.target.value) || 5)))}
                disabled={cvRunning}
                className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50"
              />
            </div>
            {cvRunning ? (
              <Button size="sm" variant="destructive" onClick={handleStopCv}>
                Stop
              </Button>
            ) : (
              <Button size="sm" onClick={handleStartCvSync}>
                Start Sync
              </Button>
            )}
          </div>

          {cvTotal !== null && (
            <div className="space-y-2">
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-violet-500 rounded-full transition-all duration-300"
                  style={{
                    width: cvTotal === 0
                      ? '100%'
                      : `${((cvProcessed + cvFailed) / cvTotal) * 100}%`,
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {cvTotal === 0
                    ? 'All up to date — no CVs to parse.'
                    : cvRunning
                    ? `Processing… ${cvProcessed + cvFailed} / ${cvTotal}`
                    : cvRemaining === 0
                    ? `Done — ${cvProcessed} parsed${cvFailed > 0 ? `, ${cvFailed} failed` : ''}`
                    : `Stopped — ${cvProcessed} parsed, ${cvRemaining} remaining`}
                </span>
                {cvFailed > 0 && (
                  <span className="text-destructive">{cvFailed} failed</span>
                )}
              </div>
            </div>
          )}

          {cvError && <p className="text-sm text-destructive">{cvError}</p>}

          {cvErrors.length > 0 && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1 max-h-48 overflow-y-auto">
              <p className="text-xs font-medium text-destructive mb-2">Parse errors ({cvErrors.length})</p>
              {cvErrors.map((e, i) => (
                <div key={i} className="text-xs text-muted-foreground font-mono">
                  <span className="text-destructive font-semibold">#{e.id}</span> — {e.error}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <TriangleAlert className="h-4 w-4" />
            Danger Zone
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Permanently deletes all candidates, applications, answers, and notes. This cannot be undone.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {deleteConfirming ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Are you sure?</span>
              <Button size="sm" variant="destructive" onClick={handleDeleteAll}>
                Yes, delete all
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDeleteConfirming(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              disabled={deleteRunning}
              onClick={() => { setDeleteResult(null); setDeleteError(null); setDeleteConfirming(true) }}
            >
              {deleteRunning ? 'Deleting…' : 'Delete All Data'}
            </Button>
          )}

          {deleteResult && (
            <p className="text-sm text-emerald-600 font-medium">{deleteResult}</p>
          )}
          {deleteError && (
            <p className="text-sm text-destructive">{deleteError}</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
