// Resolving "where to look" — the same two answers the app's Where picker offers.
//
// An area (a point and a radius) or one campground on its own. A radius around a single
// campground would mean nothing, which is why the third variant carries no radius, exactly
// as SavedCampgroundWhere doesn't in the web app.
import { facilitiesNear, facilityById } from './core/domain/catalog'
import { DEFAULT_RADIUS, SCAN_CAP, type NearbyFacility } from './core/domain/geo'
import type { ScanTarget } from './core/domain/scanner'
import type { Facility } from './core/domain/types'
import { geocode, regionLabel, type GeocodeResult } from './node/geocode'

export interface WhereArg {
  place?: string
  lat?: number
  lng?: number
  radiusMiles?: number
  facilityId?: number
}

export class WhereError extends Error {}

/** One geocoder candidate, flattened for the wire. */
export interface PlaceMatch {
  label: string
  region: string
  lat: number
  lng: number
  kind: string
}

export type ResolvedWhere =
  | {
      kind: 'area'
      lat: number
      lng: number
      radiusMiles: number
      /** "Big Sur · 50 mi" — how the search names itself. */
      label: string
      /** Present only when a place name was geocoded, so the caller can see the choice. */
      resolvedPlace?: PlaceMatch
      /** The candidates not chosen. An agent that searched the wrong Springfield needs this. */
      otherMatches?: PlaceMatch[]
    }
  | { kind: 'campground'; facility: Facility; label: string }

const match = (r: GeocodeResult): PlaceMatch => ({
  label: r.shortLabel,
  region: regionLabel(r),
  lat: r.lat,
  lng: r.lng,
  kind: r.kind,
})

export async function resolveWhere(where: WhereArg, signal?: AbortSignal): Promise<ResolvedWhere> {
  const forms = [
    where.facilityId !== undefined,
    where.place !== undefined,
    where.lat !== undefined || where.lng !== undefined,
  ].filter(Boolean).length

  if (forms === 0) {
    throw new WhereError('where needs one of: place, lat+lng, or facilityId.')
  }
  if (forms > 1) {
    throw new WhereError(
      'where takes exactly one of place, lat+lng, or facilityId — together they describe different searches.',
    )
  }

  if (where.facilityId !== undefined) {
    const facility = await facilityById(where.facilityId)
    if (!facility) {
      throw new WhereError(
        `No web-bookable campground with facilityId ${where.facilityId}. Use find_campground to look one up by name.`,
      )
    }
    return { kind: 'campground', facility, label: facility.name }
  }

  const radiusMiles = radiusOf(where.radiusMiles)

  if (where.place !== undefined) {
    const query = where.place.trim()
    if (!query) throw new WhereError('place cannot be empty.')
    const results = await geocode(query, signal)
    if (results.length === 0) {
      throw new WhereError(
        `Couldn't find "${query}". Try a town, a ZIP, or use find_campground if you meant a campground by name.`,
      )
    }
    const [best, ...rest] = results
    return {
      kind: 'area',
      lat: best.lat,
      lng: best.lng,
      radiusMiles,
      label: `${best.shortLabel} · ${radiusMiles} mi`,
      resolvedPlace: match(best),
      otherMatches: rest.map(match),
    }
  }

  const { lat, lng } = where
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    throw new WhereError('lat and lng must be given together.')
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new WhereError(`lat/lng out of range: ${lat}, ${lng}`)
  }
  return { kind: 'area', lat, lng, radiusMiles, label: `${lat.toFixed(3)}, ${lng.toFixed(3)} · ${radiusMiles} mi` }
}

/**
 * Any positive radius is honoured, unlike the app.
 *
 * The web UI snaps to its five offered options because it has to render one as selected;
 * a tool argument has no such constraint, and an agent asking for 30 miles means 30.
 */
function radiusOf(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_RADIUS
  if (!Number.isFinite(raw) || raw <= 0) throw new WhereError(`radiusMiles must be positive, got ${raw}`)
  return Math.min(raw, 200)
}

export interface Coverage {
  /** Exactly what runScan consumes, built the same way AvailabilityScreen builds it. */
  targets: ScanTarget[]
  /** How many the radius actually holds, before the cap. */
  found: number
  capped: boolean
}

/**
 * The campgrounds a resolved `where` covers, nearest first and capped.
 *
 * The cap is the app's SCAN_CAP: each campground costs ~4 grid requests at ~61 KB, so 40 is
 * roughly 10 MB and ten seconds. `found` is reported separately so a truncated scan can
 * never pass for a complete one.
 */
export async function coverageFor(where: ResolvedWhere, max = SCAN_CAP): Promise<Coverage> {
  if (where.kind === 'campground') {
    return { targets: [{ campground: where.facility }], found: 1, capped: false }
  }
  const near = await facilitiesNear({ lat: where.lat, lng: where.lng }, where.radiusMiles)
  const limit = Math.max(1, Math.min(max, SCAN_CAP))
  return {
    // fallbackLocation is the park's point, used when a grid response omits the
    // campground's own coordinates — same as the web app.
    targets: near.slice(0, limit).map((n) => ({
      campground: n.facility,
      distanceMiles: n.distanceMiles,
      fallbackLocation: { lat: n.place.lat, lng: n.place.lng },
    })),
    found: near.length,
    capped: near.length > limit,
  }
}

/** The unscanned view of the same coverage, for list_campgrounds. */
export async function nearbyFor(where: ResolvedWhere): Promise<NearbyFacility[]> {
  if (where.kind !== 'area') {
    throw new WhereError('list_campgrounds needs an area — a place or lat/lng, not a facilityId.')
  }
  return facilitiesNear({ lat: where.lat, lng: where.lng }, where.radiusMiles)
}
