// Turns scan results inside out: from campground → its open dates, into date → the
// campgrounds free that night.
//
// That inversion is the redesign's whole point. People arrive asking "which nights work?",
// and the old shape made them cross-reference a card per campground to answer it.
import type { IsoDate } from './dates'
import type { CampgroundAvailability, StayResult, SavedCampground } from './types'

export interface NightRow {
  /**
   * Index into the scan's `targets`/`slots`. It's the handle a retry needs, and the only
   * key guaranteed unique — a hand-edited watchlist could hold a duplicate facilityId.
   */
  index: number
  campground: SavedCampground
  /** Absent for watchlist and single-campground scans, which have no search centre. */
  distanceMiles?: number
  /** The very same StayResult object, so a row and its sheet cannot disagree. */
  result: StayResult
}

export interface NightGroup {
  /** yyyy-MM-dd — sorts lexicographically, which is also chronologically. */
  date: IsoDate
  /**
   * The campgrounds free that night. There is deliberately no count field: the "N open"
   * badge renders `rows.length` beside the very list it labels, so it cannot drift.
   */
  rows: NightRow[]
}

export function hasOpenings(item: CampgroundAvailability): boolean {
  return item.results.some((r) => r.freeSites.length > 0)
}

export function openNightCount(item: CampgroundAvailability): number {
  return item.results.filter((r) => r.freeSites.length > 0).length
}

/**
 * Every night with at least one opening, ascending, each listing the campgrounds free then.
 *
 * Takes the slot array *including* its nulls: a null is a campground still being scanned,
 * and the position is the retry handle. Campgrounds that errored carry `results: []` (see
 * `availabilityFor`), so they contribute nothing and can never conjure an empty group.
 */
export function groupByNight(
  slots: ReadonlyArray<CampgroundAvailability | null>,
): NightGroup[] {
  const byDate = new Map<IsoDate, NightRow[]>()

  slots.forEach((item, index) => {
    if (!item) return
    for (const result of item.results) {
      if (result.freeSites.length === 0) continue
      const rows = byDate.get(result.date) ?? []
      rows.push({
        index,
        campground: item.campground,
        ...(item.distanceMiles !== undefined ? { distanceMiles: item.distanceMiles } : {}),
        result,
      })
      byDate.set(result.date, rows)
    }
  })

  return [...byDate.keys()].sort().map((date) => ({
    date,
    // Nearest first. Sorting on distance *alone* is deliberate: Array#sort is stable
    // (required since ES2019), so ties keep the caller's order — which is park-then-name
    // for a radius scan and the user's own ordering for a watchlist. Adding a tiebreaker
    // here would quietly destroy both.
    rows: byDate.get(date)!.sort(
      (a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity),
    ),
  }))
}

export interface CampgroundGroup {
  /** Slot index — the retry handle and a unique React key, as in NightRow. */
  index: number
  campground: SavedCampground
  distanceMiles?: number
  /**
   * Open nights, ascending — the same StayResult objects the scan produced, so a pill,
   * its site count and the sheet it opens all read from one place. Never empty: a
   * campground with nothing open isn't a group.
   */
  nights: StayResult[]
}

/**
 * The same results keyed the other way: one group per campground, listing its open nights.
 *
 * Ordered by how much a campground has to offer — most nights first, nearest breaking the
 * tie — rather than by distance alone. Sorting this view by distance would bury the
 * campground that's open every weekend behind one that's open once and slightly closer.
 */
export function groupByCampground(
  slots: ReadonlyArray<CampgroundAvailability | null>,
): CampgroundGroup[] {
  const out: CampgroundGroup[] = []
  slots.forEach((item, index) => {
    if (!item) return
    const nights = item.results.filter((r) => r.freeSites.length > 0)
    if (nights.length === 0) return
    out.push({
      index,
      campground: item.campground,
      ...(item.distanceMiles !== undefined ? { distanceMiles: item.distanceMiles } : {}),
      nights: [...nights].sort((a, b) => a.date.localeCompare(b.date)),
    })
  })
  return out.sort(
    (a, b) =>
      b.nights.length - a.nights.length ||
      (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity),
  )
}

/**
 * The row shape the site sheet expects, built from a campground group and one of its
 * nights. Goes through one function so both groupings hand the sheet identical input.
 */
export function nightRowFor(group: CampgroundGroup, night: StayResult): NightRow {
  return {
    index: group.index,
    campground: group.campground,
    ...(group.distanceMiles !== undefined ? { distanceMiles: group.distanceMiles } : {}),
    result: night,
  }
}

/** Slot indices of campgrounds whose lookup failed, for a batched retry. */
export function failures(slots: ReadonlyArray<CampgroundAvailability | null>): number[] {
  const out: number[] = []
  slots.forEach((item, index) => {
    if (item?.error) out.push(index)
  })
  return out
}

/** "4 sites" — what the row is actually reporting, so it sits on its own. */
export function siteLabel(row: NightRow): string {
  const sites = row.result.freeSites.length
  return `${sites} ${sites === 1 ? 'site' : 'sites'}`
}

/**
 * The line under a campground name in a night's list — the distance, and nothing else.
 *
 * Empty under a park heading, which has already given the distance for the whole section,
 * and empty again for a scan with no centre to measure from; the caller renders nothing
 * rather than a blank line. The park name is never here for the same reason as in
 * `campgroundMeta`: saying it once per section instead of once per row is the entire point
 * of grouping by park.
 */
export function rowMeta(row: NightRow, opts: { distance?: boolean } = {}): string {
  const { distance = true } = opts
  if (!distance || row.distanceMiles === undefined) return ''
  return formatDistance(row.distanceMiles)
}

// Exported rather than geo.ts's formatMiles: every meta line in the results list wants whole
// miles at 12px, where "0.4 mi" reads as noise next to a park name — and a park heading that
// rounded differently from the rows under it would look like two different measurements.
export function formatDistance(mi: number): string {
  return `${Math.max(1, Math.round(mi))} mi`
}
