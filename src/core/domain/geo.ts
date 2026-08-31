// Location search: park coordinates, distance, and the URL shape of a nearby scan.
//
// Campgrounds have no coordinates of their own — they inherit their park's, which the
// places catalog already carries. Everything here is pure so it can be unit tested
// without a browser or the network.
import type { PlaceDto } from '../api/rcApi'
import { today as todayFn } from './dates'
import {
  defaultMonthKeys,
  isMonthKey,
  type MonthKey,
  MONTH_WINDOW,
  monthEnd,
  monthWindow,
} from './months'
import { DEFAULT_STAY, normalizeStay, type StaySelection } from './stay'
import type { Facility } from './types'

export interface LatLng {
  lat: number
  lng: number
}

/** A park with usable coordinates. Built from PlaceDto; address parts are never null. */
export interface GeoPlace {
  placeId: number
  name: string
  city: string
  state: string
  zip: string
  lat: number
  lng: number
}

/** A campground within the search radius, with its park and distance from the centre. */
export interface NearbyFacility {
  facility: Facility
  place: GeoPlace
  distanceMiles: number
}

/** A nearby scan, as encoded in the /availability query string. */
export interface NearbyScanRequest extends StaySelection {
  lat: number
  lng: number
  radiusMiles: number
  label: string
  monthKeys: MonthKey[]
}

/** A scan of one saved campground, as encoded in the /availability query string. */
export interface FacilityScanRequest extends StaySelection {
  facilityId: number
  monthKeys: MonthKey[]
}

export const RADIUS_OPTIONS = [5, 10, 15, 25, 50] as const
/**
 * The widest option, deliberately. Los Angeles has literally zero campgrounds inside 25 mi,
 * so anything narrower opens the app on an empty search for a city-dwelling user.
 */
export const DEFAULT_RADIUS = 50
/**
 * Hard ceiling on campgrounds per scan. Each one costs ~5 grid requests at ~61 KB over a
 * four-month search (see WINDOW_DAYS), so 40 is roughly 12 MB and ~13s on broadband. Dense
 * searches (Sacramento at 100 mi finds 135)
 * are truncated to the nearest 40 rather than quietly spending 34 MB.
 */
export const SCAN_CAP = 40

const EARTH_RADIUS_MILES = 3958.8
const MAX_LABEL_LENGTH = 80

const toRadians = (deg: number) => (deg * Math.PI) / 180

/** Great-circle distance in statute miles. */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)))
}

function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Narrows a park to one usable for distance search, or null when it isn't.
 *
 * A few catalog rows carry 0/0 coordinates as a "no location" sentinel. None of them
 * currently has a web-bookable campground, but the guard is what keeps a placeholder
 * park off the Gulf of Guinea and 5,000 miles from every search.
 */
export function toLatLng(lat: unknown, lng: unknown): LatLng | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat === 0 && lng === 0) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}

export function toGeoPlace(dto: PlaceDto): GeoPlace | null {
  const point = toLatLng(dto.Latitude, dto.Longitude)
  if (!point) return null
  return {
    placeId: dto.PlaceId,
    name: clean(dto.Name),
    city: clean(dto.City),
    state: clean(dto.State),
    zip: clean(dto.Zip),
    lat: point.lat,
    lng: point.lng,
  }
}

