import { describe, expect, it } from 'vitest'
import {
  defaultMonthKeys,
  isMonthKey,
  migrateMonthKeys,
  monthEnd,
  monthKey,
  monthLongLabel,
  monthRanges,
  monthShortLabel,
  monthStart,
  monthWindow,
  normalizeMonthKeys,
} from './months'

// Sat 22 Aug 2026 — mid-month, so clamping is observable.
const AUG_22 = new Date(2026, 7, 22)
const NOV_5 = new Date(2026, 10, 5)
const iso = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`

describe('isMonthKey', () => {
  it('accepts a well-formed key', () => {
    expect(isMonthKey('2026-08')).toBe(true)
    expect(isMonthKey('2026-12')).toBe(true)
  })

  it('rejects impossible months and loose formats', () => {
    for (const bad of ['2026-13', '2026-00', '2026-1', '26-01', '2026/08', '3', '', null, 8]) {
      expect(isMonthKey(bad)).toBe(false)
    }
  })
})

describe('monthWindow', () => {
  it('starts at the current month, not the next one', () => {
    expect(monthWindow(AUG_22)[0]).toBe('2026-08')
  })

  it('offers four consecutive months', () => {
    expect(monthWindow(AUG_22)).toEqual(['2026-08', '2026-09', '2026-10', '2026-11'])
  })

  it('rolls over the year boundary', () => {
    expect(monthWindow(NOV_5)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
  })
})

describe('monthStart / monthEnd / monthKey', () => {
  it('round-trips a date through its key', () => {
    expect(monthKey(AUG_22)).toBe('2026-08')
    expect(iso(monthStart('2026-08'))).toBe('2026-8-1')
  })

  it('finds the last day of 30- and 31-day months', () => {
    expect(iso(monthEnd('2026-09'))).toBe('2026-9-30')
    expect(iso(monthEnd('2026-08'))).toBe('2026-8-31')
  })

  it('handles a leap February', () => {
    expect(iso(monthEnd('2028-02'))).toBe('2028-2-29')
    expect(iso(monthEnd('2027-02'))).toBe('2027-2-28')
  })
})

describe('labels', () => {
  it('abbreviates without a year', () => {
    expect(monthShortLabel('2027-01')).toBe('Jan')
  })

  it('adds the year only when it differs from today', () => {
    expect(monthLongLabel('2026-08', AUG_22)).toBe('August')
    expect(monthLongLabel('2027-01', AUG_22)).toBe('January 2027')
  })
})

describe('normalizeMonthKeys', () => {
  const window = monthWindow(AUG_22)

  it('dedupes and sorts', () => {
    expect(normalizeMonthKeys(['2026-09', '2026-08', '2026-09'], window)).toEqual([
      '2026-08',
      '2026-09',
    ])
  })

  it('drops keys outside the window and malformed entries', () => {
    expect(normalizeMonthKeys(['2026-08', '2027-05', 'nope', 3], window)).toEqual(['2026-08'])
  })

  it('treats a non-array as empty', () => {
    expect(normalizeMonthKeys(null, window)).toEqual([])
  })
})

describe('monthRanges', () => {
  it('clamps the current month to today rather than reaching into the past', () => {
    const [[start, end]] = monthRanges(AUG_22, ['2026-08'])
    expect(iso(start)).toBe('2026-8-22')
    expect(iso(end)).toBe('2026-8-31')
  })

  it('merges contiguous months into a single span', () => {
    const ranges = monthRanges(AUG_22, ['2026-08', '2026-09'])
    expect(ranges).toHaveLength(1)
    expect(iso(ranges[0][0])).toBe('2026-8-22')
    expect(iso(ranges[0][1])).toBe('2026-9-30')
  })

  it('keeps a gap unmerged so the skipped months are never fetched', () => {
    const ranges = monthRanges(AUG_22, ['2026-08', '2026-11'])
    expect(ranges).toHaveLength(2)
    expect(iso(ranges[1][0])).toBe('2026-11-1')
    expect(iso(ranges[1][1])).toBe('2026-11-30')
    // Nothing in the September/October gap.
    expect(ranges.some(([s, e]) => s.getMonth() === 8 || e.getMonth() === 9)).toBe(false)
  })

  it('drops a month that has already ended', () => {
    expect(monthRanges(AUG_22, ['2026-07'])).toEqual([])
    expect(monthRanges(AUG_22, ['2026-07', '2026-09'])).toHaveLength(1)
  })

  it('returns nothing for an empty or unusable selection', () => {
    expect(monthRanges(AUG_22, [])).toEqual([])
    expect(monthRanges(AUG_22, ['garbage'])).toEqual([])
  })

  it('merges three consecutive months into one span', () => {
    expect(monthRanges(AUG_22, ['2026-09', '2026-10', '2026-11'])).toHaveLength(1)
  })
})

describe('migrateMonthKeys', () => {
  it('prefers a valid stored selection', () => {
    expect(migrateMonthKeys('["2026-09","2026-08"]', '3', AUG_22)).toEqual([
      '2026-08',
      '2026-09',
    ])
  })

  it('respects a stored empty selection instead of substituting a default', () => {
    expect(migrateMonthKeys('[]', '3', AUG_22)).toEqual([])
  })

  it('drops a stored month that has fallen out of the window', () => {
    expect(migrateMonthKeys('["2026-05","2026-09"]', null, AUG_22)).toEqual(['2026-09'])
  })

  it('converts a legacy horizon count to that many months', () => {
    expect(migrateMonthKeys(null, '3', AUG_22)).toEqual(['2026-08', '2026-09', '2026-10'])
    expect(migrateMonthKeys(null, '1', AUG_22)).toEqual(['2026-08'])
  })

  it('caps a legacy horizon at the window width', () => {
    expect(migrateMonthKeys(null, '6', AUG_22)).toHaveLength(4)
  })

  it('falls back to the default for a fresh install or unusable input', () => {
    const fallback = defaultMonthKeys(AUG_22)
    expect(fallback).toEqual(['2026-08', '2026-09'])
    expect(migrateMonthKeys(null, null, AUG_22)).toEqual(fallback)
    expect(migrateMonthKeys('not json', null, AUG_22)).toEqual(fallback)
    expect(migrateMonthKeys(null, '99', AUG_22)).toEqual(fallback)
    expect(migrateMonthKeys(null, 'abc', AUG_22)).toEqual(fallback)
  })
})

describe('monthRanges with a tail', () => {
  it('extends a month past its end so a stay arriving on the last day is verifiable', () => {
    const [[, end]] = monthRanges(AUG_22, ['2026-09'], 2)
    expect(iso(end)).toBe('2026-10-2')
  })

  it('leaves the span untouched at the default', () => {
    const [[, end]] = monthRanges(AUG_22, ['2026-09'])
    expect(iso(end)).toBe('2026-9-30')
  })

  it('still merges adjacent months, padding only the last one', () => {
    const ranges = monthRanges(AUG_22, ['2026-08', '2026-09'], 2)
    expect(ranges).toHaveLength(1)
    expect(iso(ranges[0][0])).toBe('2026-8-22')
    expect(iso(ranges[0][1])).toBe('2026-10-2')
  })

  it('does not let a pad bridge a gap between non-adjacent months', () => {
    // The shortest gap between two unselected months is 28 days; the longest pad is 2.
    expect(monthRanges(AUG_22, ['2026-08', '2026-11'], 2)).toHaveLength(2)
  })

  it('still drops a month that has already ended, pad notwithstanding', () => {
    // Without testing against the unpadded end, July + a 2-day pad would survive into
    // August as a stub span and be fetched for no arrival dates at all.
    expect(monthRanges(new Date(2026, 7, 1), ['2026-07'], 2)).toEqual([])
  })

  it('pads the current month too, when it is the only one selected', () => {
    const [[start, end]] = monthRanges(AUG_22, ['2026-08'], 1)
    expect(iso(start)).toBe('2026-8-22')
    expect(iso(end)).toBe('2026-9-1')
  })
})
