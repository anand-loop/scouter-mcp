import { describe, expect, it } from 'vitest'
import { parseNominatimResults, rankGeocodeResults } from './nominatim'

/**
 * The genuine response for q=santa+cruz (countrycodes=us, limit=5), trimmed to the fields
 * we read. Note the county scores *higher* than the city — the case ranking exists for.
 */
const SANTA_CRUZ = [
  {
    lat: '37.0500960',
    lon: '-121.9905900',
    name: 'Santa Cruz County',
    display_name: 'Santa Cruz County, California, United States',
    addresstype: 'county',
    importance: 0.5896722518822809,
  },
  {
    lat: '36.9743626',
    lon: '-122.0294673',
    name: 'Santa Cruz',
    display_name: 'Santa Cruz, Santa Cruz County, California, United States',
    addresstype: 'city',
    importance: 0.5849667189179498,
  },
  {
    lat: '31.5094579',
    lon: '-110.8476280',
    name: 'Santa Cruz County',
    display_name: 'Santa Cruz County, Arizona, United States',
    addresstype: 'county',
    importance: 0.5091536447517412,
  },
  {
    lat: '32.0345181',
    lon: '-111.9070700',
    name: 'Santa Cruz',
    display_name: 'Santa Cruz, Pima County, Arizona, United States',
    addresstype: 'hamlet',
    importance: 0.3832540623917188,
  },
]

/** The genuine response for postalcode 94110 — exactly one match. */
const ZIP_94110 = [
  {
    lat: '37.7532726',
    lon: '-122.4170033',
    name: '94110',
    display_name: '94110, San Francisco, California, United States',
    addresstype: 'postcode',
    importance: 0.12000999999999995,
  },
]

describe('parseNominatimResults', () => {
  it('coerces the string coordinates Nominatim returns into numbers', () => {
    const [first] = parseNominatimResults(SANTA_CRUZ)
    expect(first.lat).toBeCloseTo(37.050096, 6)
    expect(first.lng).toBeCloseTo(-121.99059, 6)
    expect(first.shortLabel).toBe('Santa Cruz County')
    expect(first.kind).toBe('county')
  })

  it('classifies postcodes and small settlements', () => {
    expect(parseNominatimResults(ZIP_94110)[0].kind).toBe('postcode')
    expect(parseNominatimResults(SANTA_CRUZ)[3].kind).toBe('city')
  })

  it('drops malformed entries instead of throwing', () => {
    const mixed = [
      { lat: 'nope', lon: '-122', name: 'Bad' },
      { lon: '-122', name: 'No lat' },
      null,
      'string',
      SANTA_CRUZ[1],
    ]
    expect(parseNominatimResults(mixed)).toHaveLength(1)
  })

  it('returns an empty list for anything that is not an array', () => {
    expect(parseNominatimResults(null)).toEqual([])
    expect(parseNominatimResults({})).toEqual([])
    expect(parseNominatimResults(undefined)).toEqual([])
    expect(parseNominatimResults([])).toEqual([])
  })
})

describe('rankGeocodeResults', () => {
  it('puts the city above the county despite the county scoring higher', () => {
    const ranked = rankGeocodeResults(parseNominatimResults(SANTA_CRUZ))
    expect(ranked[0].shortLabel).toBe('Santa Cruz')
    expect(ranked[0].kind).toBe('city')
    expect(ranked[0].lat).toBeCloseTo(36.9743626, 6)
    // The county is still offered, just not first.
    expect(ranked.map((r) => r.kind)).toEqual(['city', 'city', 'county', 'county'])
  })

  it('orders same-kind matches by importance', () => {
    const counties = rankGeocodeResults(parseNominatimResults(SANTA_CRUZ)).filter(
      (r) => r.kind === 'county',
    )
    expect(counties[0].importance).toBeGreaterThan(counties[1].importance)
  })

  it('ranks a postcode first', () => {
    const ranked = rankGeocodeResults(parseNominatimResults([...SANTA_CRUZ, ...ZIP_94110]))
    expect(ranked[0].kind).toBe('postcode')
  })

  it('does not mutate its input', () => {
    const parsed = parseNominatimResults(SANTA_CRUZ)
    const before = parsed.map((r) => r.shortLabel)
    rankGeocodeResults(parsed)
    expect(parsed.map((r) => r.shortLabel)).toEqual(before)
  })
})
