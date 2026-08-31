import { describe, expect, it } from 'vitest'
import {
  failures,
  groupByCampground,
  groupByNight,
  nightRowFor,
  hasOpenings,
  type NightRow,
  openNightCount,
  rowMeta,
  siteLabel,
} from './nights'
import type { CampgroundAvailability, StayResult, SavedCampground } from './types'

const campground = (id: number, name = `C${id}`, parkName = 'Big Basin'): SavedCampground => ({
  facilityId: id,
  placeId: 100 + id,
  name,
  parkName,
})

const date = (d: string, sites = 1): StayResult => ({
  date: d,
  freeSites: Array.from({ length: sites }, (_, i) => ({ unitId: i, label: String(i + 1) })),
})

const avail = (
  id: number,
  results: StayResult[],
  over: Partial<CampgroundAvailability> = {},
): CampgroundAvailability => ({ campground: campground(id), results, ...over })

describe('groupByNight', () => {
  it('inverts campground-to-dates into date-to-campgrounds', () => {
    const groups = groupByNight([
      avail(1, [date('2026-08-28'), date('2026-08-29')]),
      avail(2, [date('2026-08-29')]),
    ])
    expect(groups.map((g) => g.date)).toEqual(['2026-08-28', '2026-08-29'])
    expect(groups[0].rows.map((r) => r.campground.facilityId)).toEqual([1])
    expect(groups[1].rows.map((r) => r.campground.facilityId)).toEqual([1, 2])
  })

  it('orders groups ascending across campgrounds with disjoint dates', () => {
    const groups = groupByNight([
      avail(1, [date('2026-09-10')]),
      avail(2, [date('2026-08-01')]),
    ])
    expect(groups.map((g) => g.date)).toEqual(['2026-08-01', '2026-09-10'])
  })

  it('drops dates with no free sites', () => {
    const groups = groupByNight([avail(1, [date('2026-08-28', 0), date('2026-08-29', 2)])])
    expect(groups.map((g) => g.date)).toEqual(['2026-08-29'])
  })

  it('drops errored campgrounds entirely, so no group is conjured from a failure', () => {
    const groups = groupByNight([avail(1, [], { error: 'HTTP 500' }), avail(2, [date('2026-08-28')])])
    expect(groups).toHaveLength(1)
    expect(groups[0].rows).toHaveLength(1)
    expect(groups[0].rows[0].campground.facilityId).toBe(2)
  })

  it('skips slots that have not arrived and keeps the slot index on each row', () => {
    // Index 1 is still scanning; the row for index 2 must report 2, not its position in
    // the arrived list — that index is the retry handle and the React key.
    const groups = groupByNight([null, null, avail(3, [date('2026-08-28')])])
    expect(groups[0].rows[0].index).toBe(2)
  })

  it('orders rows within a night by ascending distance', () => {
    const groups = groupByNight([
      avail(1, [date('2026-08-28')], { distanceMiles: 24 }),
      avail(2, [date('2026-08-28')], { distanceMiles: 8 }),
      avail(3, [date('2026-08-28')], { distanceMiles: 13 }),
    ])
    expect(groups[0].rows.map((r) => r.campground.facilityId)).toEqual([2, 3, 1])
  })

  it('preserves input order when no distances exist, so a watchlist keeps its order', () => {
    const groups = groupByNight([
      avail(9, [date('2026-08-28')]),
      avail(4, [date('2026-08-28')]),
      avail(7, [date('2026-08-28')]),
    ])
    expect(groups[0].rows.map((r) => r.campground.facilityId)).toEqual([9, 4, 7])
  })

  it('sorts rows without a distance after those with one', () => {
    const groups = groupByNight([
      avail(1, [date('2026-08-28')]),
      avail(2, [date('2026-08-28')], { distanceMiles: 30 }),
    ])
    expect(groups[0].rows.map((r) => r.campground.facilityId)).toEqual([2, 1])
  })

  it('keeps every group count equal to the campgrounds open that night', () => {
    // One campground spanning many nights is the common case and the one that drifted.
    const slots = [
      avail(1, [date('2026-08-28'), date('2026-08-29'), date('2026-08-30')]),
      avail(2, [date('2026-08-29')]),
      avail(3, [date('2026-08-30', 0)]),
    ]
    const groups = groupByNight(slots)
    for (const g of groups) {
      const expected = slots.filter((s) =>
        s.results.some((r) => r.date === g.date && r.freeSites.length > 0),
      ).length
      expect(g.rows.length).toBe(expected)
    }
    expect(groups.map((g) => g.rows.length)).toEqual([1, 2, 1])
  })

  it('hands through the identical StayResult object, so a row and its sheet agree', () => {
    const d = date('2026-08-28', 3)
    const groups = groupByNight([avail(1, [d])])
    expect(groups[0].rows[0].result).toBe(d)
  })

  it('returns nothing for empty, all-pending, or fully-booked input', () => {
    expect(groupByNight([])).toEqual([])
    expect(groupByNight([null, null])).toEqual([])
    expect(groupByNight([avail(1, [date('2026-08-28', 0)])])).toEqual([])
  })

  it('does not mutate its input', () => {
    const results = Object.freeze([date('2026-08-29'), date('2026-08-28')]) as StayResult[]
    const slots = Object.freeze([Object.freeze(avail(1, results))]) as CampgroundAvailability[]
    expect(() => groupByNight(slots)).not.toThrow()
    expect(results.map((r) => r.date)).toEqual(['2026-08-29', '2026-08-28'])
  })
})

