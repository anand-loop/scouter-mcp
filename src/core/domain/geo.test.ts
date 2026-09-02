import { describe, expect, it } from 'vitest'
import type { PlaceDto } from '../api/rcApi'
import {
  buildNearbyParams,
  facilityLocation,
  formatMiles,
  type GeoPlace,
  haversineMiles,
  nearestWithin,
  parseFacilityParams,
  parseNearbyParams,
  radiusBounds,
  toGeoPlace,
  toLatLng,
} from './geo'
import { DEFAULT_SITE_TYPES } from './siteTypes'
import type { Facility } from './types'

const SF = { lat: 37.7749, lng: -122.4194 }
const LA = { lat: 34.0522, lng: -118.2437 }

/** Shape mirrors a real /rdr/fd/places row. */
function place(over: Partial<PlaceDto> = {}): PlaceDto {
  return {
    PlaceId: 662,
    Name: 'Big Basin Redwoods SP',
    RegionId: 5,
    City: 'BOULDER CREEK',
    State: 'CA',
    Zip: '95006',
    Latitude: 37.1722,
    Longitude: -122.2222,
    ...over,
  }
}

function geoPlace(over: Partial<GeoPlace> = {}): GeoPlace {
  return {
    placeId: 1,
    name: 'Park',
    city: 'Town',
    state: 'CA',
    zip: '95060',
    lat: SF.lat,
    lng: SF.lng,
    ...over,
  }
}

function facility(over: Partial<Facility> = {}): Facility {
  return { facilityId: 1, placeId: 1, name: 'Loop A', parkName: 'Park', ...over }
}

describe('haversineMiles', () => {
  it('measures a known long distance', () => {
    expect(haversineMiles(SF, LA)).toBeCloseTo(347, 0)
  })

  it('is zero for identical points and symmetric otherwise', () => {
    expect(haversineMiles(SF, SF)).toBe(0)
    expect(haversineMiles(SF, LA)).toBeCloseTo(haversineMiles(LA, SF), 9)
  })
})

describe('toGeoPlace', () => {
  it('keeps a well-formed park and trims its address parts', () => {
    const g = toGeoPlace(place({ Name: 'Big  Basin\r\n Redwoods SP' }))
    expect(g).not.toBeNull()
    expect(g!.name).toBe('Big Basin Redwoods SP')
    expect(g!.city).toBe('BOULDER CREEK')
    expect(g!.lat).toBeCloseTo(37.1722, 4)
  })

  it('rejects the 0/0 "no location" rows the catalog really contains', () => {
    // PlaceId 1243 RecDynamics, 1248 Enderts Beach, 1259 Dos Rios SP.
    expect(toGeoPlace(place({ PlaceId: 1248, Latitude: 0, Longitude: 0 }))).toBeNull()
  })

  it('rejects non-finite and out-of-globe coordinates', () => {
    expect(toGeoPlace(place({ Latitude: Number.NaN }))).toBeNull()
    expect(toGeoPlace(place({ Latitude: 95 }))).toBeNull()
    expect(toGeoPlace(place({ Longitude: -200 }))).toBeNull()
  })

  it('substitutes empty strings for null address parts', () => {
    const g = toGeoPlace(place({ City: null, State: null, Zip: null }))
    expect(g).toMatchObject({ city: '', state: '', zip: '' })
  })
})

