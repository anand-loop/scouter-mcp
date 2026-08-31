// Specific calendar months, as the redesign models them ("Aug Sep Oct Nov"), replacing the
// rolling 1-6 month horizon the app used to search.
//
// Months are stored as absolute "YYYY-MM" keys rather than offsets from today. An offset
// silently re-points as time passes — November picked in August means March by December —
// whereas an absolute key lets a stale selection be detected and dropped. The scan URL has
// to carry real months anyway, so a shared link means the same thing tomorrow.
import { addDays, addMonths, format, isAfter, startOfDay } from 'date-fns'

/** A calendar month, "YYYY-MM". */
export type MonthKey = string

/** How many month pills the design offers. */
export const MONTH_WINDOW = 4

const KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export function isMonthKey(s: unknown): s is MonthKey {
  return typeof s === 'string' && KEY_PATTERN.test(s)
}

export function monthKey(d: Date): MonthKey {
  return format(d, 'yyyy-MM')
}

/**
 * The months on offer, starting at the *current* month — someone searching on the 22nd for
 * this weekend still needs this month. Because the window slides, every pill is always
 * inside ReserveCalifornia's booking horizon; there are never dead options.
 */
export function monthWindow(today: Date, count = MONTH_WINDOW): MonthKey[] {
  const base = startOfDay(today)
  return Array.from({ length: count }, (_, i) => monthKey(addMonths(base, i)))
}

export function monthStart(k: MonthKey): Date {
  const [y, m] = k.split('-').map(Number)
  return new Date(y, m - 1, 1)
}

export function monthEnd(k: MonthKey): Date {
  const [y, m] = k.split('-').map(Number)
  // Day 0 of the next month is the last day of this one.
  return new Date(y, m, 0)
}

/** "Aug" — never carries a year; see `monthLongLabel` for why. */
export function monthShortLabel(k: MonthKey): string {
  return format(monthStart(k), 'MMM')
}

/**
 * "August", or "January 2027" when the month falls in a different year than today. The
 * pills are too narrow for a year, so the derived WHEN sentence is where it disambiguates.
 */
export function monthLongLabel(k: MonthKey, today: Date): string {
  const start = monthStart(k)
  return start.getFullYear() === today.getFullYear()
    ? format(start, 'MMMM')
    : format(start, 'MMMM yyyy')
}

/** Valid keys that are inside `window`, deduped and ascending. Empty is a legitimate result. */
export function normalizeMonthKeys(keys: unknown, window: MonthKey[]): MonthKey[] {
  if (!Array.isArray(keys)) return []
  const allowed = new Set(window)
  const out = new Set<MonthKey>()
  for (const k of keys) if (isMonthKey(k) && allowed.has(k)) out.add(k)
  return [...out].sort()
}

/** Fresh installs start on the two nearest months — enough to be useful, cheap to scan. */
export function defaultMonthKeys(today: Date): MonthKey[] {
  return monthWindow(today).slice(0, 2)
}

/**
 * Inclusive [start, end] spans covering the selected months: clamped so nothing starts
 * before today, fully-past months dropped, and contiguous months merged.
 *
 * The merge is what keeps the fetch tight — August + September become one 61-day span
 * (3 windows, not 4), while August + November stay disjoint and never fetch September or
 * October at all.
 *
 * `tailDays` extends each span past its month's end. A multi-night stay arriving on the
 * 31st needs the nights after it, and an unfetched date reads as *booked* rather than as an
 * error — so without the tail those arrivals would silently never appear. It belongs here
 * rather than in the scan because the cost estimate prices these same ranges.
 */
export function monthRanges(
  today: Date,
  monthKeys: MonthKey[],
  tailDays = 0,
): Array<[Date, Date]> {
  const from = startOfDay(today)
  const spans: Array<[Date, Date]> = []
  for (const k of [...new Set(monthKeys)].filter(isMonthKey).sort()) {
    const start = isAfter(from, monthStart(k)) ? from : monthStart(k)
    const end = monthEnd(k)
    // Tested against the *unpadded* end: otherwise a month that has already finished would
    // survive as a stub span reaching into today, and be fetched for no arrival dates.
    if (isAfter(start, end)) continue
    // Padded before the merge, so the adjacency test below sees the real span ends.
    spans.push([start, addDays(end, tailDays)])
  }
  const merged: Array<[Date, Date]> = []
  for (const [start, end] of spans) {
    const prev = merged[merged.length - 1]
    // Months are calendar-adjacent, so the next span starts the day after the previous ends.
    if (prev && prev[1].getTime() + 86_400_000 >= start.getTime()) {
      if (isAfter(end, prev[1])) prev[1] = end
    } else {
      merged.push([start, end])
    }
  }
  return merged
}

function parseArray(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Resolves the stored month selection, upgrading a pre-redesign horizon count when the new
 * key isn't there yet. Pure — takes raw strings so it's testable without a DOM.
 */
export function migrateMonthKeys(
  storedRaw: string | null,
  legacyRaw: string | null,
  today: Date,
): MonthKey[] {
  const window = monthWindow(today)
  const stored = parseArray(storedRaw)
  // An empty stored array is a real state the design renders ("Pick a month"), not corruption.
  if (Array.isArray(stored)) return normalizeMonthKeys(stored, window)

  if (legacyRaw && /^[1-6]$/.test(legacyRaw.trim())) {
    return window.slice(0, Math.min(Number(legacyRaw), MONTH_WINDOW))
  }
  return defaultMonthKeys(today)
}
