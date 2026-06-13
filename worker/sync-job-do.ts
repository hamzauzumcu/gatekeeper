// SyncJobDO — a Durable Object that runs an AI sync job (scoring or CV parsing)
// entirely server-side. The browser only starts it, polls progress, and can stop it;
// the job keeps running even if the tab closes.
//
// One singleton per kind (idFromName('scores') / idFromName('cv')). On start it counts
// ALL pending applications (no cap), then drains them page by page (PAGE_SIZE rows at a
// time) until none remain or the job is stopped. Within each page it processes BATCH-size
// items concurrently per alarm() tick, so /stop stays responsive and each tick stays cheap.
//
// Failed items keep their old version, so the pending query would return them forever.
// We page by an id watermark (`cursorId`): each page is the next block of pending rows
// with `id > cursorId`, processed in id order, and the watermark advances to the page's
// max id. Failed rows stay below the watermark, so they're never refetched. This keeps
// the bound-parameter count constant, guarantees every item is attempted at most once,
// and ensures the job always terminates.

import { DurableObject } from 'cloudflare:workers'
import { scoreApplication, PENDING_SCORES_FROM_WHERE } from './ai-scorer'
import { parseAndStoreResume } from './cv-parser'
import { PARSE_VERSION } from './cv-schema'

export type SyncKind = 'scores' | 'cv'
export type SyncStatus = 'idle' | 'running' | 'stopping' | 'done' | 'stopped' | 'error'

export interface SyncJobState {
  kind: SyncKind | null
  status: SyncStatus
  // Scope the job to a single position (scores only). null = all positions.
  positionId: number | null
  total: number
  processed: number
  failed: number
  cursor: number
  cursorId: number
  batchSize: number
  errors: { id: number; error: string }[]
  fatalError: string | null
  startedAt: string | null
  finishedAt: string | null
}

type WorkerBindings = {
  DEEPSEEK_API_KEY: string
  OPENAI_API_KEY?: string
  DB: D1Database
  RESUMES: R2Bucket
  R2_PUBLIC_URL: string
}

// How many pending IDs to pull from the DB per page.
const PAGE_SIZE = 500
// Cap on stored per-item error messages (the progress UI only needs a sample).
const MAX_ERRORS = 50

function idleState(): SyncJobState {
  return {
    kind: null,
    status: 'idle',
    positionId: null,
    total: 0,
    processed: 0,
    failed: 0,
    cursor: 0,
    cursorId: 0,
    batchSize: 5,
    errors: [],
    fatalError: null,
    startedAt: null,
    finishedAt: null,
  }
}

export class SyncJobDO extends DurableObject<WorkerBindings> {
  // Aborts the LLM requests of the batch currently in flight. Lives in memory (not
  // storage) because it only needs to reach the alarm invocation running on this same
  // instance. stop() aborts it so an in-flight batch is cancelled immediately instead of
  // having to run to completion before the stop flag is honored. null between batches.
  private inFlight: AbortController | null = null

  // Start (or restart) a job. No-op if one is already in flight.
  // positionId scopes a scores job to one position (null = all positions). Ignored for cv.
  async start(kind: SyncKind, batchSize: number, positionId: number | null = null): Promise<SyncJobState> {
    const current = await this.getState()
    if (current.status === 'running' || current.status === 'stopping') {
      return current
    }

    const scope = kind === 'scores' ? positionId : null

    let total: number
    let firstPage: number[]
    try {
      total = await this.countPending(kind, scope)
      firstPage = total === 0 ? [] : await this.fetchPendingPage(kind, scope, 0, PAGE_SIZE)
    } catch (e) {
      const state: SyncJobState = {
        ...idleState(),
        kind,
        status: 'error',
        fatalError: e instanceof Error ? e.message : 'failed to load pending items',
        finishedAt: new Date().toISOString(),
      }
      await this.ctx.storage.put('state', state)
      return state
    }

    const now = new Date().toISOString()
    const state: SyncJobState = {
      kind,
      status: total === 0 ? 'done' : 'running',
      positionId: scope,
      total,
      processed: 0,
      failed: 0,
      cursor: 0,
      cursorId: 0,
      batchSize: Math.max(1, Math.min(20, Math.round(batchSize) || 5)),
      errors: [],
      fatalError: null,
      startedAt: now,
      finishedAt: total === 0 ? now : null,
    }

    await this.ctx.storage.delete('stopRequested')
    await this.ctx.storage.put('page', firstPage)
    await this.ctx.storage.put('state', state)
    if (state.status === 'running') {
      await this.ctx.storage.setAlarm(Date.now())
    }
    return state
  }

