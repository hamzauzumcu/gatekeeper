import { apiFetch } from './api'
// Interview scorecard types + fetch helpers (browser-side).
// A scorecard is a position's set of weighted hard/soft interview criteria,
// edited in Settings. Kept in sync with worker/scorecards.ts.

export type ScorecardCategory = 'hard' | 'soft'

export type ScorecardCriterion = {
  id: number
  category: ScorecardCategory
  name: string
  description: string | null
  weight: number
  sort_order: number
}

// A criterion as submitted by the editor: `id` present = update, absent = insert.
export type ScorecardCriterionInput = {
  id?: number
  category: ScorecardCategory
  name: string
  description: string | null
  weight: number
}

export type PositionScorecard = {
  position_id: number
  position_title: string
  criteria: ScorecardCriterion[]
}

export const SCORECARD_CATEGORY_LABELS: Record<ScorecardCategory, string> = {
  hard: 'Hard skills',
  soft: 'Soft skills',
}

// Built-in example template (the Senior PM hiring scorecard) used to seed an
// empty editor with one click — same idea as the default AI scoring prompts.
export const EXAMPLE_SCORECARD: Omit<ScorecardCriterionInput, 'id'>[] = [
  {
    category: 'hard',
    name: 'Product Competency',
    description:
      'Has a solid PM foundation and enough hands-on experience (5+ years) to lead product development from idea to go-to-market.',
    weight: 20,
  },
  {
    category: 'hard',
    name: 'Analytical Thinking',
    description:
      'Structures complex problems, identifies root causes, and makes evidence-based decisions using data.',
    weight: 10,
  },
  {
    category: 'hard',
    name: 'Execution',
    description: 'Takes end-to-end ownership and gets things done.',
    weight: 17,
  },
  {
    category: 'hard',
    name: 'Technical Fluency',
    description:
      'Has a strong technical background and understands technical concepts and trade-offs well, including APIs, SQL, and data flows.',
    weight: 10,
  },
  {
    category: 'hard',
    name: 'Communication',
    description:
      'Communicates clearly, listens effectively, manages stakeholders, and influences decisions constructively.',
    weight: 8,
  },
  {
    category: 'soft',
    name: 'Hardworking',
    description:
      'Loves the work, digs into exhausting and ugly details whenever needed, and acts as operational glue with high availability.',
    weight: 10,
  },
  {
    category: 'soft',
    name: 'Resilience',
    description: 'Remains effective through setbacks, uncertainty, pressure, or failure.',
    weight: 5,
  },
  {
    category: 'soft',
    name: 'Attitude',
    description:
      'Demonstrates humility, knows when to put ego aside in favour of pragmatism, is highly accountable, curious, and open to feedback.',
    weight: 10,
  },
  {
    category: 'soft',
    name: 'Motivation',
    description: 'Genuinely wants this role and understands why.',
    weight: 5,
  },
  {
    category: 'soft',
    name: 'Culture Fit',
    description: "Can succeed within the company's working environment and expectations.",
    weight: 5,
  },
]

export async function fetchScorecards(): Promise<PositionScorecard[]> {
  const res = await apiFetch('/api/admin/scorecards')
  const data = (await res.json()) as
    | { ok: true; scorecards: PositionScorecard[] }
    | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'failed to fetch scorecards')
  return data.scorecards
}

// Replace a position's criteria set (empty list clears the scorecard).
// Returns the saved criteria with server-assigned ids and sort order.
export async function saveScorecard(
  positionId: number,
  criteria: ScorecardCriterionInput[]
): Promise<ScorecardCriterion[]> {
  const res = await apiFetch(`/api/admin/scorecards/${positionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ criteria }),
  })
  const data = (await res.json()) as
    | { ok: true; criteria: ScorecardCriterion[] }
    | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'failed to save scorecard')
  return data.criteria
}

// ── Interview scorecard submissions (per application) ──────────────────────
// Mirrors worker/interview-scorecards.ts.

export type ScorecardSubmission = {
  id: number
  interviewer: string
  interviewer_name: string
  created_at: string
  updated_at: string
  // criterion_id -> score (1-5). Missing key = N/A / not observed.
  scores: Record<number, number>
}

export type CriterionAggregate = {
  criterion_id: number
  average: number | null // null = not assessed yet
  weighted_points: number | null
}

export type ApplicationScorecard = {
  application_id: number
  position_id: number
  position_title: string
  criteria: ScorecardCriterion[]
  submissions: ScorecardSubmission[]
  aggregate: {
    per_criterion: CriterionAggregate[]
    final_score: number | null
    complete: boolean
  }
}

export const SCORE_LABELS: Record<number, string> = {
  1: 'Very weak',
  2: 'Below expectations',
  3: 'Meets expectations',
  4: 'Strong',
  5: 'Exceptional',
}

export async function fetchApplicationScorecard(applicationId: number): Promise<ApplicationScorecard> {
  const res = await apiFetch(`/api/applications/${applicationId}/scorecard`)
  const data = (await res.json()) as
    | { ok: true; scorecard: ApplicationScorecard }
    | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'failed to fetch scorecard')
  return data.scorecard
}

// Submit/update the caller's scorecard. `scores` maps criterion_id -> 1-5;
// null = N/A. Returns the refreshed full scorecard state.
export async function saveInterviewScorecard(
  applicationId: number,
  scores: Record<number, number | null>
): Promise<ApplicationScorecard> {
  const res = await apiFetch(`/api/applications/${applicationId}/scorecard`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scores }),
  })
  const data = (await res.json()) as
    | { ok: true; scorecard: ApplicationScorecard }
    | { ok: false; error: string }
  if (!res.ok || !data.ok) throw new Error('error' in data ? data.error : 'failed to save scorecard')
  return data.scorecard
}
