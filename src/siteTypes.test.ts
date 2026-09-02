import { describe, expect, it } from 'vitest'
import { ALL_SITE_TYPES, DEFAULT_SITE_TYPES, SITE_TYPES } from './core/domain/siteTypes'
import {
  resolveSiteTypes,
  SITE_TYPE_SLUGS,
  siteTypeSlugs,
  SiteTypeError,
  SLUGGED_IDS,
} from './siteTypes'

describe('the slug vocabulary', () => {
  // The mapping is positional against SITE_TYPES, so a category added or reordered upstream
  // shows up here rather than as a silently unfilterable kind of site.
  it('covers every category the core knows about, in the same order', () => {
    expect(SITE_TYPE_SLUGS).toHaveLength(SITE_TYPES.length)
    expect(SLUGGED_IDS).toEqual(ALL_SITE_TYPES)
  })

  it('round-trips ids through slugs and back', () => {
    expect(siteTypeSlugs(ALL_SITE_TYPES)).toEqual([...SITE_TYPE_SLUGS])
    expect(resolveSiteTypes([...SITE_TYPE_SLUGS])).toEqual(ALL_SITE_TYPES)
  })
})

describe('resolveSiteTypes', () => {
  it('defaults to everything you can sleep in', () => {
    expect(resolveSiteTypes()).toEqual(DEFAULT_SITE_TYPES)
    expect(siteTypeSlugs(resolveSiteTypes())).not.toContain('day-use')
  })

  it('lets day use be asked for by name', () => {
    expect(resolveSiteTypes(['day-use'])).toEqual([7])
  })

  // One canonical spelling per set, so two callers asking for the same thing produce the
  // same settings — and the same shareUrl.
  it('dedupes and orders, whatever order it was given', () => {
    expect(resolveSiteTypes(['rv', 'standard', 'rv'])).toEqual([1, 1015])
    expect(resolveSiteTypes(['standard', 'rv'])).toEqual(resolveSiteTypes(['rv', 'standard']))
  })

  it('is forgiving about case and stray whitespace', () => {
    expect(resolveSiteTypes([' Hike-In '])).toEqual([1014])
  })

  it('names what it did not recognise, and what it would accept', () => {
    expect(() => resolveSiteTypes(['glamping'])).toThrow(SiteTypeError)
    expect(() => resolveSiteTypes(['glamping'])).toThrow(/glamping.*standard/s)
  })

  // The app treats an empty set as a state to prompt about; a tool call has nobody to ask,
  // and the search it describes can only be a mistake.
  it('refuses a set that excludes everything', () => {
    expect(() => resolveSiteTypes([])).toThrow(/cannot be empty/)
  })
})
