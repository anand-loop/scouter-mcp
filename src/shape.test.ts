import { describe, expect, it } from 'vitest'
import { normalizeWhen } from './search'
import { summarize } from './shape'
import type { CampgroundAvailability, SavedCampground } from './core/domain/types'
import type { ResolvedWhere } from './where'

const AUG_30 = new Date(2026, 7, 30)

const WHERE: ResolvedWhere = {
  kind: 'area',
  lat: 36.27,
  lng: -121.8,
  radiusMiles: 50,
  label: 'Big Sur · 50 mi',
}

const camp = (facilityId: number, name: string, placeId: number, parkName: string): SavedCampground => ({
  facilityId,
  placeId,
  name,
  parkName,
})

const sites = (n: number) => Array.from({ length: n }, (_, i) => ({ unitId: i, label: String(i + 1) }))

const result = (
  campground: SavedCampground,
  distanceMiles: number,
  open: Array<[string, number]>,
  extra: Partial<CampgroundAvailability> = {},
): CampgroundAvailability => ({
  campground,
  distanceMiles,
  results: open.map(([date, n]) => ({ date, freeSites: sites(n) })),
  ...extra,
})

const MAIN = camp(767, 'Main Camp', 690, 'Pfeiffer Big Sur SP')
const SOUTH = camp(611, 'South Camp', 690, 'Pfeiffer Big Sur SP')
const LIME = camp(1130, 'Ocean Camp', 666, 'Limekiln SP')

const when = normalizeWhen({ arrivalDays: [6] }, AUG_30)
const meta = { found: 3, capped: false, datesChecked: 13 }

