// Catalog search — port of com.scouter.data.catalog.CatalogRepository.
// Loads the parks + campgrounds catalog once (large, static-ish dumps) and searches it
// locally: by name with a normalized substring match, or by distance from a point.
// Both are filtered to web-bookable facilities.
import { getFacilities, getPlaces } from '../api/rcApi'
import {
  type GeoPlace,
  haversineMiles,
  type LatLng,
  type NearbyFacility,
  nearestWithin,
  toGeoPlace,
} from './geo'
import type { Facility } from './types'

interface Catalog {
  facilities: Facility[]
  /** Only parks with usable coordinates, so a lookup miss means "not locatable". */
  placeById: Map<number, GeoPlace>
}

let cache: Catalog | null = null
let loading: Promise<Catalog> | null = null

/** Collapse the API's runs of whitespace (names contain padded spaces and CR/LF). */
function cleanName(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function normalize(s: string): string {
  return cleanName(s).toLowerCase()
}

function ensureLoaded(): Promise<Catalog> {
  if (cache) return Promise.resolve(cache)
  if (!loading) {
    loading = (async () => {
      const [places, facilities] = await Promise.all([getPlaces(), getFacilities()])
      const placeName = new Map(places.map((p) => [p.PlaceId, cleanName(p.Name)]))
      const placeById = new Map<number, GeoPlace>()
      for (const p of places) {
        const geo = toGeoPlace(p)
        if (geo) placeById.set(geo.placeId, geo)
      }
      const loaded = facilities
        .filter((f) => f.AllowWebBooking)
        .map((f) => ({
          facilityId: f.FacilityId,
          placeId: f.PlaceId,
          name: cleanName(f.Name),
          parkName: placeName.get(f.PlaceId) ?? '',
        }))
        .sort((a, b) => (a.parkName + a.name).localeCompare(b.parkName + b.name))
      cache = { facilities: loaded, placeById }
      return cache
    })().catch((e) => {
      // Clear the failed attempt here rather than in the caller: otherwise a load kicked
      // off by a search would leave a rejected promise cached forever, and every later
      // catalog read would fail with it.
      loading = null
      throw e
    })
  }
  return loading
}

/** Eagerly fetch the catalog so later searches filter in memory without a network round-trip. */
export function preloadCatalog(): void {
  void ensureLoaded().catch(() => {
    // Already reset by ensureLoaded; swallow so this stays fire-and-forget.
  })
}

/** Returns campgrounds whose (normalized) name or park name contains `query`. Empty query → empty. */
export async function searchFacilities(query: string, limit = 200): Promise<Facility[]> {
  const q = normalize(query)
  if (!q) return []
  const { facilities } = await ensureLoaded()
  return facilities
    .filter((f) => normalize(f.name).includes(q) || normalize(f.parkName).includes(q))
    .slice(0, limit)
}

/** One campground by id, or null if it's no longer in the catalog. */
export async function facilityById(facilityId: number): Promise<Facility | null> {
  const { facilities } = await ensureLoaded()
  return facilities.find((f) => f.facilityId === facilityId) ?? null
}

/**
 * A park's coordinates, or null when it has none usable. The reference `decorate` checks a
 * campground's own reported position against.
 */
export async function placeLocation(placeId: number): Promise<LatLng | null> {
  const { placeById } = await ensureLoaded()
  const place = placeById.get(placeId)
  return place ? { lat: place.lat, lng: place.lng } : null
}

/**
 * Distance from `center` to each campground's park, keyed by facility id.
 *
 * Unlike `facilitiesNear` this filters nothing — the Where picker searches by name and then
 * annotates whatever it found, so a campground 300 mi away still gets a distance. Parks with
 * no usable coordinates are simply absent from the map.
 */
export async function distancesFrom(center: LatLng): Promise<Map<number, number>> {
  const { facilities, placeById } = await ensureLoaded()
  const out = new Map<number, number>()
  for (const f of facilities) {
    const place = placeById.get(f.placeId)
    if (place) out.set(f.facilityId, haversineMiles(center, place))
  }
  return out
}

/**
 * Every web-bookable campground within `radiusMiles` of `center`, nearest first.
 * Uncapped — trimming to a scannable number is the caller's decision.
 */
export async function facilitiesNear(
  center: LatLng,
  radiusMiles: number,
): Promise<NearbyFacility[]> {
  const { facilities, placeById } = await ensureLoaded()
  return nearestWithin(facilities, placeById, center, radiusMiles)
}
