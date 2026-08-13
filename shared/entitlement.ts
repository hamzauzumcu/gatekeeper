// Annual leave entitlement, derived from an employee's employment start date.
//
// Nothing is stored: the entitlement for a calendar year is recomputed from the
// start date every time it is displayed, so editing the start date immediately
// re-calculates that employee's balance for every year.
//
// Two rules produce the number:
//
//  1. Seniority tiers — days grow with completed years of service (see
//     SENIORITY_TIERS below).
//  2. Hire year proration — someone who joined in July gets the part of the
//     year they actually worked, not a full year's entitlement.
//
// An employee row may carry an explicit annual_quota; that overrides the tier
// (proration still applies in the hire year). With no start date recorded we
// keep the previous behaviour: the quota, else the default.

import { DEFAULT_ANNUAL_QUOTA_DAYS } from './leave-types'

export { DEFAULT_ANNUAL_QUOTA_DAYS }

// Working days granted for a full year, by completed years of service. Ordered
// longest-tenure first; the first tier whose threshold is met wins. The values
// mirror the statutory minimums (14 days from year 1, 20 from year 5, 26 from
// year 15) — raise them here if the company grants more.
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
  days: number // entitlement for that calendar year, in working days
  base: number // a full year's entitlement at that seniority
  yearsOfService: number // completed years by the end of the year (0 in the hire year)
  prorated: boolean // hire year: only the worked part of the year is granted
  employed: boolean // false when the employee had not joined yet that year
  known: boolean // false when no start date is recorded (fallback figure)
}

// A full year's entitlement after `years` completed years of service.
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

// Parse a YYYY-MM-DD date into its parts, or null if it isn't one.
function parseDay(raw: string | null | undefined): { y: number; m: number; d: number } | null {
  const m = (raw ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
}

// Day-of-year (1 = 1 January) for a parsed date.
function dayOfYear(day: { y: number; m: number; d: number }): number {
  const start = Date.UTC(day.y, 0, 1)
  const at = Date.UTC(day.y, day.m - 1, day.d)
  return Math.round((at - start) / 86400000) + 1
}

// The entitlement an employee has for one calendar year.
export function entitlementFor(emp: EntitlementSource, year: number): Entitlement {
  const start = parseDay(emp.start_date)
  const quota = typeof emp.annual_quota === 'number' && emp.annual_quota > 0 ? emp.annual_quota : null

  // No start date on file: the old flat figure, and say so via `known: false`.
  if (!start) {
    const base = quota ?? DEFAULT_ANNUAL_QUOTA_DAYS
    return { days: base, base, yearsOfService: 0, prorated: false, employed: true, known: false }
  }

  // Hired after that year ended — nothing accrued.
  if (start.y > year) {
    return { days: 0, base: 0, yearsOfService: 0, prorated: false, employed: false, known: true }
  }

  const yearsOfService = year - start.y
  const base = quota ?? tierDays(yearsOfService)
  if (yearsOfService > 0) {
    return { days: base, base, yearsOfService, prorated: false, employed: true, known: true }
  }

  // Hire year: grant the share of the year actually worked, start day included.
  const total = isLeapYear(year) ? 366 : 365
  const worked = total - dayOfYear(start) + 1
  return {
    days: Math.max(0, roundHalf((base * worked) / total)),
    base,
    yearsOfService: 0,
    prorated: true,
    employed: true,
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