describe('failures', () => {
  it('reports the slot indices of failed lookups only', () => {
    expect(
      failures([avail(1, [date('2026-08-28')]), null, avail(3, [], { error: 'boom' })]),
    ).toEqual([2])
  })

  it('is empty when everything succeeded', () => {
    expect(failures([avail(1, [date('2026-08-28')]), null])).toEqual([])
  })
})

describe('hasOpenings / openNightCount', () => {
  it('ignores dates with no free sites', () => {
    const item = avail(1, [date('2026-08-28', 0), date('2026-08-29', 2)])
    expect(hasOpenings(item)).toBe(true)
    expect(openNightCount(item)).toBe(1)
  })

  it('reports nothing for an empty or errored result', () => {
    expect(hasOpenings(avail(1, []))).toBe(false)
    expect(openNightCount(avail(1, [], { error: 'boom' }))).toBe(0)
    expect(hasOpenings(avail(1, [date('2026-08-28', 0)]))).toBe(false)
  })
})

describe('rowMeta / siteLabel', () => {
  const row = (over: Partial<NightRow> = {}): NightRow => ({
    index: 0,
    campground: campground(1),
    result: date('2026-08-28', 4),
    ...over,
  })

  it('is the distance alone — the count has its own place on the row', () => {
    expect(rowMeta(row({ distanceMiles: 12.4 }))).toBe('12 mi')
  })

  it('is empty rather than a blank line when there is no distance', () => {
    expect(rowMeta(row())).toBe('')
  })

  it('is empty when a park heading has already stated the distance', () => {
    expect(rowMeta(row({ distanceMiles: 12.4 }), { distance: false })).toBe('')
  })

  // The park name lives in the heading above, never on the row.
  it('never names the park', () => {
    expect(rowMeta(row({ distanceMiles: 12 }))).not.toContain('Big Basin')
  })

  it('never rounds a nearby campground down to zero miles', () => {
    expect(rowMeta(row({ distanceMiles: 0.3 }))).toBe('1 mi')
  })

  it('counts sites, singular at one', () => {
    expect(siteLabel(row())).toBe('4 sites')
    expect(siteLabel(row({ result: date('2026-08-28', 1) }))).toBe('1 site')
  })
})