/** "0.4 mi" under 10 miles, "12 mi" above — precision nobody needs looks like noise. */
export function formatMiles(mi: number): string {
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`
}

/**
 * Campgrounds within `radiusMiles` of `center`, nearest first.
 *
 * Campgrounds whose park is missing or has no coordinates are skipped — they stay
 * findable by name, just not by location. Ties are broken by name because a single park
 * can hold a dozen campgrounds that all share its exact coordinates, which would
 * otherwise leave their order at the mercy of the sort implementation.
 */
export function nearestWithin(
  facilities: Facility[],
  placeById: Map<number, GeoPlace>,
  center: LatLng,
  radiusMiles: number,
): NearbyFacility[] {
  const out: NearbyFacility[] = []
  for (const facility of facilities) {
    const place = placeById.get(facility.placeId)
    if (!place) continue
    const distanceMiles = haversineMiles(center, place)
    if (distanceMiles > radiusMiles) continue
    out.push({ facility, place, distanceMiles })
  }
  return out.sort(
    (a, b) =>
      a.distanceMiles - b.distanceMiles ||
      a.facility.parkName.localeCompare(b.facility.parkName) ||
      a.facility.name.localeCompare(b.facility.name),
  )
}

function finiteNumber(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/** Snaps an arbitrary radius to the closest offered option. */
export function snapRadius(miles: number): number {
  return RADIUS_OPTIONS.reduce((best, option) =>
    Math.abs(option - miles) < Math.abs(best - miles) ? option : best,
  )
}

function parseWeekdays(raw: string | null): number[] | null {
  if (!raw) return null
  const days = raw
    .split(',')
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
  return days.length > 0 ? [...new Set(days)].sort((a, b) => a - b) : null
}

/**
 * Months from a query string.
 *
 * Deliberately different from the load-time rule in `months.ts`: there we filter to the
 * current 4-month window, but a link's months *are* its meaning, and the window is only a
 * UI affordance — so a link to 2027-03 scans March even though no pill offers it. Only
 * months that have already ended are dropped, since scanning them can return nothing.
 */
function parseMonthKeys(raw: string | null, today: Date): MonthKey[] {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return defaultMonthKeys(today)

  // Pre-redesign links carried a rolling horizon count; keep them roughly meaning what
  // they meant rather than silently scanning the wrong months.
  if (/^[1-6]$/.test(trimmed)) {
    return monthWindow(today).slice(0, Math.min(Number(trimmed), MONTH_WINDOW))
  }

  const keys = [...new Set(trimmed.split(',').map((k) => k.trim()))]
    .filter(isMonthKey)
    .filter((k) => monthEnd(k).getTime() >= today.getTime() - 86_400_000)
    .sort()
  return keys.length > 0 ? keys : defaultMonthKeys(today)
}

/**
 * The stay a link describes.
 *
 * `arrive` rather than `day`, because `day=5` one keystroke from the pre-redesign
 * `days=5,6,7` is a link a human debugging this will read wrong.
 *
 * A pre-redesign link carried a weekday *set* with no notion of consecutive nights, which
 * maps across intact: the same days, one night each. Deliberately not the two-night
 * default, since a longer stay is a strictly narrower search and the recipient would see
 * fewer openings than the sender did, which reads as a bug rather than as a policy.
 */
function parseStay(sp: URLSearchParams): StaySelection {
  const nightsRaw = finiteNumber(sp.get('nights'))
  const arrive = parseWeekdays(sp.get('arrive'))
  if (arrive) return normalizeStay(arrive, nightsRaw ?? DEFAULT_STAY.nights)
  const legacy = parseWeekdays(sp.get('days'))
  if (legacy) return normalizeStay(legacy, nightsRaw ?? 1)
  return DEFAULT_STAY
}

/**
 * Reads a nearby scan out of the /availability query string, or null if there isn't a
 * valid one. Returning null rather than throwing is what lets a hand-edited or truncated
 * link fall back to the watchlist instead of breaking the screen.
 */
export function parseNearbyParams(
  sp: URLSearchParams,
  today: Date = todayFn(),
): NearbyScanRequest | null {
  const lat = finiteNumber(sp.get('lat'))
  const lng = finiteNumber(sp.get('lng'))
  if (lat === null || lng === null) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null

  const radiusRaw = finiteNumber(sp.get('radius'))

  return {
    lat,
    lng,
    radiusMiles: radiusRaw === null ? DEFAULT_RADIUS : snapRadius(radiusRaw),
    label: (sp.get('label') ?? '').trim().slice(0, MAX_LABEL_LENGTH),
    monthKeys: parseMonthKeys(sp.get('months'), today),
    ...parseStay(sp),
  }
}

/**
 * Reads a single-campground scan out of the query string. `lat`/`lng` take precedence, so
 * callers should try `parseNearbyParams` first.
 */
export function parseFacilityParams(
  sp: URLSearchParams,
  today: Date = todayFn(),
): FacilityScanRequest | null {
  const facilityId = finiteNumber(sp.get('facility'))
  if (facilityId === null || !Number.isInteger(facilityId) || facilityId <= 0) return null
  return {
    facilityId,
    monthKeys: parseMonthKeys(sp.get('months'), today),
    ...parseStay(sp),
  }
}

/**
 * The inverse of `parseNearbyParams`. Months and weekdays ride along in the URL so a
 * shared or reloaded link reproduces the scan it describes, rather than silently picking
 * up whatever settings the viewer happens to have.
 */
export function buildNearbyParams(req: NearbyScanRequest): string {
  const sp = new URLSearchParams({
    lat: req.lat.toFixed(5),
    lng: req.lng.toFixed(5),
    radius: String(req.radiusMiles),
    months: req.monthKeys.join(','),
    arrive: req.arrivalDays.join(','),
    nights: String(req.nights),
  })
  if (req.label) sp.set('label', req.label)
  return sp.toString()
}

/** The query string for scanning one saved campground with the current settings. */
export function buildFacilityParams(req: FacilityScanRequest): string {
  return new URLSearchParams({
    facility: String(req.facilityId),
    months: req.monthKeys.join(','),
    arrive: req.arrivalDays.join(','),
    nights: String(req.nights),
  }).toString()
}
