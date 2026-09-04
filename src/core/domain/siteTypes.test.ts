import { describe, expect, it } from 'vitest'
import {
  ALL_SITE_TYPES,
  DEFAULT_SITE_TYPES,
  hasWantedSiteType,
  isDefaultSiteTypes,
  isEverySiteType,
  normalizeSiteTypes,
  SITE_TYPES,
  siteTypesLabel,
  siteTypesPhrase,
  siteTypesSub,
  siteTypeTags,
} from './siteTypes'

describe('SITE_TYPES', () => {
  it('offers the eight categories ReserveCalifornia publishes for California', () => {
    expect(ALL_SITE_TYPES).toEqual([1, 2, 1008, 1014, 1015, 1016, 1022, 7])
  })

  // 1010 is boat slips and docks. It exists in the unit-type table, but ReserveCalifornia
  // leaves it out of its own filter list and no bookable California facility uses one.
  it('leaves out the category nothing can match', () => {
    expect(ALL_SITE_TYPES).not.toContain(1010)
  })

  it('gives every type a name and a line under it', () => {
    for (const t of SITE_TYPES) {
      expect(t.name.length).toBeGreaterThan(0)
      expect(t.sub.length).toBeGreaterThan(0)
    }
  })
})

describe('DEFAULT_SITE_TYPES', () => {
  // The filter exists because picnic reservations were being reported as campsites. Every
  // other category stays on, so turning the feature on takes no result away from anyone.
  it('is everything you can sleep in — day use alone is off', () => {
    expect(DEFAULT_SITE_TYPES).not.toContain(7)
    expect(DEFAULT_SITE_TYPES.length).toBe(ALL_SITE_TYPES.length - 1)
  })
})

describe('normalizeSiteTypes', () => {
  it('drops ids it has no label for, so the screen can never disagree with the search', () => {
    expect(normalizeSiteTypes([1, 999, 2])).toEqual([1, 2])
    expect(normalizeSiteTypes([1010])).toEqual([])
  })

  it('dedupes', () => {
    expect(normalizeSiteTypes([2, 1, 2, 1])).toEqual([1, 2])
  })

  // One canonical spelling, so two people picking the same types share the same URL.
  it('returns catalogue order regardless of input order', () => {
    expect(normalizeSiteTypes([7, 1014, 1])).toEqual([1, 1014, 7])
    expect(normalizeSiteTypes([1, 1014, 7])).toEqual([1, 1014, 7])
  })

  it('keeps empty empty, and survives values that are not a list', () => {
    expect(normalizeSiteTypes([])).toEqual([])
    expect(normalizeSiteTypes(null)).toEqual([])
    expect(normalizeSiteTypes('1,2')).toEqual([])
    expect(normalizeSiteTypes([undefined, '1', null])).toEqual([])
  })
})

describe('isEverySiteType / isDefaultSiteTypes', () => {
  it('recognises a complete set', () => {
    expect(isEverySiteType(ALL_SITE_TYPES)).toBe(true)
    expect(isEverySiteType(DEFAULT_SITE_TYPES)).toBe(false)
  })

  it('recognises the default regardless of order', () => {
    expect(isDefaultSiteTypes([...DEFAULT_SITE_TYPES].reverse())).toBe(true)
    expect(isDefaultSiteTypes(ALL_SITE_TYPES)).toBe(false)
    expect(isDefaultSiteTypes([])).toBe(false)
  })
})

describe('hasWantedSiteType', () => {
  it('matches a campground that has one of the wanted kinds', () => {
    expect(hasWantedSiteType([1, 1015], [1008, 1015])).toBe(true)
  })

  it('rejects a campground whose kinds are all excluded', () => {
    expect(hasWantedSiteType([1015], [1008])).toBe(false)
    // Day use off by default is the case the filter exists for: a picnic-area-only
    // facility is not a campground the search was ever about.
    expect(hasWantedSiteType([7], DEFAULT_SITE_TYPES)).toBe(false)
  })

  it('matches everything when nothing is excluded', () => {
    expect(hasWantedSiteType([7], ALL_SITE_TYPES)).toBe(true)
  })

  // Undefined is a campground that errored; empty is one the grid returned no bookable
  // units for. Neither is evidence of a mismatch, and dropping them would hide a
  // campground that does match.
  it('keeps a campground whose kinds are unknown', () => {
    expect(hasWantedSiteType(undefined, [1008])).toBe(true)
    expect(hasWantedSiteType([], [1008])).toBe(true)
  })

  it('matches nothing knowable when no kind is wanted', () => {
    expect(hasWantedSiteType([1], [])).toBe(false)
  })
})

describe('siteTypesLabel / siteTypesSub', () => {
  it('collapses at both ends rather than listing eight names in a row', () => {
    expect(siteTypesLabel(ALL_SITE_TYPES)).toBe('All site types')
    expect(siteTypesSub(ALL_SITE_TYPES)).toBe('nothing excluded')

    expect(siteTypesLabel([])).toBe('No site types')
    expect(siteTypesSub([])).toBe('pick at least one')
  })

  it('counts both what is kept and what is not', () => {
    expect(siteTypesLabel([1, 2])).toBe('2 site types')
    expect(siteTypesSub([1, 2])).toBe('6 excluded')
  })
})

describe('siteTypesPhrase', () => {
  // The criteria line already carries the place, the radius, the stay and the months.
  // Repeating a filter nobody changed would be noise rather than information.
  it('says nothing when the search says nothing', () => {
    expect(siteTypesPhrase(DEFAULT_SITE_TYPES)).toBe('')
  })

  it('names the types when the set is narrowed', () => {
    expect(siteTypesPhrase([1, 2])).toBe('Standard campsite & Group')
  })

  it('has a phrase for both extremes', () => {
    expect(siteTypesPhrase(ALL_SITE_TYPES)).toBe('Any site type')
    expect(siteTypesPhrase([])).toBe('No site types')
  })
})

describe('siteTypeTags', () => {
  it('says "only" when a category is the whole campground', () => {
    expect(siteTypeTags([2])).toEqual(['Group site'])
    expect(siteTypeTags([1014])).toEqual(['Hike-in only'])
    // A hike-in loop inside a drive-up campground is a different proposition.
    expect(siteTypeTags([1, 1014])).toEqual(['Hike-in sites'])
  })

  it('shows a vehicle length only where something can park', () => {
    expect(siteTypeTags([1015], 30)).toEqual(['RV up to 30 ft'])
    expect(siteTypeTags([1], 21)).toEqual(['Up to 21 ft'])
    expect(siteTypeTags([1014], 21)).toEqual(['Hike-in only'])
  })

  it('falls back when no length is recorded', () => {
    expect(siteTypeTags([1015])).toEqual(['RV hook-ups'])
    expect(siteTypeTags([1])).toEqual([])
  })

  it('names a picnic area for what it is', () => {
    expect(siteTypeTags([7])).toEqual(['Day use only'])
  })

  it('says nothing it cannot support', () => {
    expect(siteTypeTags([])).toEqual([])
  })
})
