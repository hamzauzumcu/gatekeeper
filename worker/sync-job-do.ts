// SyncJobDO — a Durable Object that runs an AI sync job (scoring or CV parsing)
// entirely server-side. The browser only starts it, polls progress, and can stop it;
// the job keeps running even if the tab closes.
//
// One singleton per kind (idFromName('scores') / idFromName('cv')). On start it counts
// ALL pending applications (no cap), then drains them page by page (PAGE_SIZE rows at a
// time) until none remain or the job is stopped. Within each page it processes BATCH-size
// items concurrently per alarm() tick, so /stop stays responsive and each tick stays cheap.
//
// Failed items keep their old version, so the pending query would return them forever —
// we track their IDs in `failedIds` and exclude them from later pages. This guarantees
// every item is attempted at most once and the job always terminates.

import { DurableObject } from 'cloudflare:workers'
import { scoreApplication, PENDING_SCORES_FROM_WHERE } from './ai-scorer'
import { parseAndStoreResume } from './cv-parser'
import { PARSE_VERSION } from './cv-schema'

export type SyncKind = 'scores' | 'cv'
export type SyncStatus = 'idle' | 'running' | 'stopping' | 'done' | 'stopped' | 'error'

export interface SyncJobState {
  kind: SyncKind | null
  status: SyncStatus
  total: number
  processed: number
  failed: number
  cursor: number
  batchSize: number
  failedIds: number[]
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
    total: 0,
    processed: 0,
    failed: 0,
    cursor: 0,
    batchSize: 5,
    failedIds: [],
    errors: [],
    fatalError: null,
    startedAt: null,
    finishedAt: null,
  }
}

export class SyncJobDO extends DurableObject<WorkerBindings> {
  // Start (or restart) a job. No-op if one is already in flight.
  async start(kind: SyncKind, batchSize: number): Promise<SyncJobState> {
    const current = await this.getState()
    if (current.status === 'running' || current.status === 'stopping') {
      return current
    }

    let total: number
    let firstPage: number[]
    try {
      total = await this.countPending(kind)
      firstPage = total === 0 ? [] : await this.fetchPendingPage(kind, [], PAGE_SIZE)
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
      total,
      processed: 0,
      failed: 0,
      cursor: 0,
      batchSize: Math.max(1, Math.min(20, Math.round(batchSize) || 5)),
      failedIds: [],
      errors: [],
      fatalError: null,
      startedAt: now,
      finishedAt: total === 0 ? now : null,
    }

    await this.ctx.storage.put('page', firstPage)
    await this.ctx.storage.put('state', state)
    if (state.status === 'running') {
      await this.ctx.storage.setAlarm(Date.now())
    }
    return state
  }

  async status(): Promise<SyncJobState> {
    return this.getState()
  }

  // Request a stop. The alarm loop finalizes to 'stopped' before the next batch.
  async stop(): Promise<SyncJobState> {
    const state = await this.getState()
    if (state.status === 'running') {
      state.status = 'stopping'
      await this.ctx.storage.put('state', state)
    }
    return state
  }

  // Processes one batch per invocation, refetching the next page when the current one
  // is drained, then reschedules itself until done/stopped.
  async alarm(): Promise<void> {
    const state = await this.getState()
    if (state.status !== 'running' && state.status !== 'stopping') return

    if (state.status === 'stopping') {
      state.status = 'stopped'
      state.finishedAt = new Date().toISOString()
      await this.ctx.storage.put('state', state)
      return
    }

    let page = (await this.ctx.storage.get<number[]>('page')) ?? []

    // Current page drained — pull the next one (excluding already-failed IDs).
    if (state.cursor >= page.length) {
      let next: number[]
      try {
        next = await this.fetchPendingPage(state.kind!, state.failedIds, PAGE_SIZE)
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
    const results = await Promise.allSettled(chunk.map((id) => this.processOne(state.kind!, id)))
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.status === 'fulfilled') {
        state.processed++
      } else {
        state.failed++
        state.failedIds.push(chunk[i])
        const msg = r.reason instanceof Error ? r.reason.message : 'failed'
        if (state.errors.length < MAX_ERRORS) state.errors.push({ id: chunk[i], error: msg })
      }
    }
    state.cursor += chunk.length

    await this.ctx.storage.put('state', state)
    await this.ctx.storage.setAlarm(Date.now())
  }

  private async getState(): Promise<SyncJobState> {
    return (await this.ctx.storage.get<SyncJobState>('state')) ?? idleState()
  }

  private async processOne(kind: SyncKind, id: number): Promise<void> {
    if (kind === 'scores') {
      await scoreApplication(this.env.DB, id, this.env.DEEPSEEK_API_KEY)
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
    )
  }

  // Total count of pending applications for this kind (no cap).
  private async countPending(kind: SyncKind): Promise<number> {
    if (kind === 'scores') {
      const row = await this.env.DB
        .prepare(`SELECT COUNT(*) AS n ${PENDING_SCORES_FROM_WHERE}`)
        .first<{ n: number }>()
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

  // One page of pending IDs, ordered by id, excluding the given (failed) IDs.
  private async fetchPendingPage(kind: SyncKind, excludeIds: number[], pageSize: number): Promise<number[]> {
    if (kind === 'scores') {
      const exclude = excludeIds.length > 0 ? ` AND a.id NOT IN (${excludeIds.map(() => '?').join(',')})` : ''
      const { results } = await this.env.DB
        .prepare(`SELECT a.id ${PENDING_SCORES_FROM_WHERE}${exclude} ORDER BY a.id LIMIT ?`)
        .bind(...excludeIds, pageSize)
        .all<{ id: number }>()
      return results.map((r) => r.id)
    }
    const exclude = excludeIds.length > 0 ? ` AND id NOT IN (${excludeIds.map(() => '?').join(',')})` : ''
    const { results } = await this.env.DB
      .prepare(
        `SELECT id FROM applications
         WHERE resume_url IS NOT NULL AND resume_parse_version < ?${exclude}
         ORDER BY id
         LIMIT ?`,
      )
      .bind(PARSE_VERSION, ...excludeIds, pageSize)
      .all<{ id: number }>()
    return results.map((r) => r.id)
  }
}
