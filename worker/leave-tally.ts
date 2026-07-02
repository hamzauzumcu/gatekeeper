// Tally webhook for the leave-request form — a SEPARATE endpoint from the job
// application webhook (worker/tally-webhook.ts), which imports applicants. Point
// the Tally leave form's webhook at /api/webhook/tally/leave.
//
// The leave form's exact field labels aren't fully known ahead of time, so the
// mapper is tolerant: it matches known fields by label, and treats the DATE
// fields positionally (first = start, second = end). Anything unmatched is
// ignored. Fields are stored raw by insertLeaveRequest (see worker/leave.ts).

import {
  extractValue,
  verifyTallySignature,
  type TallyField,
  type TallyWebhookPayload,
} from './tally-webhook'
import { insertLeaveRequest, type LeaveImportRow } from './leave'

// Label → target field. Order matters: first match wins.
const FIELD_RULES: [RegExp, keyof LeaveImportRow][] = [
  [/full ?name|^name$|ad soyad|isim/i, 'name'],
  [/leave detail|leave type|izin (tür|tip)/i, 'leaveType'],
  [/hour/i, 'hoursRequested'],
  [/working day|total.*day|gün/i, 'workingDays'],
  [/reason|sebep|açıklama/i, 'reason'],
  [/document|belge|attachment|proof/i, 'documentUrl'],
]

function matchTarget(label: string | null): keyof LeaveImportRow | null {
  if (!label) return null
  for (const [re, target] of FIELD_RULES) if (re.test(label)) return target
  return null
}

// Map a Tally submission to a LeaveImportRow. DATE fields fill start/end by
// order; the rest match by label.
export function tallyToLeaveRow(payload: TallyWebhookPayload): LeaveImportRow {
  const { data } = payload
  const row: LeaveImportRow = {
    submissionId: data.submissionId,
    respondentId: data.respondentId,
    submittedAt: data.createdAt ?? null,
    name: '',
  }

  const dateValues: string[] = []
  for (const field of data.fields as TallyField[]) {
    const val = extractValue(field)
    if (val === null) continue
    if (field.type === 'DATE') {
      dateValues.push(val)
      continue
    }
    const target = matchTarget(field.label)
    if (target && target !== 'submissionId' && target !== 'respondentId') {
      // All LeaveImportRow targets here are string-valued.
      ;(row as Record<string, string | null | undefined>)[target] = val
    }
  }

  if (dateValues.length >= 1) row.startDate = dateValues[0]
  if (dateValues.length >= 2) row.endDate = dateValues[1]

  return row
}

// Handler called from index.ts for POST /api/webhook/tally/leave.
export async function handleLeaveTallyWebhook(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string | undefined,
  db: D1Database,
): Promise<{ status: number; body: object }> {
  if (webhookSecret) {
    if (!signatureHeader) return { status: 401, body: { ok: false, error: 'missing signature' } }
    const valid = await verifyTallySignature(webhookSecret, rawBody, signatureHeader)
    if (!valid) return { status: 401, body: { ok: false, error: 'invalid signature' } }
  }

  let payload: TallyWebhookPayload
  try {
    payload = JSON.parse(rawBody) as TallyWebhookPayload
  } catch {
    return { status: 400, body: { ok: false, error: 'invalid JSON' } }
  }

  if (payload.eventType !== 'FORM_RESPONSE') {
    return { status: 200, body: { ok: true, skipped: true, eventType: payload.eventType } }
  }
  if (!payload.data?.submissionId) {
    return { status: 400, body: { ok: false, error: 'submissionId required' } }
  }

  const row = tallyToLeaveRow(payload)
  if (!row.name) return { status: 400, body: { ok: false, error: 'could not find a name field' } }

  const res = await insertLeaveRequest(db, row)
  if (!res.ok) return { status: 400, body: { ok: false, error: res.error } }
  return { status: 200, body: { ok: true, created: res.created } }
}