  async status(): Promise<SyncJobState> {
    const state = await this.getState()
    // Self-heal: a job marked running/stopping must always have a pending alarm.
    // If none is scheduled, the alarm loop died (eviction, deploy, or an invocation
    // killed mid-batch) — re-kick it. The browser polls status() every ~1.5s, so a
    // stalled job resumes on its own. alarm() guards on status, so this is idempotent.
    if (state.status === 'running' || state.status === 'stopping') {
      const pending = await this.ctx.storage.getAlarm()
      if (pending === null) await this.ctx.storage.setAlarm(Date.now())
    }
    return state
  }

  // Request a stop. We set a dedicated `stopRequested` flag (the source of truth for
  // the stop signal) separately from the mutable progress `state`. The alarm loop owns
  // `state` and may hold a stale copy across a long LLM batch; if stop only mutated
  // `state`, the alarm's end-of-batch persist would clobber it (lost update) and the
  // job would never stop. The flag survives that persist because the alarm re-reads it.
  async stop(): Promise<SyncJobState> {
    const state = await this.getState()
    if (state.status === 'running') {
      await this.ctx.storage.put('stopRequested', true)
      state.status = 'stopping'
      await this.ctx.storage.put('state', state)
    }
    // Cancel the in-flight batch's LLM requests so the alarm unblocks now rather than
    // after a (potentially minutes-long) OCR + scoring batch finishes. Safe to call even
    // when no batch is running. Always attempt it, even if status was already 'stopping',
    // so a repeated Stop click can interrupt a batch that started after the first request.
    this.inFlight?.abort()
    return state
  }