describe('nearestWithin', () => {
  const places = new Map<number, GeoPlace>([
    [1, geoPlace({ placeId: 1, lat: SF.lat, lng: SF.lng })],
    [2, geoPlace({ placeId: 2, lat: LA.lat, lng: LA.lng })],
  ])

  it('sorts by ascending distance and drops anything beyond the radius', () => {
    const near = nearestWithin(
      [
        facility({ facilityId: 20, placeId: 2, parkName: 'Far' }),
        facility({ facilityId: 10, placeId: 1, parkName: 'Close' }),
      ],
      places,
      SF,
      500,
    )
    expect(near.map((n) => n.facility.facilityId)).toEqual([10, 20])
    expect(nearestWithin([facility({ placeId: 2 })], places, SF, 100)).toEqual([])
  })

  it('skips campgrounds whose park has no usable coordinates', () => {
    // Three web-bookable facilities really do reference a PlaceId absent from /places.
    expect(nearestWithin([facility({ placeId: 999 })], places, SF, 5000)).toEqual([])
  })

  it('includes a campground sitting exactly on the radius boundary', () => {
    const distance = haversineMiles(SF, LA)
    const near = nearestWithin([facility({ placeId: 2 })], places, SF, distance)
    expect(near).toHaveLength(1)
  })

  it('breaks ties by park then name, since one park can hold many campgrounds', () => {
    const near = nearestWithin(
      [
        facility({ facilityId: 3, placeId: 1, parkName: 'Park', name: 'Loop C' }),
        facility({ facilityId: 1, placeId: 1, parkName: 'Park', name: 'Loop A' }),
        facility({ facilityId: 2, placeId: 1, parkName: 'Another', name: 'Loop Z' }),
      ],
      places,
      SF,
      10,
    )
    expect(near.map((n) => n.facility.facilityId)).toEqual([2, 1, 3])
  })

  it('returns nothing for an empty catalog', () => {
    expect(nearestWithin([], places, SF, 100)).toEqual([])
  })
})

describe('formatMiles', () => {
  it('keeps one decimal under ten miles and rounds above', () => {
    expect(formatMiles(0.42)).toBe('0.4 mi')
    expect(formatMiles(9.55)).toBe('9.6 mi')
    expect(formatMiles(12.4)).toBe('12 mi')
  })
})

