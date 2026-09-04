import { describe, expect, it } from 'vitest'
import { byPark, groupByPark } from './parks'
import type { CampgroundAvailability, SavedCampground, StayResult } from './types'

const date = (d: string, sites = 1): StayResult => ({
  date: d,
  freeSites: Array.from({ length: sites }, (_, i) => ({ unitId: i, label: String(i + 1) })),
})

const avail = (
  facilityId: number,
  placeId: number,
  results: StayResult[],
  over: Partial<CampgroundAvailability> = {},
): CampgroundAvailability => ({
  campground: { facilityId, placeId, name: `C${facilityId}`, parkName: `Park ${placeId}` },
  results,
  location: { lat: 37 + placeId / 100, lng: -122 },
  ...over,
})

const camp = (facilityId: number, placeId: number, parkName = `Park ${placeId}`): SavedCampground => ({
  facilityId,
  placeId,
  name: `C${facilityId}`,
  parkName,
})

const item = (facilityId: number, placeId: number, distanceMiles?: number) => ({
  campground: camp(facilityId, placeId),
  ...(distanceMiles === undefined ? {} : { distanceMiles }),
})

describe('byPark', () => {
  it('buckets campgrounds under their park', () => {
    const out = byPark([item(1, 10, 5), item(2, 20, 8), item(3, 10, 12)])
    expect(out).toHaveLength(2)
    expect(out[0].placeId).toBe(10)
    expect(out[0].items.map((i) => i.campground.facilityId)).toEqual([1, 3])
  })

  it('orders parks by their nearest campground, not by first appearance', () => {
    const out = byPark([item(1, 10, 26), item(2, 20, 13), item(3, 10, 24)])
    expect(out.map((p) => p.placeId)).toEqual([20, 10])
    expect(out.map((p) => p.nearestMiles)).toEqual([13, 24])
  })

  // The caller has already sorted — most-dates-first for the campground view, nearest-first
  // for a night's rows. Re-sorting inside a bucket would silently discard that.
  it('preserves input order within a park', () => {
    const out = byPark([item(3, 10, 20), item(1, 10, 12), item(2, 10, 16)])
    expect(out[0].items.map((i) => i.campground.facilityId)).toEqual([3, 1, 2])
  })

  // Two parks sharing a name is the case a name key would silently merge.
  it('keys on placeId, so same-named parks stay apart', () => {
    const out = byPark([
      { campground: camp(1, 10, 'Oak Grove'), distanceMiles: 5 },
      { campground: camp(2, 20, 'Oak Grove'), distanceMiles: 9 },
    ])
    expect(out).toHaveLength(2)
    expect(out.map((p) => p.placeId)).toEqual([10, 20])
  })

  it('leaves nearestMiles undefined when nothing carries a distance', () => {
    const out = byPark([item(1, 10), item(2, 10)])
    expect(out[0].nearestMiles).toBeUndefined()
    expect(out[0].items).toHaveLength(2)
  })

  it('sorts parks with no distance after those with one', () => {
    const out = byPark([item(1, 10), item(2, 20, 30)])
    expect(out.map((p) => p.placeId)).toEqual([20, 10])
  })

  it('returns nothing for empty input', () => {
    expect(byPark([])).toEqual([])
  })
})

describe('groupByPark', () => {
  it('collects a park’s campgrounds under one entry', () => {
    const parks = groupByPark([
      avail(1, 10, [date('2026-08-28')]),
      avail(2, 10, [date('2026-08-29')]),
      avail(3, 20, [date('2026-08-28')]),
    ])
    expect(parks).toHaveLength(2)
    const ten = parks.find((p) => p.placeId === 10)!
    expect(ten.open).toHaveLength(2)
    expect(ten.parkName).toBe('Park 10')
  })

  it('centres the pin between the park’s campgrounds', () => {
    const parks = groupByPark([
      { ...avail(1, 10, [date('2026-08-28')]), location: { lat: 36, lng: -122 } },
      { ...avail(2, 10, [date('2026-08-29')]), location: { lat: 38, lng: -120 } },
    ])
    expect(parks[0].location).toEqual({ lat: 37, lng: -121 })
  })

  it('keeps a park whose campgrounds are all booked, and names them', () => {
    const parks = groupByPark([avail(1, 10, [date('2026-08-28', 0)]), avail(2, 10, [])])
    expect(parks).toHaveLength(1)
    expect(parks[0].open).toEqual([])
    // Named rather than counted: the sheet lists them so they can be favorited for later.
    expect(parks[0].closed.map((c) => c.campground.facilityId)).toEqual([1, 2])
  })

  it('lists only the campgrounds with nothing open as closed', () => {
    const parks = groupByPark([
      avail(1, 10, [date('2026-08-28')]),
      avail(2, 10, [date('2026-08-28', 0)]),
    ])
    expect(parks[0].open).toHaveLength(1)
    expect(parks[0].closed.map((c) => c.campground.facilityId)).toEqual([2])
  })

  it('drops campgrounds with no coordinates, and parks left with none', () => {
    const noLocation = { ...avail(1, 10, [date('2026-08-28')]), location: undefined }
    expect(groupByPark([noLocation])).toEqual([])
  })

  it('ignores pending and errored slots', () => {
    expect(groupByPark([null, { ...avail(1, 10, [], { error: 'boom' }), location: undefined }])).toEqual([])
  })

  // The bug this fixes: filter for cabins and every RV-only campground checked along the
  // way was still pinned, as a dot that could never have had anything to offer.
  it('drops campgrounds with none of the wanted site types', () => {
    const parks = groupByPark(
      [
        avail(1, 10, [date('2026-08-28')], { siteTypes: [1008] }),
        avail(2, 20, [date('2026-08-28', 0)], { siteTypes: [1015] }),
      ],
      [1008],
    )
    expect(parks.map((p) => p.placeId)).toEqual([10])
  })

  it('leaves an excluded campground out of its park’s closed list', () => {
    const parks = groupByPark(
      [
        avail(1, 10, [date('2026-08-28')], { siteTypes: [1008] }),
        avail(2, 10, [date('2026-08-28', 0)], { siteTypes: [1015] }),
      ],
      [1008],
    )
    expect(parks[0].open).toHaveLength(1)
    expect(parks[0].closed).toEqual([])
  })

  // Excluding by masking rather than compacting: `index` is the slot index a retry and the
  // detail link use, so the campground after an excluded one must keep its own number.
  it('keeps slot indexes when a campground is excluded', () => {
    const parks = groupByPark(
      [
        avail(1, 10, [date('2026-08-28')], { siteTypes: [1015] }),
        avail(2, 10, [date('2026-08-28')], { siteTypes: [1008] }),
      ],
      [1008],
    )
    expect(parks[0].open.map((g) => g.index)).toEqual([1])
  })

  it('keeps a campground the grid never described', () => {
    const parks = groupByPark([avail(1, 10, [date('2026-08-28', 0)])], [1008])
    expect(parks[0].closed.map((c) => c.campground.facilityId)).toEqual([1])
  })

  it('pins everything when no filter is passed', () => {
    const parks = groupByPark([avail(1, 10, [date('2026-08-28', 0)], { siteTypes: [1015] })])
    expect(parks).toHaveLength(1)
  })

  it('orders parks so the busiest paint last', () => {
    const parks = groupByPark([
      avail(1, 10, [date('2026-08-28')]),
      avail(2, 20, [date('2026-08-28')]),
      avail(3, 20, [date('2026-08-29')]),
    ])
    expect(parks.map((p) => p.placeId)).toEqual([10, 20])
  })
})