  // Processes one batch per invocation, refetching the next page when the current one
  // is drained, then reschedules itself until done/stopped.
  async alarm(): Promise<void> {
    const state = await this.getState()
    if (state.status !== 'running' && state.status !== 'stopping') return

    // Honor a stop requested before this tick (or while it was waiting to fire).
    if (state.status === 'stopping' || (await this.ctx.storage.get<boolean>('stopRequested'))) {
      return this.finalizeStopped(state)
    }

    let page = (await this.ctx.storage.get<number[]>('page')) ?? []

    // Current page drained — pull the next one (excluding already-failed IDs).
    if (state.cursor >= page.length) {
      let next: number[]
      try {
        next = await this.fetchPendingPage(state.kind!, state.positionId, state.cursorId, PAGE_SIZE)
      } catch (e) {
        state.status = 'error'
        state.fatalError = e instanceof Error ? e.message : 'failed to load next page'
        state.finishedAt = new Date().toISOString()
        await this.ctx.storage.put('state', state)
        return
      }
      if (next.length === 0) {
        state.status = 'done'
        state.finishedAt = new Date().toISOString()
        await this.ctx.storage.put('state', state)
        return
      }
      page = next
      state.cursor = 0
      await this.ctx.storage.put('page', page)
    }

    const chunk = page.slice(state.cursor, state.cursor + state.batchSize)
    const controller = new AbortController()
    this.inFlight = controller
    let results: PromiseSettledResult<void>[]
    try {
      results = await Promise.allSettled(chunk.map((id) => this.processOne(state.kind!, id, controller.signal)))
    } finally {
      if (this.inFlight === controller) this.inFlight = null
    }

    // A stop may have arrived during the (long) batch await above — either before it
    // started (flag set) or mid-flight (stop() aborted the controller, rejecting the
    // in-flight requests). Don't record aborted requests as failures or advance the
    // watermark; just credit whatever genuinely completed and finalize immediately.
    if (controller.signal.aborted || (await this.ctx.storage.get<boolean>('stopRequested'))) {
      for (const r of results) if (r.status === 'fulfilled') state.processed++
      return this.finalizeStopped(state)
    }

    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.status === 'fulfilled') {
        state.processed++
      } else {
        state.failed++
        const msg = r.reason instanceof Error ? r.reason.message : 'failed'
        if (state.errors.length < MAX_ERRORS) state.errors.push({ id: chunk[i], error: msg })
      }
    }
    state.cursor += chunk.length
    // Advance the watermark past everything in this chunk (page is ordered by id, so the
    // last element is the max). Failed rows stay below it and are never refetched.
    if (chunk.length > 0) state.cursorId = chunk[chunk.length - 1]

    await this.ctx.storage.put('state', state)
    await this.ctx.storage.setAlarm(Date.now())
  }

  private async finalizeStopped(state: SyncJobState): Promise<void> {
    state.status = 'stopped'
    state.finishedAt = new Date().toISOString()
    await this.ctx.storage.put('state', state)
    await this.ctx.storage.delete('stopRequested')
  }

  private async getState(): Promise<SyncJobState> {
    return (await this.ctx.storage.get<SyncJobState>('state')) ?? idleState()
  }

  private async processOne(kind: SyncKind, id: number, signal: AbortSignal): Promise<void> {
    if (kind === 'scores') {
      await scoreApplication(this.env.DB, id, this.env, signal)
      return
    }
    const row = await this.env.DB
      .prepare(`SELECT resume_url FROM applications WHERE id = ? AND resume_url IS NOT NULL`)
      .bind(id)
      .first<{ resume_url: string }>()
    if (!row) throw new Error('not found or no resume')
    await parseAndStoreResume(
      this.env.DB,
      id,
      row.resume_url,
      this.env.DEEPSEEK_API_KEY,
      this.env.RESUMES,
      this.env.R2_PUBLIC_URL,
      this.env.OPENAI_API_KEY,
      signal,
    )
  }

  // Total count of pending applications for this kind (no cap).
  // positionId (scores only) scopes the count to a single position; null = all.
  private async countPending(kind: SyncKind, positionId: number | null): Promise<number> {
    if (kind === 'scores') {
      const sql = `SELECT COUNT(*) AS n ${PENDING_SCORES_FROM_WHERE}${positionId != null ? ' AND a.position_id = ?' : ''}`
      const stmt = positionId != null
        ? this.env.DB.prepare(sql).bind(positionId)
        : this.env.DB.prepare(sql)
      const row = await stmt.first<{ n: number }>()
      return row?.n ?? 0
    }
    const row = await this.env.DB
      .prepare(
        `SELECT COUNT(*) AS n FROM applications
         WHERE resume_url IS NOT NULL AND resume_parse_version < ?`,
      )
      .bind(PARSE_VERSION)
      .first<{ n: number }>()
    return row?.n ?? 0
  }

  // One page of pending IDs with id > afterId, ordered by id. The fixed three-parameter
  // shape never grows with the failure count, so it can't hit D1's bound-parameter limit.
  private async fetchPendingPage(kind: SyncKind, positionId: number | null, afterId: number, pageSize: number): Promise<number[]> {
    if (kind === 'scores') {
      const posClause = positionId != null ? ' AND a.position_id = ?' : ''
      const sql = `SELECT a.id ${PENDING_SCORES_FROM_WHERE} AND a.id > ?${posClause} ORDER BY a.id LIMIT ?`
      const binds = positionId != null ? [afterId, positionId, pageSize] : [afterId, pageSize]
      const { results } = await this.env.DB
        .prepare(sql)
        .bind(...binds)
        .all<{ id: number }>()
      return results.map((r) => r.id)
    }
    const { results } = await this.env.DB
      .prepare(
        `SELECT id FROM applications
         WHERE resume_url IS NOT NULL AND resume_parse_version < ? AND id > ?
         ORDER BY id
         LIMIT ?`,
      )
      .bind(PARSE_VERSION, afterId, pageSize)
      .all<{ id: number }>()
    return results.map((r) => r.id)
  }
}