describe('parseNearbyParams', () => {
  // Pinned so the month window and "already ended" checks are deterministic.
  const AUG_22 = new Date(2026, 7, 22)
  const parse = (q: string) => parseNearbyParams(new URLSearchParams(q), AUG_22)

  it('reads a full request', () => {
    expect(
      parse(
        'lat=36.9744&lng=-122.0295&radius=50&label=Santa%20Cruz&months=2026-08,2026-09&arrive=5,6&nights=2',
      ),
    ).toEqual({
      lat: 36.9744,
      lng: -122.0295,
      radiusMiles: 50,
      label: 'Santa Cruz',
      monthKeys: ['2026-08', '2026-09'],
      arrivalDays: [5, 6],
      nights: 2,
      siteTypes: DEFAULT_SITE_TYPES,
    })
  })

  it('dedupes and sorts the month list', () => {
    expect(parse('lat=37&lng=-122&months=2026-09,2026-08,2026-09')!.monthKeys).toEqual([
      '2026-08',
      '2026-09',
    ])
  })

  it('honours a month outside the pill window, since a link means what it says', () => {
    expect(parse('lat=37&lng=-122&months=2027-03')!.monthKeys).toEqual(['2027-03'])
  })

  it('drops months that have already ended', () => {
    expect(parse('lat=37&lng=-122&months=2026-01,2026-09')!.monthKeys).toEqual(['2026-09'])
  })

  it('converts a pre-redesign horizon count so old links still mean something', () => {
    expect(parse('lat=37&lng=-122&months=3')!.monthKeys).toEqual([
      '2026-08',
      '2026-09',
      '2026-10',
    ])
  })

  it('returns null rather than throwing on a missing or malformed centre', () => {
    expect(parse('lng=-122')).toBeNull()
    expect(parse('lat=abc&lng=-122')).toBeNull()
    expect(parse('lat=95&lng=-122')).toBeNull()
    expect(parse('lat=37&lng=-200')).toBeNull()
    expect(parse('')).toBeNull()
  })

  it('snaps an arbitrary radius to an offered option', () => {
    expect(parse('lat=37&lng=-122&radius=37')!.radiusMiles).toBe(25)
    expect(parse('lat=37&lng=-122&radius=44')!.radiusMiles).toBe(50)
    expect(parse('lat=37&lng=-122&radius=7')!.radiusMiles).toBe(5)
    // 100 mi was on the pre-picker menu; a link carrying it lands on the widest we now offer.
    expect(parse('lat=37&lng=-122&radius=100')!.radiusMiles).toBe(50)
  })

  it('clamps a night count to the offered range', () => {
    expect(parse('lat=37&lng=-122&arrive=5&nights=9')!.nights).toBe(3)
    expect(parse('lat=37&lng=-122&arrive=5&nights=0')!.nights).toBe(1)
  })

  it('carries a pre-redesign weekday list across intact, one night each', () => {
    // Never two nights: a longer stay is a narrower search than the sender ran, so the
    // recipient would see fewer openings and read it as a bug.
    const r = parse('lat=37&lng=-122&days=5,6,7')!
    expect(r.arrivalDays).toEqual([5, 6, 7])
    expect(r.nights).toBe(1)
    expect(parse('lat=37&lng=-122&days=4,2')!.arrivalDays).toEqual([2, 4])
  })

  it('prefers an explicit arrival over a legacy day list', () => {
    expect(parse('lat=37&lng=-122&arrive=3&nights=2&days=5,6,7')!.arrivalDays).toEqual([3])
  })

  it('falls back to defaults for absent or unusable settings', () => {
    const r = parse('lat=37&lng=-122&arrive=x&months=99')!
    expect(r.arrivalDays).toEqual([5])
    expect(r.nights).toBe(2)
    expect(r.monthKeys).toEqual(['2026-08', '2026-09'])
    expect(r.radiusMiles).toBe(50)
  })

  it('falls back when every listed month is unusable', () => {
    expect(parse('lat=37&lng=-122&months=garbage')!.monthKeys).toEqual(['2026-08', '2026-09'])
    expect(parse('lat=37&lng=-122&months=')!.monthKeys).toEqual(['2026-08', '2026-09'])
    expect(parse('lat=37&lng=-122&months=2020-01')!.monthKeys).toEqual(['2026-08', '2026-09'])
  })

  it('truncates an overlong label', () => {
    const label = 'x'.repeat(200)
    expect(parse(`lat=37&lng=-122&label=${label}`)!.label).toHaveLength(80)
  })

  it('round-trips through buildNearbyParams', () => {
    const req = {
      lat: 36.9744,
      lng: -122.0295,
      radiusMiles: 25,
      label: 'Santa Cruz',
      monthKeys: ['2026-09', '2026-10'],
      arrivalDays: [1, 6],
      nights: 3,
      siteTypes: [1, 2],
    }
    expect(parseNearbyParams(new URLSearchParams(buildNearbyParams(req)), AUG_22)).toEqual(req)
  })

  // Every link written before the site-type filter existed omits `types`. Those links have
  // to keep meaning what they meant, which is why an absent parameter is the default rather
  // than an empty set.
  it('gives a link with no site types the default set', () => {
    const parsed = parseNearbyParams(
      new URLSearchParams('lat=37&lng=-122&radius=25&months=2026-09&arrive=5&nights=2'),
      AUG_22,
    )
    expect(parsed?.siteTypes).toEqual(DEFAULT_SITE_TYPES)
  })

  // An empty one is a choice, not an omission — the user turned everything off.
  it('keeps an explicitly empty site-type set empty', () => {
    const parsed = parseNearbyParams(
      new URLSearchParams('lat=37&lng=-122&radius=25&months=2026-09&arrive=5&nights=2&types='),
      AUG_22,
    )
    expect(parsed?.siteTypes).toEqual([])
  })

  it('drops site types it has no label for', () => {
    const parsed = parseNearbyParams(
      new URLSearchParams('lat=37&lng=-122&radius=25&months=2026-09&types=1,999,2'),
      AUG_22,
    )
    expect(parsed?.siteTypes).toEqual([1, 2])
  })
})

