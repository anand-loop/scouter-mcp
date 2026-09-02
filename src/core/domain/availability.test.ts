// Ported from com.scouter.domain.AvailabilityUseCaseTest.
import { describe, expect, it } from 'vitest'
import type { GridResponse, GridUnit } from '../api/rcApi'
import {
  freeSitesByDate,
  sitesFreeForSpan,
  targetDates,
  WINDOW_DAYS,
  windows,
} from './availability'
import { monthRanges } from './months'

const FRIDAY = [5] // java DayOfWeek

describe('targetDates', () => {
  it('returns only the chosen arrival weekday within the chosen month', () => {
    const today = new Date(2026, 6, 1) // Wednesday, Jul 1 2026 (month is 0-based)
    const dates = targetDates(today, ['2026-07'], FRIDAY)

    expect(dates.length).toBeGreaterThan(0)
    for (const d of dates) {
      const dow = new Date(`${d}T00:00:00`).getDay() // 0=Sun … 6=Sat
      expect(dow === 0 ? 7 : dow).toBe(5)
    }
    // First Friday after Wed Jul 1 2026 is Jul 3.
    expect(dates[0]).toBe('2026-07-03')
    // Jul 31 is a Friday, and it stays an arrival even though a longer stay runs into
    // August — suppressing it would make the last dates of a month come and go with the
    // night count.
    expect(dates[dates.length - 1]).toBe('2026-07-31')
  })

  it('is empty with no usable arrival day', () => {
    expect(targetDates(new Date(2026, 6, 1), ['2026-07'], [])).toEqual([])
    expect(targetDates(new Date(2026, 6, 1), ['2026-07'], [0, 8])).toEqual([])
  })

  it('merges several arrival days into one ascending list', () => {
    const dates = targetDates(new Date(2026, 6, 1), ['2026-07'], [5, 6])
    expect([...dates].sort()).toEqual(dates)
    expect(new Set(dates).size).toBe(dates.length)
    for (const d of dates) {
      const dow = new Date(`${d}T00:00:00`).getDay()
      expect([5, 6]).toContain(dow === 0 ? 7 : dow)
    }
    // Fri Jul 3 and Sat Jul 4 both qualify.
    expect(dates.slice(0, 2)).toEqual(['2026-07-03', '2026-07-04'])
  })

  it('is empty when no months are selected', () => {
    expect(targetDates(new Date(2026, 6, 1), [], FRIDAY)).toEqual([])
  })

  it('never reaches back before today within the current month', () => {
    const dates = targetDates(new Date(2026, 6, 20), ['2026-07'], FRIDAY)
    expect(dates[0]).toBe('2026-07-24')
  })

  it('skips the months between two disjoint selections', () => {
    const dates = targetDates(new Date(2026, 6, 1), ['2026-07', '2026-09'], FRIDAY)
    expect(dates.some((d) => d.startsWith('2026-08'))).toBe(false)
    expect(dates.some((d) => d.startsWith('2026-09'))).toBe(true)
    // Ascending, no duplicates.
    expect([...dates].sort()).toEqual(dates)
    expect(new Set(dates).size).toBe(dates.length)
  })
})

describe('the fetch plan', () => {
  it('fetches only the selected month, not everything up to it', () => {
    const today = new Date(2026, 6, 1)
    const wins = monthRanges(today, ['2026-11']).flatMap(([s, e]) => windows(s, e, 30))
    expect(wins.length).toBeGreaterThan(0)
    for (const [start, end] of wins) {
      expect(start.getMonth()).toBe(10) // November
      expect(end.getMonth()).toBe(10)
    }
  })
})

const unit = (
  unitId: number,
  label: string,
  categoryId: number,
  dates: string[],
): GridUnit => ({
  UnitId: unitId,
  Name: '',
  ShortName: label,
  IsAda: false,
  AllowWebBooking: true,
  UnitCategoryId: categoryId,
  Slices: Object.fromEntries(
    dates.map((d) => [`${d}T00:00:00`, { Date: d, IsFree: true, IsBlocked: false }]),
  ),
})