describe('summarize', () => {
  const slots = [
    result(MAIN, 14.2, [['2026-09-19', 1], ['2026-11-28', 6]]),
    result(SOUTH, 14.4, [['2026-11-28', 4]]),
    result(LIME, 24.6, [['2026-09-19', 3]]),
  ]

  it('groups campgrounds under their park, nearest park first', () => {
    const s = summarize(slots, WHERE, when, meta)
    expect(s.parks.map((p) => p.parkName)).toEqual(['Pfeiffer Big Sur SP', 'Limekiln SP'])
    expect(s.parks[0].campgrounds.map((c) => c.name)).toEqual(['Main Camp', 'South Camp'])
    expect(s.parks[0].nearestMiles).toBe(14)
  })

  // The invariant the whole two-tier design rests on. get_sites is where labels live.
  it('never lets a site label escape', () => {
    const tagged = slots.map((s) => ({ ...s, siteTypes: [1, 1015], maxVehicleLength: 30 }))
    const json = JSON.stringify(summarize(tagged, WHERE, when, meta))
    expect(json).not.toContain('unitId')
    expect(json).not.toContain('freeSites')
    expect(json).not.toContain('"label"')
    expect(summarize(slots, WHERE, when, meta).parks[0].campgrounds[0].open).toEqual([
      { date: '2026-09-19', sites: 1 },
      { date: '2026-11-28', sites: 6 },
    ])
  })

  it('hoists the soonest open date, and lists them all deduped and ascending', () => {
    const s = summarize(slots, WHERE, when, meta)
    expect(s.nextOpen).toBe('2026-09-19')
    expect(s.openDates).toEqual(['2026-09-19', '2026-11-28'])
  })

  it('counts what was scanned and what had openings', () => {
    const s = summarize(slots, WHERE, when, meta)
    expect(s.scanned).toEqual({ campgrounds: 3, found: 3, withOpenings: 3, failed: 0 })
  })

  it('reports nothing open as null rather than an absent field', () => {
    const s = summarize([result(MAIN, 14, [])], WHERE, when, meta)
    expect(s.nextOpen).toBeNull()
    expect(s.openDates).toEqual([])
    expect(s.parks).toEqual([])
  })

  // A campground that didn't answer is not a campground with nothing free, and an agent
  // that can't tell them apart will report "nothing available" when it doesn't know that.
  it('names failures instead of dropping them', () => {
    const s = summarize(
      [result(MAIN, 14, []), result(SOUTH, 14, [], { error: 'HTTP 503' })],
      WHERE,
      when,
      meta,
    )
    expect(s.scanned.failed).toBe(1)
    expect(s.errors).toEqual(['South Camp: HTTP 503'])
  })

  it('says so when the scan was capped, rather than passing for a complete one', () => {
    const s = summarize(slots, WHERE, when, { ...meta, found: 130, capped: true })
    expect(s.truncated).toMatch(/nearest 3 of 130/)
    expect(s.scanned.found).toBe(130)
  })

  it('tolerates slots still unfilled', () => {
    expect(() => summarize([null, result(MAIN, 14, [['2026-09-19', 2]])], WHERE, when, meta)).not.toThrow()
  })

  it('carries a shareUrl only when one was built', () => {
    expect(summarize(slots, WHERE, when, meta).shareUrl).toBeUndefined()
    expect(summarize(slots, WHERE, when, { ...meta, shareUrl: 'https://x/a?b' }).shareUrl).toBe('https://x/a?b')
  })

  it('echoes the criteria it actually searched', () => {
    const s = summarize(slots, WHERE, when, meta)
    expect(s.criteria).toEqual({
      where: 'Big Sur · 50 mi',
      nights: 1,
      arrivalDays: [6],
      siteTypes: ['standard', 'group', 'lodging', 'hike-in', 'rv', 'equestrian', 'environmental'],
      // The default set says nothing worth repeating on every answer.
      siteTypesPhrase: undefined,
      from: '2026-08-30',
      to: '2026-11-30',
      datesChecked: 13,
    })
  })

  // The filter defaults, so a caller who never mentioned site types still needs to see that
  // day use was left out — otherwise "nothing open" is indistinguishable from "nothing open
  // that you can sleep in".
  it('always states the site-type filter, default or not', () => {
    expect(summarize(slots, WHERE, when, meta).criteria.siteTypes).not.toContain('day-use')

    const narrowed = normalizeWhen({ arrivalDays: [6] }, AUG_30, [1014])
    const s = summarize(slots, WHERE, narrowed, meta)
    expect(s.criteria.siteTypes).toEqual(['hike-in'])
    expect(s.criteria.siteTypesPhrase).toBe('Hike-in / bike-in / boat-in')
  })

  // What the campground is, not what the search asked for: the tags are read from every
  // unit, so an RV length survives a search that excluded hook-ups.
  it('tags a campground with the kinds of site it has', () => {
    const s = summarize(
      [result(MAIN, 14, [['2026-09-19', 1]], { siteTypes: [1, 1015], maxVehicleLength: 30 })],
      WHERE,
      when,
      meta,
    )
    expect(s.parks[0].campgrounds[0].tags).toEqual(['RV up to 30 ft'])
  })

  it('omits tags entirely when the units describe nothing', () => {
    const s = summarize([result(MAIN, 14, [['2026-09-19', 1]], { siteTypes: [1] })], WHERE, when, meta)
    expect('tags' in s.parks[0].campgrounds[0]).toBe(false)
  })
})

describe('summarize trims the range overscan', () => {
  // Widening a range to whole months is free on the wire, but the results come back wider
  // than the caller asked for — and an opening on the 27th is one they cannot distinguish
  // from one they wanted.
  it('drops openings outside the requested window before counting them', () => {
    const ranged = normalizeWhen({ from: '2026-09-03', to: '2026-09-20' }, AUG_30)
    const s = summarize(
      [result(MAIN, 14, [['2026-09-01', 5], ['2026-09-12', 2], ['2026-09-27', 9]])],
      WHERE,
      ranged,
      { found: 1, capped: false, datesChecked: 3 },
    )
    expect(s.openDates).toEqual(['2026-09-12'])
    expect(s.scanned.withOpenings).toBe(1)
    expect(s.parks[0].campgrounds[0].open).toEqual([{ date: '2026-09-12', sites: 2 }])
  })

  it('can leave a campground with nothing left, and then omits it entirely', () => {
    const ranged = normalizeWhen({ from: '2026-09-03', to: '2026-09-20' }, AUG_30)
    const s = summarize([result(MAIN, 14, [['2026-09-27', 9]])], WHERE, ranged, {
      found: 1,
      capped: false,
      datesChecked: 3,
    })
    expect(s.parks).toEqual([])
    expect(s.scanned.withOpenings).toBe(0)
    expect(s.nextOpen).toBeNull()
  })
})
