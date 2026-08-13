// Annual leave entitlement, derived from an employee's employment start date.
//
// Nothing is stored: the entitlement is recomputed from the start date every
// time it is displayed, so editing the start date immediately re-calculates
// that employee's balance.
//
// Leave is earned on work anniversaries, never part-way through a year of
// service. An employee earns nothing in their first year; on each anniversary
// of the start date they earn that whole year's days at once. Someone who
// joined on 2025-05-01 earns 14 days on 2026-05-01 and the next 14 on
// 2027-05-01 — the service year in progress counts for nothing until it is
// completed.
//
// How many days an anniversary grants comes from the seniority tiers below,
// keyed on the years of service that anniversary completes. An employee row may
// carry an explicit annual_quota; that overrides the tier. With no start date
// recorded we keep the previous behaviour: the quota, else the default.

import { DEFAULT_ANNUAL_QUOTA_DAYS } from './leave-types'

export { DEFAULT_ANNUAL_QUOTA_DAYS }

// Working days granted by one anniversary, by the years of service it completes.
// Ordered longest-tenure first; the first tier whose threshold is met wins. The
// values mirror the statutory minimums (14 days from year 1, 20 from year 5, 26
// from year 15) — raise them here if the company grants more.
export const SENIORITY_TIERS: { afterYears: number; days: number }[] = [
  { afterYears: 15, days: 26 },
  { afterYears: 5, days: 20 },
  { afterYears: 0, days: DEFAULT_ANNUAL_QUOTA_DAYS },
]

export type EntitlementSource = {
  start_date?: string | null
  annual_quota?: number | null
}

export type Entitlement = {
  days: number // days earned in that calendar year — 0 until the anniversary lands
  base: number // what that year's anniversary grants
  yearsOfService: number // years of service that anniversary completes
  earnedOn: string | null // the anniversary, YYYY-MM-DD; in the hire year it falls next year
  earned: boolean // false while that anniversary is still ahead of us
  employed: boolean // false when the employee had not joined yet that year
  known: boolean // false when no start date is recorded (fallback figure)
}

// A full year's entitlement for an anniversary completing `years` of service.
export function tierDays(years: number): number {
  for (const tier of SENIORITY_TIERS) if (years >= tier.afterYears) return tier.days
  return DEFAULT_ANNUAL_QUOTA_DAYS
}

// Round to the nearest half day — leave is booked in half days everywhere else.
function roundHalf(n: number): number {
  return Math.round(n * 2) / 2
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}

type Day = { y: number; m: number; d: number }

// Parse a YYYY-MM-DD date into its parts, or null if it isn't one.
function parseDay(raw: string | null | undefined): Day | null {
  const m = (raw ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// The start date moved to `year`, as YYYY-MM-DD. A 29 February hire lands on
// 28 February in a common year rather than sliding into March. Dates in this
// format compare correctly as plain strings, which is how they are compared.
function anniversaryIn(start: Day, year: number): string {
  return `${year}-${pad(start.m)}-${pad(Math.min(start.d, daysInMonth(year, start.m)))}`
}

// The quota on the row, when it is a usable override.
function quotaOf(emp: EntitlementSource): number | null {
  return typeof emp.annual_quota === 'number' && emp.annual_quota > 0 ? emp.annual_quota : null
}

// What an employee earned during one calendar year, as of the day `asOf`
// (YYYY-MM-DD). That is the anniversary falling in that year, and nothing else:
// no anniversary, no days.
export function entitlementFor(emp: EntitlementSource, year: number, asOf: string): Entitlement {
  const start = parseDay(emp.start_date)
  const quota = quotaOf(emp)

  // No start date on file: the old flat figure, and say so via `known: false`.
  if (!start) {
    const base = quota ?? DEFAULT_ANNUAL_QUOTA_DAYS
    return {
      days: base,
      base,
      yearsOfService: 0,
      earnedOn: null,
      earned: true,
      employed: true,
      known: false,
    }
  }

  // Hired after that year ended — nothing accrued.
  if (start.y > year) {
    return {
      days: 0,
      base: 0,
      yearsOfService: 0,
      earnedOn: null,
      earned: false,
      employed: false,
      known: true,
    }
  }

  // The anniversary this calendar year turns on. In the hire year the first year
  // of service is still being worked, so the anniversary that would pay it out
  // falls in the following year — reported, so the UI can say when it lands.
  const yearsOfService = Math.max(1, year - start.y)
  const earnedOn = anniversaryIn(start, start.y + yearsOfService)
  const base = quota ?? tierDays(yearsOfService)
  const earned = year > start.y && earnedOn <= asOf
  return {
    days: earned ? base : 0,
    base,
    yearsOfService,
    earnedOn,
    earned,
    employed: true,
    known: true,
  }
}

// Everything an employee has earned since they joined, up to the day `asOf`.
// Unused leave carries over rather than expiring at year end, so the all-time
// balance is the sum of every anniversary reached so far less everything taken.
//
// Without a start date there are no anniversaries to count; that case falls back
// to a single year's entitlement and says so via `known: false`.
export type AccruedEntitlement = {
  days: number // total earned so far
  grants: number // anniversaries reached (0 before the first one)
  firstEarnedOn: string | null // the first anniversary, once it has been reached
  lastEarnedOn: string | null // the most recent anniversary
  nextEarnOn: string | null // the anniversary still to come
  nextDays: number // what that one will grant
  known: boolean
}

export function accruedEntitlement(emp: EntitlementSource, asOf: string): AccruedEntitlement {
  const start = parseDay(emp.start_date)
  const quota = quotaOf(emp)

  if (!start || !parseDay(asOf)) {
    const base = quota ?? DEFAULT_ANNUAL_QUOTA_DAYS
    return {
      days: base,
      grants: 0,
      firstEarnedOn: null,
      lastEarnedOn: null,
      nextEarnOn: null,
      nextDays: base,
      known: false,
    }
  }

  // Walk the anniversaries in order until one lands in the future; that one is
  // what the employee is working towards now.
  let days = 0
  let grants = 0
  let lastEarnedOn: string | null = null
  let nextEarnOn = anniversaryIn(start, start.y + 1)
  let nextDays = quota ?? tierDays(1)
  while (nextEarnOn <= asOf) {
    days += nextDays
    grants++
    lastEarnedOn = nextEarnOn
    nextEarnOn = anniversaryIn(start, start.y + grants + 1)
    nextDays = quota ?? tierDays(grants + 1)
  }

  return {
    days: roundHalf(days),
    grants,
    firstEarnedOn: grants > 0 ? anniversaryIn(start, start.y + 1) : null,
    lastEarnedOn,
    nextEarnOn,
    nextDays,
    known: true,
  }
}

// Completed years of service as of `asOf` (a YYYY-MM-DD day), or null when the
// start date is missing or unparseable.
export function yearsOfServiceAt(startDate: string | null | undefined, asOf: string): number | null {
  const start = parseDay(startDate)
  const now = parseDay(asOf)
  if (!start || !now) return null
  let years = now.y - start.y
  if (now.m < start.m || (now.m === start.m && now.d < start.d)) years--
  return Math.max(0, years)
}
