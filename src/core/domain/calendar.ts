// The results calendar: a month grid of arrival dates, built from the same groups the list
// renders. Nothing here fetches or computes availability — it only rearranges what a scan
// already produced into weeks.
import type { IsoDate } from './dates'
import { type MonthKey, monthEnd, monthStart } from './months'
import type { NightGroup, NightRow } from './nights'

export interface CalendarCell {
  /** null for the blanks before the 1st, which pad the grid to the right weekday. */
  day: number | null
  date?: IsoDate
  /** Campgrounds with a stay arriving that day. Empty means nothing open. */
  rows: NightRow[]
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * One month as a 7-column grid, Sunday first.
 *
 * Days outside the scan simply have no rows — the calendar can't tell "we looked and found
 * nothing" from "we never looked", and shouldn't pretend to: both render as closed, which
 * is what the criteria line above is for.
 */
export function calendarMonth(monthKey: MonthKey, groups: NightGroup[]): CalendarCell[] {
  const byDate = new Map(groups.map((g) => [g.date, g.rows]))
  const start = monthStart(monthKey)
  const cells: CalendarCell[] = []
  // getDay() is 0=Sunday, which is the order the design's column heads run in.
  for (let i = 0; i < start.getDay(); i++) cells.push({ day: null, rows: [] })
  for (let day = 1; day <= monthEnd(monthKey).getDate(); day++) {
    const date = `${monthKey}-${pad(day)}`
    cells.push({ day, date, rows: byDate.get(date) ?? [] })
  }
  return cells
}

/** How many days in this month have something open. */
export function openDaysIn(monthKey: MonthKey, groups: NightGroup[]): number {
  return groups.filter((g) => g.date.startsWith(`${monthKey}-`) && g.rows.length > 0).length
}

/**
 * The months worth paging through — those with at least one open arrival date.
 *
 * A four-month scan where only two months have anything shouldn't make you step past two
 * empty grids to find them. Two exceptions keep the pager honest:
 *
 *  - with nothing open anywhere, every scanned month is returned, because a calendar has to
 *    be able to say *which* months it looked at and came up empty;
 *  - `keep` survives even when empty, so the month the reader is standing on can't be pulled
 *    out from under them as a streaming scan or a re-scan changes what's open.
 */
export function monthsWithOpenings(
  monthKeys: MonthKey[],
  groups: NightGroup[],
  keep?: MonthKey | null,
): MonthKey[] {
  const open = monthKeys.filter((k) => openDaysIn(k, groups) > 0)
  if (open.length === 0) return monthKeys
  if (keep && monthKeys.includes(keep) && !open.includes(keep)) {
    return monthKeys.filter((k) => open.includes(k) || k === keep)
  }
  return open
}

/** The month's earliest open day, for landing somewhere useful rather than on the 1st. */
export function firstOpenDate(monthKey: MonthKey, groups: NightGroup[]): IsoDate | null {
  const open = groups
    .filter((g) => g.date.startsWith(`${monthKey}-`) && g.rows.length > 0)
    .map((g) => g.date)
    .sort()
  return open[0] ?? null
}
