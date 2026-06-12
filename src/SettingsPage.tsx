import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { fetchScoringPrompts, saveScoringPrompt, syncScores, type PositionWithPrompt } from './lib/candidates'
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
      <div className="flex items-start justify-between bg-muted/40 px-5 py-4">
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
        <div className="flex items-center gap-2">
          {!text && (
            <Button variant="outline" size="sm" onClick={loadDefault}>
              Load Default
            </Button>
          )}
          {text && text !== defaultPrompt && !position.prompt && (
            <Button variant="outline" size="sm" onClick={loadDefault}>
              Load Default
            </Button>
          )}
        </div>
      </div>

      <div className="p-5 space-y-3">
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
    </div>
  )
}

export default function SettingsPage() {
  const [positions, setPositions] = useState<PositionWithPrompt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [syncPending, setSyncPending] = useState<number | null>(null)
  const [syncRunning, setSyncRunning] = useState(false)
  const [syncResult, setSyncResult] = useState<{ processed: number; failed: number; remaining: number } | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncLimit, setSyncLimit] = useState('10')

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

  async function handleCheckPending() {
    setSyncError(null)
    try {
      const r = await syncScores({ dryRun: true })
      setSyncPending(r.pending ?? 0)
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'Check failed')
    }
  }

  async function handleRunSync() {
    setSyncRunning(true)
    setSyncError(null)
    setSyncResult(null)
    try {
      const limit = Math.min(50, Math.max(1, Number(syncLimit) || 10))
      const r = await syncScores({ limit })
      setSyncResult({ processed: r.processed ?? 0, failed: r.failed ?? 0, remaining: r.remaining ?? 0 })
      setSyncPending(r.remaining ?? 0)
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncRunning(false)
    }
  }

  const promptedCount = positions.filter((p) => p.prompt).length

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
            <Button variant="outline" size="sm" onClick={handleCheckPending} disabled={syncRunning}>
              Check Pending
            </Button>
            {syncPending !== null && (
              <span className="text-sm text-muted-foreground">
                {syncPending === 0 ? 'All up to date.' : `${syncPending} application${syncPending !== 1 ? 's' : ''} pending scoring.`}
              </span>
            )}
          </div>

          <Separator />

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label htmlFor="sync-limit" className="text-sm text-muted-foreground whitespace-nowrap">
                Batch size:
              </label>
              <input
                id="sync-limit"
                type="number"
                min="1"
                max="50"
                value={syncLimit}
                onChange={(e) => setSyncLimit(e.target.value)}
                className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              />
            </div>
            <Button size="sm" onClick={handleRunSync} disabled={syncRunning || promptedCount === 0}>
              {syncRunning ? 'Running…' : 'Run Sync'}
            </Button>
            {promptedCount === 0 && (
              <span className="text-xs text-muted-foreground">Save at least one prompt first.</span>
            )}
          </div>

          {syncResult && (
            <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm space-y-0.5">
              <div>Processed: <span className="font-medium text-green-700">{syncResult.processed}</span></div>
              {syncResult.failed > 0 && (
                <div>Failed: <span className="font-medium text-red-600">{syncResult.failed}</span></div>
              )}
              <div>Remaining: <span className="font-medium">{syncResult.remaining}</span></div>
            </div>
          )}

          {syncError && <p className="text-sm text-destructive">{syncError}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