describe('groupByCampground', () => {
  it('keys the same results the other way round', () => {
    const groups = groupByCampground([
      avail(1, [date('2026-08-28'), date('2026-08-29')]),
      avail(2, [date('2026-08-29')]),
    ])
    expect(groups.map((g) => g.campground.facilityId)).toEqual([1, 2])
    expect(groups[0].nights.map((n) => n.date)).toEqual(['2026-08-28', '2026-08-29'])
  })

  it('leads with the campground that has the most open nights', () => {
    const groups = groupByCampground([
      avail(1, [date('2026-08-28')], { distanceMiles: 2 }),
      avail(2, [date('2026-08-28'), date('2026-08-29'), date('2026-08-30')], { distanceMiles: 40 }),
    ])
    // Three nights forty miles out beats one night nearby.
    expect(groups.map((g) => g.campground.facilityId)).toEqual([2, 1])
  })

  it('breaks a tie on nights by distance', () => {
    const groups = groupByCampground([
      avail(1, [date('2026-08-28')], { distanceMiles: 30 }),
      avail(2, [date('2026-08-29')], { distanceMiles: 5 }),
    ])
    expect(groups.map((g) => g.campground.facilityId)).toEqual([2, 1])
  })

  it('sorts nights ascending regardless of scan order', () => {
    const groups = groupByCampground([avail(1, [date('2026-09-05'), date('2026-08-28')])])
    expect(groups[0].nights.map((n) => n.date)).toEqual(['2026-08-28', '2026-09-05'])
  })

  it('hands through the identical StayResult, so a pill and its sheet agree', () => {
    const d = date('2026-08-28', 3)
    const groups = groupByCampground([avail(1, [d])])
    expect(groups[0].nights[0]).toBe(d)
    expect(groups[0].nights[0].freeSites).toHaveLength(3)
  })

  it('omits campgrounds with nothing open, and errored or pending ones', () => {
    expect(
      groupByCampground([
        null,
        avail(1, [date('2026-08-28', 0)]),
        avail(2, [], { error: 'boom' }),
      ]),
    ).toEqual([])
  })

  it('carries the slot index for retry and keying', () => {
    const groups = groupByCampground([null, null, avail(3, [date('2026-08-28')])])
    expect(groups[0].index).toBe(2)
  })

  it('accounts for exactly the same nights as the date grouping', () => {
    const slots = [
      avail(1, [date('2026-08-28'), date('2026-08-29'), date('2026-08-30', 0)]),
      avail(2, [date('2026-08-29')]),
    ]
    const byNight = groupByNight(slots).reduce((n, g) => n + g.rows.length, 0)
    const byCampground = groupByCampground(slots).reduce((n, g) => n + g.nights.length, 0)
    expect(byCampground).toBe(byNight)
  })

  it('does not mutate its input', () => {
    const results = Object.freeze([date('2026-09-05'), date('2026-08-28')]) as StayResult[]
    const slots = Object.freeze([Object.freeze(avail(1, results))]) as CampgroundAvailability[]
    expect(() => groupByCampground(slots)).not.toThrow()
    expect(results.map((r) => r.date)).toEqual(['2026-09-05', '2026-08-28'])
  })
})

describe('nightRowFor', () => {
  it('builds the same row shape the date grouping produces', () => {
    const d = date('2026-08-28', 2)
    const [group] = groupByCampground([avail(1, [d], { distanceMiles: 12 })])
    const row = nightRowFor(group, d)
    const [byNight] = groupByNight([avail(1, [d], { distanceMiles: 12 })])
    expect(row).toEqual(byNight.rows[0])
    // Same object, not a copy — the sheet reads the scan's own result.
    expect(row.result).toBe(d)
  })

  it('omits distance when the scan had no centre', () => {
    const d = date('2026-08-28')
    const [group] = groupByCampground([avail(1, [d])])
    expect('distanceMiles' in nightRowFor(group, d)).toBe(false)
  })
})
