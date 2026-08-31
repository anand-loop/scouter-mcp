// Turning either way of asking "when" into the one shape the scan pipeline consumes.
//
// The app asks with weekday arrivals and calendar months, because those are the controls it
// draws. An agent more often carries an open-ended question — "the next Saturday I can get
// into Big Sur" — which names a weekday and nothing else. Both forms normalize to a
// WatchSettings here, so everything downstream sees exactly what the web app's scan sees.
import { today as todayFn } from './core/domain/dates'
import type { IsoDate } from './core/domain/dates'
import { isoDate } from './core/domain/dates'
import {
  isMonthKey,
  monthEnd,
  monthKey,
  MONTH_WINDOW,
  monthStart,
  monthWindow,
  type MonthKey,
} from './core/domain/months'
import { isNightCount, normalizeDays } from './core/domain/stay'
import type { StayResult, WatchSettings } from './core/domain/types'
import { ALL_DAYS } from './core/domain/days'

/** Either way of asking. Everything in the range form has a defensible default. */
export interface WhenArg {
  from?: string
  to?: string
  months?: string[]
  arrivalDays?: number[]
  nights?: number
}

export interface NormalizedWhen {
  /** What runScan and availabilityFor consume. */
  settings: WatchSettings
  /** The requested window, always resolved — the range form's post-filter reads it. */
  from: IsoDate
  to: IsoDate
  /** True when the caller named months rather than a range; the filter is then a no-op. */
  byMonth: boolean
}

export class WhenError extends Error {}

const ISO = /^\d{4}-\d{2}-\d{2}$/

function parseIso(raw: string, field: string): Date {
  if (!ISO.test(raw)) throw new WhenError(`${field} must be a date like 2026-09-04, got "${raw}"`)
  const [y, m, d] = raw.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    throw new WhenError(`${field} is not a real date: "${raw}"`)
  }
  return date
}

/**
 * The arrival days, defaulting to every day.
 *
 * An empty selection is a legitimate state in the app — the UI prompts about it — but as a
 * tool argument it can only be a mistake, since it describes a search that checks nothing.
 */
function daysOf(when: WhenArg): number[] {
  if (when.arrivalDays === undefined) return [...ALL_DAYS]
  const days = normalizeDays(when.arrivalDays)
  if (days.length === 0) {
    throw new WhenError(
      'arrivalDays must hold weekday numbers, Monday=1 through Sunday=7. Omit it to allow any day.',
    )
  }
  return days
}

function nightsOf(when: WhenArg): number {
  // Deliberately 1, not the app's DEFAULT_STAY.nights of 2. A longer stay is a strictly
  // narrower search — it needs one site free on every night — so an unstated stay length
  // should give the broadest true answer rather than a silently stricter one.
  if (when.nights === undefined) return 1
  if (!isNightCount(when.nights)) {
    throw new WhenError(`nights must be 1, 2 or 3, got ${JSON.stringify(when.nights)}`)
  }
  return when.nights
}

/** Every "YYYY-MM" from `start`'s month through `end`'s, inclusive. */
function monthsBetween(start: Date, end: Date): MonthKey[] {
  const keys: MonthKey[] = []
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  const last = new Date(end.getFullYear(), end.getMonth(), 1)
  while (cursor <= last) {
    keys.push(monthKey(cursor))
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return keys
}

/**
 * Resolves a `when` argument.
 *
 * The range form is widened to whole months, because that is the only unit `targetDates`
 * and the grid fetch understand — and widening is free on the wire: `availabilityFor`
 * derives its fetch windows from the months, so asking for September 3rd–20th and asking
 * for September pull exactly the same bytes. The extra dates are trimmed back off the
 * results by `withinRange` before anything is grouped or reported.
 */
export function normalizeWhen(when: WhenArg = {}, today: Date = todayFn()): NormalizedWhen {
  const arrivalDays = daysOf(when)
  const nights = nightsOf(when)

  if (when.months !== undefined) {
    if (when.from !== undefined || when.to !== undefined) {
      throw new WhenError('Give either months, or from/to — not both. They describe two different searches.')
    }
    const bad = when.months.filter((k) => !isMonthKey(k))
    if (bad.length > 0) {
      throw new WhenError(`months must be calendar months like 2026-09; bad: ${bad.join(', ')}`)
    }
    if (when.months.length === 0) throw new WhenError('months must name at least one month.')
    const monthKeys = [...new Set(when.months)].sort()
    return {
      settings: { monthKeys, arrivalDays, nights },
      // The window is the months themselves, so the filter has nothing left to remove.
      from: isoDate(monthStart(monthKeys[0])),
      to: isoDate(monthEnd(monthKeys[monthKeys.length - 1])),
      byMonth: true,
    }
  }

  // `from` defaults to today rather than the start of the month: a search for "the next
  // available" must not offer dates that have already passed.
  const from = when.from === undefined ? today : parseIso(when.from, 'from')
  // `to` defaults to the end of the same four-month window the app's month pills offer,
  // which is also about as far as ReserveCalifornia's booking horizon reaches. A wider
  // default would spend requests on months the API has nothing to say about.
  const horizon = monthWindow(today, MONTH_WINDOW)
  // monthEnd, not `new Date("2026-11-30")` — an ISO date string parses as UTC midnight,
  // which is the previous day everywhere west of Greenwich, so the horizon would quietly
  // lose its last day.
  const to = when.to === undefined ? monthEnd(horizon[horizon.length - 1]) : parseIso(when.to, 'to')

  if (to < from) throw new WhenError(`to (${isoDate(to)}) falls before from (${isoDate(from)}).`)

  return {
    settings: { monthKeys: monthsBetween(from, to), arrivalDays, nights },
    from: isoDate(from),
    to: isoDate(to),
    byMonth: false,
  }
}

/**
 * Trims a campground's results to the requested window.
 *
 * This is the other half of widening a range to whole months: without it, a search for
 * September 3rd–20th would report openings on the 27th, which the caller never asked about
 * and cannot tell apart from one it did.
 */
export function withinRange(results: StayResult[], w: NormalizedWhen): StayResult[] {
  if (w.byMonth) return results
  return results.filter((r) => r.date >= w.from && r.date <= w.to)
}
