import { describe, expect, it } from 'vitest'
import { calendarMonth, firstOpenDate, monthsWithOpenings, openDaysIn } from './calendar'
import type { NightGroup, NightRow } from './nights'

const row = (id: number): NightRow => ({
  index: id,
  campground: { facilityId: id, placeId: id, name: `C${id}`, parkName: 'Park' },
  result: { date: '', freeSites: [{ unitId: 1, label: '1' }] },
})

const group = (date: string, count = 1): NightGroup => ({
  date,
  rows: Array.from({ length: count }, (_, i) => row(i + 1)),
})

describe('calendarMonth', () => {
  it('pads the grid so the 1st lands on its weekday, Sunday first', () => {
    // 1 Aug 2026 is a Saturday → six blanks before it.
    const cells = calendarMonth('2026-08', [])
    expect(cells.slice(0, 6).every((c) => c.day === null)).toBe(true)
    expect(cells[6].day).toBe(1)
  })

  it('needs no padding when the 1st is a Sunday', () => {
    // 1 Nov 2026 is a Sunday.
    expect(calendarMonth('2026-11', [])[0].day).toBe(1)
  })

  it('covers every day of the month, including a 31st', () => {
    const aug = calendarMonth('2026-08', []).filter((c) => c.day !== null)
    expect(aug).toHaveLength(31)
    expect(calendarMonth('2026-09', []).filter((c) => c.day !== null)).toHaveLength(30)
    expect(calendarMonth('2028-02', []).filter((c) => c.day !== null)).toHaveLength(29)
  })

  it('attaches each day its arrival rows', () => {
    const cells = calendarMonth('2026-08', [group('2026-08-28', 3)])
    const day28 = cells.find((c) => c.day === 28)!
    expect(day28.date).toBe('2026-08-28')
    expect(day28.rows).toHaveLength(3)
  })

  it('leaves days with nothing open empty rather than absent', () => {
    const cells = calendarMonth('2026-08', [group('2026-08-28')])
    expect(cells.find((c) => c.day === 27)!.rows).toEqual([])
  })

  it('ignores groups from other months', () => {
    const cells = calendarMonth('2026-08', [group('2026-09-04', 2)])
    expect(cells.every((c) => c.rows.length === 0)).toBe(true)
  })

  it('zero-pads the day when matching dates', () => {
    const cells = calendarMonth('2026-08', [group('2026-08-05', 2)])
    expect(cells.find((c) => c.day === 5)!.rows).toHaveLength(2)
  })
})

describe('openDaysIn', () => {
  it('counts only days in the month that have rows', () => {
    const groups = [group('2026-08-07'), group('2026-08-28', 2), group('2026-09-04')]
    expect(openDaysIn('2026-08', groups)).toBe(2)
    expect(openDaysIn('2026-09', groups)).toBe(1)
    expect(openDaysIn('2026-10', groups)).toBe(0)
  })

  it('does not count a group that has no rows', () => {
    expect(openDaysIn('2026-08', [{ date: '2026-08-07', rows: [] }])).toBe(0)
  })
})

describe('monthsWithOpenings', () => {
  const MONTHS = ['2026-08', '2026-09', '2026-10', '2026-11'] as const

  it('drops the months with nothing open', () => {
    const groups = [group('2026-08-28'), group('2026-11-06')]
    expect(monthsWithOpenings([...MONTHS], groups)).toEqual(['2026-08', '2026-11'])
  })

  it('keeps the scanned order rather than the order openings arrived in', () => {
    const groups = [group('2026-11-06'), group('2026-09-04')]
    expect(monthsWithOpenings([...MONTHS], groups)).toEqual(['2026-09', '2026-11'])
  })

  it('does not count a month whose only group is empty', () => {
    expect(monthsWithOpenings([...MONTHS], [group('2026-09-04', 0)])).toEqual([...MONTHS])
  })

  // Before the first result lands, every month is empty. Returning nothing would leave the
  // calendar with no month to name and no way to page.
  it('falls back to every scanned month when nothing is open anywhere', () => {
    expect(monthsWithOpenings([...MONTHS], [])).toEqual([...MONTHS])
  })

  it('keeps the month being read even after its openings vanish', () => {
    const groups = [group('2026-08-28')]
    expect(monthsWithOpenings([...MONTHS], groups, '2026-10')).toEqual(['2026-08', '2026-10'])
  })

  it('ignores a kept month that was never scanned', () => {
    const groups = [group('2026-08-28')]
    expect(monthsWithOpenings([...MONTHS], groups, '2027-03')).toEqual(['2026-08'])
  })

  it('does not duplicate a kept month that is open anyway', () => {
    const groups = [group('2026-08-28')]
    expect(monthsWithOpenings([...MONTHS], groups, '2026-08')).toEqual(['2026-08'])
  })
})

describe('firstOpenDate', () => {
  it('finds the earliest open day regardless of group order', () => {
    expect(firstOpenDate('2026-08', [group('2026-08-28'), group('2026-08-07')])).toBe(
      '2026-08-07',
    )
  })

  it('is null when the month has nothing open', () => {
    expect(firstOpenDate('2026-10', [group('2026-08-07')])).toBeNull()
    expect(firstOpenDate('2026-08', [])).toBeNull()
  })
})