const grid = (units: GridUnit[]): GridResponse => ({
  Facility: {
    FacilityId: 1,
    Name: '',
    Units: Object.fromEntries(units.map((u) => [String(u.UnitId), u])),
  },
})

/** One standard site and one group site, both free on the same night. */
const gridWithCategories = () =>
  grid([unit(1, '53', 1, ['2026-07-03']), unit(2, '54', 2, ['2026-07-03'])])

/** Only the group site is free on both nights, so only it can carry a two-night stay. */
const twoNightGrid = () =>
  grid([unit(1, '53', 1, ['2026-07-03']), unit(2, '54', 2, ['2026-07-03', '2026-07-04'])])

describe('freeSitesByDate', () => {
  it('lists bookable free sites per date and ignores non-bookable', () => {
    const response: GridResponse = {
      Facility: {
        FacilityId: 1,
        Name: '',
        Units: {
          '1': {
            UnitId: 1,
            Name: '',
            ShortName: '53',
            IsAda: false,
            AllowWebBooking: true,
            UnitCategoryId: 1,
            Slices: {
              // Two free slices for the SAME date — must be counted once.
              '2026-07-03T00:00:00': { Date: '2026-07-03', IsFree: true, IsBlocked: false },
              '2026-07-03T12:00:00': { Date: '2026-07-03', IsFree: true, IsBlocked: false },
              '2026-07-04T00:00:00': { Date: '2026-07-04', IsFree: false, IsBlocked: false },
            },
          },
          '2': {
            UnitId: 2,
            Name: '',
            ShortName: '54',
            IsAda: false,
            AllowWebBooking: true,
            UnitCategoryId: 2,
            Slices: {
              '2026-07-03T00:00:00': { Date: '2026-07-03', IsFree: true, IsBlocked: false },
            },
          },
          // Not web-bookable — must be excluded even though it's free.
          '3': {
            UnitId: 3,
            Name: '',
            ShortName: '55',
            IsAda: false,
            AllowWebBooking: false,
            UnitCategoryId: 1,
            Slices: {
              '2026-07-03T00:00:00': { Date: '2026-07-03', IsFree: true, IsBlocked: false },
            },
          },
        },
      },
    }

    const byDate = freeSitesByDate(response)
    const jul3 = byDate.get('2026-07-03') ?? []
    expect(jul3.length).toBe(2)
    expect(new Set(jul3.map((s) => s.label))).toEqual(new Set(['53', '54']))
    expect(byDate.has('2026-07-04')).toBe(false)
  })

  it('drops units whose category the search excludes', () => {
    // Unit 1 is a standard campsite, unit 2 a group site; only the first is wanted.
    const byDate = freeSitesByDate(gridWithCategories(), new Set([1]))
    expect((byDate.get('2026-07-03') ?? []).map((s) => s.label)).toEqual(['53'])
  })

  it('filters nothing when given no set', () => {
    const byDate = freeSitesByDate(gridWithCategories())
    expect((byDate.get('2026-07-03') ?? []).length).toBe(2)
  })

  // The reason the filter lives here and not on the finished results. A stay is one *unit*
  // free on every night, established by intersecting these lists on unitId. Filter the
  // results instead and this two-night stay survives on a unit the user excluded.
  it('cannot let an excluded unit span a stay', () => {
    const unfiltered = freeSitesByDate(twoNightGrid())
    expect(sitesFreeForSpan(unfiltered, '2026-07-03', 2).map((s) => s.label)).toEqual(['54'])

    const filtered = freeSitesByDate(twoNightGrid(), new Set([1]))
    expect(sitesFreeForSpan(filtered, '2026-07-03', 2)).toEqual([])
  })
})

