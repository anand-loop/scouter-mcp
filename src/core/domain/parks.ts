// The map keys results a third way: by park.
//
// A park holds several campgrounds — up to sixteen — so one pin per campground would stack
// them on the same coordinates. The map therefore pins parks, labelled with how many of
// their campgrounds have openings, and defers the campground list to a sheet.
import type { LatLng } from './geo'
import { type CampgroundGroup, groupByCampground } from './nights'
import type { CampgroundAvailability, SavedCampground } from './types'

/** A campground that was checked and had nothing open. */
export interface ClosedCampground {
  campground: SavedCampground
  distanceMiles?: number
}

/** A park and the rows or groups belonging to it, for a park-headed list section. */
export interface ParkBucket<T> {
  placeId: number
  parkName: string
  /** Nearest member's distance. Undefined for a scan with no search centre. */
  nearestMiles?: number
  items: T[]
}

/**
 * Buckets anything that carries a campground under that campground's park, nearest park
 * first. Both result views want this: a radius scan routinely returns four campgrounds from
 * one park, and listing them as peers of somewhere thirty miles away spends each row's best
 * line restating the row above.
 *
 * Input order is preserved inside a bucket, so the caller's sort survives the grouping —
 * most-dates-first from `groupByCampground`, nearest-first from `groupByNight`. Parks
 * themselves go by their closest campground, which is the one ordering that reads the same
 * in both views.
 */
export function byPark<T extends { campground: SavedCampground; distanceMiles?: number }>(
  items: T[],
): ParkBucket<T>[] {
  const buckets = new Map<number, ParkBucket<T>>()
  for (const item of items) {
    const { placeId, parkName } = item.campground
    const bucket = buckets.get(placeId) ?? { placeId, parkName, items: [] }
    bucket.items.push(item)
    if (
      item.distanceMiles !== undefined &&
      (bucket.nearestMiles === undefined || item.distanceMiles < bucket.nearestMiles)
    ) {
      bucket.nearestMiles = item.distanceMiles
    }
    buckets.set(placeId, bucket)
  }
  // Keyed on placeId rather than name, because two parks can share one. Parks with no
  // distance at all — a single-campground scan — sort last rather than into whatever order
  // NaN comparisons happen to produce.
  return [...buckets.values()].sort(
    (a, b) => (a.nearestMiles ?? Infinity) - (b.nearestMiles ?? Infinity),
  )
}

export interface ParkGroup {
  placeId: number
  parkName: string
  /** Centre of the park's mappable campgrounds. */
  location: LatLng
  /** Campgrounds here with something open, best-offering first. */
  open: CampgroundGroup[]
  /**
   * Campgrounds here that were checked and had nothing. Carried in full rather than counted,
   * because they are still worth saving for a later search — which is the one thing the
   * sheet can offer for a park that has nothing to offer.
   */
  closed: ClosedCampground[]
}

/**
 * Parks with at least one mappable campground, whether or not anything is open there.
 *
 * A park where everything is booked still earns a pin: knowing it was checked and came up
 * empty is information, and its absence would read as "we didn't look".
 */
export function groupByPark(
  slots: ReadonlyArray<CampgroundAvailability | null>,
): ParkGroup[] {
  const openByPark = new Map<number, CampgroundGroup[]>()
  for (const group of groupByCampground(slots)) {
    const list = openByPark.get(group.campground.placeId) ?? []
    list.push(group)
    openByPark.set(group.campground.placeId, list)
  }

  const parks = new Map<number, { name: string; points: LatLng[]; closed: ClosedCampground[] }>()
  for (const item of slots) {
    if (!item?.location) continue
    const { placeId, parkName } = item.campground
    const park = parks.get(placeId) ?? { name: parkName, points: [], closed: [] }
    park.points.push(item.location)
    if (!item.results.some((r) => r.freeSites.length > 0)) {
      park.closed.push({
        campground: item.campground,
        ...(item.distanceMiles !== undefined ? { distanceMiles: item.distanceMiles } : {}),
      })
    }
    parks.set(placeId, park)
  }

  const out: ParkGroup[] = []
  for (const [placeId, park] of parks) {
    if (park.points.length === 0) continue
    out.push({
      placeId,
      parkName: park.name,
      location: {
        lat: park.points.reduce((n, p) => n + p.lat, 0) / park.points.length,
        lng: park.points.reduce((n, p) => n + p.lng, 0) / park.points.length,
      },
      open: openByPark.get(placeId) ?? [],
      closed: park.closed,
    })
  }
  // Busiest parks last, so their pins paint over the quiet ones rather than under them.
  return out.sort((a, b) => a.open.length - b.open.length)
}