describe('parseFacilityParams', () => {
  const AUG_22 = new Date(2026, 7, 22)
  const parse = (q: string) => parseFacilityParams(new URLSearchParams(q), AUG_22)

  it('reads a single-campground request', () => {
    expect(parse('facility=683&months=2026-09&arrive=6&nights=1')).toEqual({
      facilityId: 683,
      monthKeys: ['2026-09'],
      arrivalDays: [6],
      nights: 1,
      siteTypes: DEFAULT_SITE_TYPES,
    })
  })

  it('returns null without a usable facility id', () => {
    expect(parse('')).toBeNull()
    expect(parse('facility=abc')).toBeNull()
    expect(parse('facility=-1')).toBeNull()
    expect(parse('facility=0')).toBeNull()
    expect(parse('facility=1.5')).toBeNull()
  })

  it('defaults months and the stay like the nearby parser', () => {
    const r = parse('facility=683')!
    expect(r.monthKeys).toEqual(['2026-08', '2026-09'])
    expect(r.arrivalDays).toEqual([5])
    expect(r.nights).toBe(2)
  })

  it('leaves precedence to the caller when a URL carries both shapes', () => {
    const sp = new URLSearchParams('lat=37&lng=-122&facility=683')
    // Both parse; AvailabilityScreen resolves lat/lng first.
    expect(parseNearbyParams(sp, AUG_22)).not.toBeNull()
    expect(parseFacilityParams(sp, AUG_22)).not.toBeNull()
  })
})

describe('toLatLng', () => {
  it('accepts a real coordinate pair', () => {
    expect(toLatLng(37.1722, -122.2222)).toEqual({ lat: 37.1722, lng: -122.2222 })
  })

  it('rejects the 0/0 sentinel the API uses for "no location"', () => {
    expect(toLatLng(0, 0)).toBeNull()
  })

  it('keeps a genuine zero on one axis only', () => {
    expect(toLatLng(0, -122.2)).toEqual({ lat: 0, lng: -122.2 })
  })

  it('rejects missing, non-numeric, and out-of-globe values', () => {
    expect(toLatLng(undefined, undefined)).toBeNull()
    expect(toLatLng('37.1', '-122.2')).toBeNull()
    expect(toLatLng(Number.NaN, -122)).toBeNull()
    expect(toLatLng(Number.POSITIVE_INFINITY, -122)).toBeNull()
    expect(toLatLng(91, -122)).toBeNull()
    expect(toLatLng(37, 181)).toBeNull()
  })
})

describe('radiusBounds', () => {
  it('reaches the radius at every edge', () => {
    const [sw, ne] = radiusBounds(SF, 50)
    expect(haversineMiles(SF, { lat: sw.lat, lng: SF.lng })).toBeCloseTo(50, 1)
    expect(haversineMiles(SF, { lat: ne.lat, lng: SF.lng })).toBeCloseTo(50, 1)
    expect(haversineMiles(SF, { lat: SF.lat, lng: sw.lng })).toBeGreaterThanOrEqual(50)
    expect(haversineMiles(SF, { lat: SF.lat, lng: ne.lng })).toBeGreaterThanOrEqual(50)
  })

  // The box has to contain the circle, not merely touch it, or the map frames a ring whose
  // east and west edges sit outside the viewport.
  it('contains the circle rather than cutting its corners', () => {
    const [sw, ne] = radiusBounds(SF, 25)
    for (const bearing of [0, 30, 45, 60, 90, 135, 180, 225, 270, 315]) {
      const rad = (bearing * Math.PI) / 180
      const latSpan = (25 / 3958.8) * (180 / Math.PI)
      const point = {
        lat: SF.lat + latSpan * Math.cos(rad),
        lng: SF.lng + (latSpan * Math.sin(rad)) / Math.cos((SF.lat * Math.PI) / 180),
      }
      expect(point.lat).toBeGreaterThanOrEqual(sw.lat)
      expect(point.lat).toBeLessThanOrEqual(ne.lat)
      expect(point.lng).toBeGreaterThanOrEqual(sw.lng)
      expect(point.lng).toBeLessThanOrEqual(ne.lng)
    }
  })

  it('widens in longitude with latitude, since degrees narrow towards the poles', () => {
    const span = (p: { lat: number; lng: number }) => {
      const [sw, ne] = radiusBounds(p, 50)
      return ne.lng - sw.lng
    }
    expect(span({ lat: 41.7, lng: -124 })).toBeGreaterThan(span({ lat: 32.5, lng: -117 }))
    // At the equator the two spans very nearly meet — the box is still measured at its own
    // top edge rather than at the centre, so it stays a hair wider than tall.
    const latSpan = (50 / 3958.8) * (180 / Math.PI) * 2
    expect(span({ lat: 0, lng: 0 })).toBeGreaterThan(latSpan)
    expect(span({ lat: 0, lng: 0 })).toBeCloseTo(latSpan, 3)
  })

  it('collapses to the centre for a zero radius', () => {
    expect(radiusBounds(SF, 0)).toEqual([SF, SF])
  })

  it('clamps at the pole rather than wrapping past it', () => {
    const [sw, ne] = radiusBounds({ lat: 89.9, lng: 10 }, 200)
    expect(ne.lat).toBe(90)
    expect(sw.lat).toBeGreaterThan(85)
    expect(ne.lng - sw.lng).toBeLessThanOrEqual(360)
  })
})

