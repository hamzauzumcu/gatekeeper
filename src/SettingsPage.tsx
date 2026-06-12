import { useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ChevronDown, Sparkles, TriangleAlert } from 'lucide-react'
import {
  fetchScoringPrompts,
  saveScoringPrompt,
  fetchPendingScoreIds,
  scoreOneApplication,
  fetchPendingCvIds,
  parseSingleCv,
  clearData,
  type PositionWithPrompt,
} from './lib/candidates'
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

// ── Shared sync progress panel ─────────────────────────────────────────────

type SyncPhase = 'idle' | 'fetching' | 'running' | 'done' | 'stopped' | 'error'

interface SyncPanelProps {
  accent: string
  phase: SyncPhase
  total: number
  processed: number
  failed: number
  errors: { id: number; error: string }[]
  fatalError: string | null
  batchSize: number
  onBatchSizeChange: (n: number) => void
  onStart: () => void
  onStop: () => void
  disabled?: boolean
  disabledHint?: string
  itemLabel: string
}

function SyncPanel({
  accent,
  phase,
  total,
  processed,
  failed,
  errors,
  fatalError,
  batchSize,
  onBatchSizeChange,
  onStart,
  onStop,
  disabled,
  disabledHint,
  itemLabel,
}: SyncPanelProps) {
  const [errorsOpen, setErrorsOpen] = useState(false)
  const running = phase === 'fetching' || phase === 'running'
  const done = phase === 'done'
  const pct = total > 0 ? Math.round(((processed + failed) / total) * 100) : 0
  const barColor = done && failed === 0 ? 'bg-emerald-500' : accent

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground whitespace-nowrap">Batch size:</label>
          <input
            type="number"
            min="1"
            max="20"
            value={batchSize}
            onChange={(e) => onBatchSizeChange(Math.max(1, Math.min(20, Number(e.target.value) || 5)))}
            disabled={running}
            className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50"
          />
        </div>
        {running ? (
          <Button size="sm" variant="destructive" onClick={onStop}>
            Stop
          </Button>
        ) : (
          <Button size="sm" onClick={onStart} disabled={disabled}>
            Start Sync
          </Button>
        )}
        {!running && disabled && disabledHint && (
          <span className="text-xs text-muted-foreground">{disabledHint}</span>
        )}
      </div>

      {/* Progress */}
      {phase !== 'idle' && (
        <div className="space-y-2">
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            {phase === 'fetching' ? (
              <div className={`h-full w-full ${accent} opacity-30 animate-pulse rounded-full`} />
            ) : (
              <div
                className={`h-full ${barColor} rounded-full transition-all duration-500`}
                style={{ width: total === 0 ? '100%' : `${pct}%` }}
              />
            )}
          </div>

          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {phase === 'fetching' && 'Fetching pending items…'}
              {phase === 'running' && `Processing ${processed + failed} / ${total}`}
              {phase === 'done' && total === 0 && 'All up to date — nothing to process.'}
              {phase === 'done' && total > 0 && failed === 0 && `Done — all ${total} ${itemLabel} successfully`}
              {phase === 'done' && total > 0 && failed > 0 && `Done — ${processed} ${itemLabel}, ${failed} failed`}
              {phase === 'stopped' && `Stopped — ${processed} ${itemLabel}, ${total - processed - failed} remaining`}
              {phase === 'error' && 'Failed to start — see error below'}
            </span>
            {phase === 'running' && total > 0 && (
              <span className="tabular-nums shrink-0 font-medium">{pct}%</span>
            )}
          </div>

          {phase === 'running' && (processed > 0 || failed > 0) && (
            <div className="flex gap-4 text-xs">
              {processed > 0 && (
                <span className="text-emerald-600 tabular-nums">{processed} ok</span>
              )}
              {failed > 0 && (
                <span className="text-destructive tabular-nums">{failed} failed</span>
              )}
              <span className="text-muted-foreground tabular-nums">
                {total - processed - failed} remaining
              </span>
            </div>
          )}
        </div>
      )}

      {fatalError && <p className="text-sm text-destructive">{fatalError}</p>}

      {errors.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setErrorsOpen((o) => !o)}
            className="flex items-center gap-1 text-xs font-medium text-destructive hover:text-destructive/80 transition-colors"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-200 ${errorsOpen ? 'rotate-180' : ''}`}
            />
            {errors.length} error{errors.length !== 1 ? 's' : ''}
          </button>
          {errorsOpen && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1 max-h-40 overflow-y-auto">
              {errors.map((e, i) => (
                <div key={i} className="text-xs font-mono text-muted-foreground">
                  <span className="text-destructive font-semibold">#{e.id}</span> — {e.error}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main settings page ─────────────────────────────────────────────────────

export default function SettingsPage() {
  const [positions, setPositions] = useState<PositionWithPrompt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  // ── Sync AI Scores state ───────────────────────────────────────────────
  const [scoresPhase, setScoresPhase] = useState<SyncPhase>('idle')
  const [scoresTotal, setScoresTotal] = useState(0)
  const [scoresProcessed, setScoresProcessed] = useState(0)
  const [scoresFailed, setScoresFailed] = useState(0)
  const [scoresErrors, setScoresErrors] = useState<{ id: number; error: string }[]>([])
  const [scoresFatalError, setScoresFatalError] = useState<string | null>(null)
  const [scoresBatchSize, setScoresBatchSize] = useState(5)
  const scoresStopRef = useRef(false)

  async function handleStartSync() {
    scoresStopRef.current = false
    setScoresPhase('fetching')
    setScoresErrors([])
    setScoresFatalError(null)
    setScoresProcessed(0)
    setScoresFailed(0)
    setScoresTotal(0)

    try {
      const ids = await fetchPendingScoreIds()
      setScoresTotal(ids.length)

      if (ids.length === 0) {
        setScoresPhase('done')
        return
      }

      setScoresPhase('running')
      let processed = 0
      let failed = 0

      for (let i = 0; i < ids.length; i += scoresBatchSize) {
        if (scoresStopRef.current) break
        const chunk = ids.slice(i, i + scoresBatchSize)
        const results = await Promise.allSettled(chunk.map((id) => scoreOneApplication(id)))
        for (let j = 0; j < results.length; j++) {
          const r = results[j]
          if (r.status === 'fulfilled') {
            processed++
          } else {
            failed++
            const msg = r.reason instanceof Error ? r.reason.message : 'score failed'
            console.error(`[sync-scores] #${chunk[j]} failed:`, msg)
            setScoresErrors((prev) => [...prev, { id: chunk[j], error: msg }])
          }
        }
        setScoresProcessed(processed)
        setScoresFailed(failed)
      }

      setScoresPhase(scoresStopRef.current ? 'stopped' : 'done')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sync failed'
      console.error('[sync-scores] fatal:', msg)
      setScoresFatalError(msg)
      setScoresPhase('error')
    }
  }

  function handleStopScores() {
    scoresStopRef.current = true
  }

  // ── CV Enhancer state ──────────────────────────────────────────────────
  const [cvPhase, setCvPhase] = useState<SyncPhase>('idle')
  const [cvTotal, setCvTotal] = useState(0)
  const [cvProcessed, setCvProcessed] = useState(0)
  const [cvFailed, setCvFailed] = useState(0)
  const [cvErrors, setCvErrors] = useState<{ id: number; error: string }[]>([])
  const [cvFatalError, setCvFatalError] = useState<string | null>(null)
  const [cvBatchSize, setCvBatchSize] = useState(5)
  const cvStopRef = useRef(false)

  async function handleStartCvSync() {
    cvStopRef.current = false
    setCvPhase('fetching')
    setCvErrors([])
    setCvFatalError(null)
    setCvProcessed(0)
    setCvFailed(0)
    setCvTotal(0)

    try {
      const ids = await fetchPendingCvIds()
      setCvTotal(ids.length)

      if (ids.length === 0) {
        setCvPhase('done')
        return
      }

      setCvPhase('running')
      let processed = 0
      let failed = 0

      for (let i = 0; i < ids.length; i += cvBatchSize) {
        if (cvStopRef.current) break
        const chunk = ids.slice(i, i + cvBatchSize)
        const results = await Promise.allSettled(chunk.map((id) => parseSingleCv(id)))
        for (let j = 0; j < results.length; j++) {
          const r = results[j]
          if (r.status === 'fulfilled') {
            processed++
          } else {
            failed++
            const msg = r.reason instanceof Error ? r.reason.message : 'parse failed'
            console.error(`[cv-enhancer] #${chunk[j]} failed:`, msg)
            setCvErrors((prev) => [...prev, { id: chunk[j], error: msg }])
          }
        }
        setCvProcessed(processed)
        setCvFailed(failed)
      }

      setCvPhase(cvStopRef.current ? 'stopped' : 'done')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sync failed'
      console.error('[cv-enhancer] fatal:', msg)
      setCvFatalError(msg)
      setCvPhase('error')
    }
  }

  function handleStopCv() {
    cvStopRef.current = true
  }

  const promptedCount = positions.filter((p) => p.prompt).length

  // ── Danger Zone state ──────────────────────────────────────────────────
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

      {/* Sync AI Scores */}
      <Card>
        <CardHeader>
          <CardTitle>Sync AI Scores</CardTitle>
          <p className="text-sm text-muted-foreground">
            Run AI scoring for all applications that have a configured prompt but haven't been scored yet.
            Saving a new prompt resets all scores for that position so they are re-evaluated.
          </p>
        </CardHeader>
        <CardContent>
          <SyncPanel
            accent="bg-primary"
            phase={scoresPhase}
            total={scoresTotal}
            processed={scoresProcessed}
            failed={scoresFailed}
            errors={scoresErrors}
            fatalError={scoresFatalError}
            batchSize={scoresBatchSize}
            onBatchSizeChange={setScoresBatchSize}
            onStart={handleStartSync}
            onStop={handleStopScores}
            disabled={promptedCount === 0}
            disabledHint="Save at least one prompt first."
            itemLabel="scored"
          />
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
            {['Experience (yrs)', 'University', 'Field of Study', 'Work History', 'Languages'].map((label) => (
              <span
                key={label}
                className="inline-flex items-center rounded-full border bg-muted/50 px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
              >
                {label}
              </span>
            ))}
          </div>

          <SyncPanel
            accent="bg-violet-500"
            phase={cvPhase}
            total={cvTotal}
            processed={cvProcessed}
            failed={cvFailed}
            errors={cvErrors}
            fatalError={cvFatalError}
            batchSize={cvBatchSize}
            onBatchSizeChange={setCvBatchSize}
            onStart={handleStartCvSync}
            onStop={handleStopCv}
            itemLabel="parsed"
          />
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
