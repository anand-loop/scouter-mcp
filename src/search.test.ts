import { describe, expect, it } from 'vitest'
import { DEFAULT_SITE_TYPES } from './core/domain/siteTypes'
import { normalizeWhen, WhenError, withinRange } from './search'
import type { StayResult } from './core/domain/types'

// A Sunday, deliberately mid-month, so month-boundary behaviour is visible.
const AUG_30 = new Date(2026, 7, 30)
const ALL = [1, 2, 3, 4, 5, 6, 7]

describe('normalizeWhen defaults', () => {
  it('spans today through the four-month horizon at one night, any day', () => {
    const w = normalizeWhen({}, AUG_30)
    expect(w.from).toBe('2026-08-30')
    // The last day of the fourth month — not the 29th, which is what parsing an ISO string
    // as UTC would give west of Greenwich.
    expect(w.to).toBe('2026-11-30')
    expect(w.settings.monthKeys).toEqual(['2026-08', '2026-09', '2026-10', '2026-11'])
    expect(w.settings.arrivalDays).toEqual(ALL)
    expect(w.settings.nights).toBe(1)
    expect(w.byMonth).toBe(false)
  })

  it('starts at today rather than the start of the month', () => {
    // "The next available" must not offer dates that have already passed.
    expect(normalizeWhen({}, AUG_30).from).toBe('2026-08-30')
  })

  it('keeps the full horizon when only arrival days are named', () => {
    const w = normalizeWhen({ arrivalDays: [6] }, AUG_30)
    expect(w.settings.arrivalDays).toEqual([6])
    expect(w.from).toBe('2026-08-30')
    expect(w.to).toBe('2026-11-30')
  })

  // Deliberately 1, not the app's DEFAULT_STAY.nights of 2: an unstated stay length should
  // give the broadest true answer.
  it('defaults to one night, not the app default of two', () => {
    expect(normalizeWhen({}, AUG_30).settings.nights).toBe(1)
  })
})

describe('normalizeWhen with a range', () => {
  it('widens to whole months, which is the only unit the fetch understands', () => {
    const w = normalizeWhen({ from: '2026-09-03', to: '2026-09-20' }, AUG_30)
    expect(w.settings.monthKeys).toEqual(['2026-09'])
    // The range itself survives, so the overscan can be trimmed off the results.
    expect(w.from).toBe('2026-09-03')
    expect(w.to).toBe('2026-09-20')
  })

  it('covers every month a range touches, both ends partial', () => {
    expect(normalizeWhen({ from: '2026-09-28', to: '2026-11-02' }, AUG_30).settings.monthKeys).toEqual([
      '2026-09',
      '2026-10',
      '2026-11',
    ])
  })

  it('narrows a range by arrival day without changing its span', () => {
    const w = normalizeWhen({ from: '2026-09-01', to: '2026-09-30', arrivalDays: [5, 6] }, AUG_30)
    expect(w.settings.arrivalDays).toEqual([5, 6])
    expect(w.settings.monthKeys).toEqual(['2026-09'])
  })

  it('accepts a single-day range', () => {
    const w = normalizeWhen({ from: '2026-09-04', to: '2026-09-04' }, AUG_30)
    expect(w.from).toBe(w.to)
    expect(w.settings.monthKeys).toEqual(['2026-09'])
  })
})

describe('normalizeWhen with months', () => {
  it('passes the selection through untouched and marks itself byMonth', () => {
    const w = normalizeWhen({ months: ['2026-10', '2026-09'], arrivalDays: [5], nights: 2 }, AUG_30)
    expect(w.settings.monthKeys).toEqual(['2026-09', '2026-10'])
    expect(w.byMonth).toBe(true)
    expect(w.from).toBe('2026-09-01')
    expect(w.to).toBe('2026-10-31')
  })

  it('dedupes', () => {
    expect(normalizeWhen({ months: ['2026-09', '2026-09'] }, AUG_30).settings.monthKeys).toEqual(['2026-09'])
  })
})

describe('normalizeWhen rejects', () => {
  const bad = (arg: Parameters<typeof normalizeWhen>[0], match: RegExp) =>
    expect(() => normalizeWhen(arg, AUG_30)).toThrow(match)

  it('months together with a range — they describe two different searches', () => {
    bad({ months: ['2026-09'], from: '2026-09-03' }, /either months, or from\/to/)
  })

  it('a month the type system cannot catch', () => {
    // MonthKey is a bare string alias upstream, so only isMonthKey stops this.
    bad({ months: ['2026-13'] }, /2026-13/)
    bad({ months: ['September'] }, /September/)
  })

  it('an empty month list', () => {
    bad({ months: [] }, /at least one month/)
  })

  it('a malformed or impossible date', () => {
    bad({ from: '09-04-2026' }, /must be a date/)
    bad({ from: '2026-02-30' }, /not a real date/)
  })

  it('a backwards range', () => {
    bad({ from: '2026-10-01', to: '2026-09-01' }, /falls before/)
  })

  it('a stay outside 1-3 nights', () => {
    bad({ nights: 0 }, /1, 2 or 3/)
    bad({ nights: 4 }, /1, 2 or 3/)
  })

  // Empty is a real state in the app, where the UI prompts about it. As an argument it can
  // only be a mistake, since it describes a search that checks nothing.
  it('arrival days that reduce to nothing', () => {
    bad({ arrivalDays: [] }, /Monday=1/)
    bad({ arrivalDays: [0, 9] }, /Monday=1/)
    expect(() => normalizeWhen({ arrivalDays: undefined }, AUG_30)).not.toThrow()
  })

  it('errors as WhenError, so the tool can report them as guidance', () => {
    expect(() => normalizeWhen({ nights: 9 }, AUG_30)).toThrow(WhenError)
  })
})

describe('withinRange', () => {
  const results = (...dates: string[]): StayResult[] =>
    dates.map((date) => ({ date, freeSites: [{ unitId: 1, label: '1' }] }))

  it('trims the whole-month overscan back to what was asked for', () => {
    const w = normalizeWhen({ from: '2026-09-03', to: '2026-09-20' }, AUG_30)
    const kept = withinRange(results('2026-09-01', '2026-09-04', '2026-09-20', '2026-09-27'), w)
    expect(kept.map((r) => r.date)).toEqual(['2026-09-04', '2026-09-20'])
  })

  it('is inclusive at both ends', () => {
    const w = normalizeWhen({ from: '2026-09-04', to: '2026-09-20' }, AUG_30)
    expect(withinRange(results('2026-09-04', '2026-09-20'), w)).toHaveLength(2)
  })

  it('is a no-op when months were named, since the months are the window', () => {
    const w = normalizeWhen({ months: ['2026-09'] }, AUG_30)
    const all = results('2026-09-01', '2026-09-30')
    expect(withinRange(all, w)).toEqual(all)
  })
})

describe('site types', () => {
  // Not a time field, but it is the one part of a WatchSettings that isn't — and settings
  // that came out of here half-formed would fail at the scan rather than at the argument.
  it('defaults to everything you can sleep in', () => {
    expect(normalizeWhen({}, AUG_30).settings.siteTypes).toEqual(DEFAULT_SITE_TYPES)
    expect(normalizeWhen({}, AUG_30).settings.siteTypes).not.toContain(7)
  })

  it('carries the caller’s set through both forms of when', () => {
    expect(normalizeWhen({ months: ['2026-09'] }, AUG_30, [1014]).settings.siteTypes).toEqual([1014])
    expect(normalizeWhen({ from: '2026-09-01' }, AUG_30, [1014]).settings.siteTypes).toEqual([1014])
  })
})