describe('sitesFreeForSpan', () => {
  const site = (unitId: number, label = String(unitId)) => ({ unitId, label })
  const map = (entries: Array<[string, Array<{ unitId: number; label: string }>]>) =>
    new Map(entries)

  it('reproduces the single-night behaviour at one night', () => {
    const free = map([['2026-08-28', [site(1), site(2)]]])
    expect(sitesFreeForSpan(free, '2026-08-28', 1).map((s) => s.unitId)).toEqual([1, 2])
  })

  it('collapses a unit the grid listed twice for one date', () => {
    const free = map([['2026-08-28', [site(1), site(1)]]])
    expect(sitesFreeForSpan(free, '2026-08-28', 1)).toHaveLength(1)
  })

  it('keeps only the site free on every night of the stay', () => {
    // 1 is free both nights; 2 only Friday; 3 only Saturday.
    const free = map([
      ['2026-08-28', [site(1), site(2)]],
      ['2026-08-29', [site(1), site(3)]],
    ])
    expect(sitesFreeForSpan(free, '2026-08-28', 2).map((s) => s.unitId)).toEqual([1])
  })

  it('reports nothing when no single site spans the stay', () => {
    const free = map([
      ['2026-08-28', [site(2)]],
      ['2026-08-29', [site(3)]],
    ])
    expect(sitesFreeForSpan(free, '2026-08-28', 2)).toEqual([])
  })

  it('intersects across a tail that came from a different fetch window', () => {
    // freeByDate is merged across grid responses before this runs, so a span straddling
    // two 30-day windows is indistinguishable from one inside a single window.
    const free = map([
      ['2026-08-30', [site(1), site(2)]],
      ['2026-08-31', [site(1), site(2)]],
      ['2026-09-01', [site(1)]],
    ])
    expect(sitesFreeForSpan(free, '2026-08-30', 3).map((s) => s.unitId)).toEqual([1])
  })

  it('treats an absent tail date as unavailable, never as unknown', () => {
    const free = map([['2026-08-28', [site(1)]]])
    expect(sitesFreeForSpan(free, '2026-08-28', 2)).toEqual([])
  })

  it('reports nothing when the arrival night itself is absent', () => {
    expect(sitesFreeForSpan(map([['2026-08-29', [site(1)]]]), '2026-08-28', 2)).toEqual([])
  })

  it('carries the arrival night’s label and unit id', () => {
    const free = map([
      ['2026-08-28', [site(7, 'A-07')]],
      ['2026-08-29', [site(7, 'A-07')]],
    ])
    expect(sitesFreeForSpan(free, '2026-08-28', 2)).toEqual([{ unitId: 7, label: 'A-07' }])
  })

  it('crosses a month boundary without special-casing', () => {
    const free = map([
      ['2026-08-31', [site(1)]],
      ['2026-09-01', [site(1)]],
    ])
    expect(sitesFreeForSpan(free, '2026-08-31', 2)).toHaveLength(1)
  })
})

describe('WINDOW_DAYS', () => {
  // The grid endpoint caps its response at 21 slices per unit when more than 22 days are
  // requested — silently, with EndDate still echoing the request. Because a date the grid
  // never returned counts as *unavailable* (see sitesFreeForSpan), asking for too much
  // reports openings as fully booked rather than failing. These two tests are the guard.
  it('stays inside the endpoint\'s undocumented cap', () => {
    expect(WINDOW_DAYS).toBeLessThanOrEqual(22)
  })

  it('never builds a span the grid would truncate, over a real four-month scan', () => {
    const today = new Date(2026, 7, 30)
    const months = ['2026-08', '2026-09', '2026-10', '2026-11']
    // The tail is what a 3-night stay adds past each month's end — the widest case.
    const spans = monthRanges(today, months, 2).flatMap(([s, e]) => windows(s, e, WINDOW_DAYS))
    expect(spans.length).toBeGreaterThan(0)
    for (const [start, end] of spans) {
      const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
      expect(days).toBeLessThanOrEqual(22)
    }
  })
})