describe('facilityLocation', () => {
  // China Camp SP: the park and two of its campgrounds are in San Rafael, the other two
  // claim to be in Riverside County, 388 mi away. Averaging all four put the park's pin
  // near Coalinga, where none of them are.
  const chinaCamp = { lat: 38.00171, lng: -122.46261 }
  const weberPoint = { lat: 38.0046446, lng: -122.4708076 }
  const bogus = { lat: 33.9189038, lng: -117.6988183 }

  it('keeps a campground’s own coordinates when they sit inside its park', () => {
    expect(facilityLocation(weberPoint, chinaCamp)).toEqual(weberPoint)
  })

  it('rejects coordinates that cannot belong to the park, and plots the park instead', () => {
    expect(facilityLocation(bogus, chinaCamp)).toEqual(chinaCamp)
  })

  // Lake Oroville SRA reports 121.4456 rather than -121.4456, landing in Mongolia.
  it('rejects a dropped minus sign rather than trying to repair it', () => {
    const park = { lat: 39.5343, lng: -121.467 }
    expect(facilityLocation({ lat: 39.5242, lng: 121.4456 }, park)).toEqual(park)
  })

  // Auburn SRA's Mineral Bar is a genuine 14 mi from the park's own point.
  it('tolerates a genuinely large park', () => {
    const auburn = { lat: 38.9158, lng: -121.041 }
    const mineralBar = { lat: 39.1008, lng: -120.9239 }
    expect(haversineMiles(mineralBar, auburn)).toBeGreaterThan(14)
    expect(facilityLocation(mineralBar, auburn)).toEqual(mineralBar)
  })

  it('falls back to the park when the grid reported nothing', () => {
    expect(facilityLocation(undefined, chinaCamp)).toEqual(chinaCamp)
  })

  it('has nothing to check against without a park, so takes the campground at its word', () => {
    expect(facilityLocation(bogus, undefined)).toEqual(bogus)
  })

  it('is undefined when neither source has coordinates', () => {
    expect(facilityLocation(undefined, undefined)).toBeUndefined()
  })
})

// Panning the results map re-searches by rewriting the URL, so everything the user chose on
// the home screen has to survive a change of centre untouched — the whole point is the same
// search somewhere else.
describe('re-centring a search', () => {
  it('moves the centre and its name, and changes nothing else', () => {
    const original = parseNearbyParams(
      new URLSearchParams(
        'lat=37.7749&lng=-122.4194&radius=25&label=San%20Francisco&months=2026-09,2026-10&arrive=5,6&nights=2',
      ),
    )
    expect(original).not.toBeNull()
    const moved = parseNearbyParams(
      new URLSearchParams(
        buildNearbyParams({ ...original!, lat: LA.lat, lng: LA.lng, label: 'Los Angeles' }),
      ),
    )
    expect(moved).toEqual({
      ...original!,
      lat: Number(LA.lat.toFixed(5)),
      lng: Number(LA.lng.toFixed(5)),
      label: 'Los Angeles',
    })
  })

  it('searches an unnameable spot rather than refusing to search it', () => {
    const original = parseNearbyParams(
      new URLSearchParams('lat=37.7749&lng=-122.4194&radius=15&label=Somewhere&months=2026-09'),
    )
    const moved = parseNearbyParams(
      new URLSearchParams(buildNearbyParams({ ...original!, label: '' })),
    )
    expect(moved?.label).toBe('')
    expect(moved?.radiusMiles).toBe(15)
    expect(moved?.monthKeys).toEqual(original!.monthKeys)
  })
})
