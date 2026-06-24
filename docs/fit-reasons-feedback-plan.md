# Fit-Reasons Feedback Loop — Development Plan

> Status: **Not started** — saved for future development (2026-06-24).
> Goal: close the gap between the human decision (`applicants.fit_status`) and AI
> scoring. Today they are fully disconnected — the AI scores, the human marks
> good/maybe/not fit, but the human's reasoning never feeds back into the AI.

## Concept

When a recruiter sets `fit_status` on a single candidate, a bottom sheet opens
asking **what they liked / disliked** about this specific CV. Answers are
captured as a **canonical, per-position tag vocabulary** (not free text) so they
can be aggregated. The AI pre-selects the likely tags from the CV; the recruiter
just confirms/edits. Everything is **skippable** (not mandatory). Aggregated
per position, these tags drive **human-approved scoring-prompt improvements**.

### Locked design decisions
- **Tag vocabulary source:** Seed + AI grows it. Each position gets a few hand
  seeded tags; the AI may propose new themes that get added to the dictionary.
- **Trigger:** Opens for all three decisions — `good_fit`, `maybe`, `not_fit`
  (positive vs negative tags surfaced by `polarity`).
- **Critical constraint:** AI-suggested tags MUST be pinned into the canonical
  dictionary (not freshly phrased per CV) — otherwise per-position aggregation
  is worthless. This is the heart of the design.

## Tech context (existing system)
- Frontend: React 19 + Radix UI + Tailwind 4 (Vite/TS).
- Backend: Cloudflare Workers (Hono) + D1 (SQLite) + R2.
- AI: DeepSeek (OpenAI-compatible). `deepseek-v4-flash` (fast/cheap),
  `deepseek-v4-pro` (quality).
- `fit_status` stored on `applicants` (migration `0003_fit_status.sql`),
  values `good_fit | maybe | not_fit | NULL`.
- Scoring: `worker/ai-scorer.ts`; prompts in `scoring_prompts` table, editable
  in `src/SettingsPage.tsx`. Auto re-score already exists: bumping
  `scoring_prompts.updated_at` makes the next sync re-score candidates whose
  `applications.ai_scored_prompt_at` is older.
- Clone-able patterns: `worker/interview-notes.ts` (CV + notes + prompt → AI),
  `worker/outreach-email.ts`.

## Plan

### 1. Data layer — new migration `0014_fit_reasons.sql`
`fit_reason_options` (per-position reason dictionary):
```
id, position_id, label, polarity ('positive'|'negative'|'neutral'),
source ('seed'|'ai'|'manual'), active, created_at
```
- Seed a handful of tags per position (positive: strong domain, top-tier
  university; negative: domain mismatch, experience gap, ...).
- `polarity` lets the sheet surface positive tags for good_fit, negative for
  not_fit.

`fit_reasons` (per-candidate selections):
```
id, applicant_id, option_id, custom_text, fit_status, created_by, created_at
```
- `option_id` NULL + `custom_text` set = free CV-specific note.
- `fit_status` is snapshotted so we keep the decision even if it changes later.

### 2. Mark flow — frontend (`src/CandidatesPage.tsx`)
- After `updateApplicantsFitStatus` succeeds on a **single** candidate, open a
  Radix bottom Sheet (clone existing detail-sheet pattern).
- Tags arrive **pre-selected** (AI guess, step 4); recruiter multi-selects.
- Optional free-text field + **Skip / "don't ask again"**.
- Do NOT open the sheet on bulk fit-status changes (single selections only).

### 3. Backend endpoints (`worker/index.ts` + new `worker/fit-reasons.ts`)
- `GET  /api/candidates/:id/fit-reasons/options` → active tags for the position
  + AI pre-selection.
- `POST /api/candidates/:id/fit-reasons` → persist selections.
- `GET  /api/admin/fit-reasons/aggregate/:positionId` → stats for Settings panel.
- `POST /api/admin/fit-reasons/suggest-prompt/:positionId` → prompt diff proposal.

### 4. AI pre-selection (at mark time, cheap) — new `worker/fit-reason-suggest.ts`
- Clone `worker/interview-notes.ts`.
- Input: CV summary + active tag list + fit_status.
- Output: which `option_id`s apply (JSON array) + optional new-tag proposal
  (inserted into dictionary as `source='ai'` → this is the "AI grows" path).
- Model: `deepseek-v4-flash`; fill async after the sheet opens so it never
  blocks the mark action.

### 5. Aggregate + prompt improvement (`src/SettingsPage.tsx`)
- Panel next to the scoring-prompt section.
- Show per-position frequencies: "good_fit most common: DB exp 80% ..." /
  "not_fit most common: domain mismatch 70% ...".
- Button **"Get AI prompt suggestion"** → stats + current prompt →
  DeepSeek (`pro`) → **human-approved** diff.
- Accepting bumps `scoring_prompts.updated_at` → existing auto re-score kicks in
  (no new code needed).

### 6. Activity log (`worker/candidates.ts`)
- Add `logActivity(... 'fit_reason_added')` so it can count toward daily targets
  (optional).

## Suggested build order
**1 → 3 → 2 → 4 → 5.** Ship data + endpoints + sheet first (usable without AI —
tags just arrive empty/unselected), then add AI pre-selection, then the
prompt-suggestion loop last. Each stage is independently testable.

Suggested first PR: steps **1 + 3 + 2** (migration + endpoints + sheet, an
AI-free working skeleton); add the AI layer in a follow-up PR.
