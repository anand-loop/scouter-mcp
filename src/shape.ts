// Turning a scan into something an agent can afford to read.
//
// availabilityFor emits one StayResult per target date whether or not anything is free, so
// a Fri/Sat/Sun scan over two months is ~1,000 results, most of them empty, and serializing
// them with their site lists runs to hundreds of KB. Almost all of the compaction already
// exists upstream and is pure — groupByCampground drops the empties, byPark buckets them —
// so this module's real job is the last step: replacing every site list with its length.
//
// That is the invariant the whole two-tier design rests on, and shape.test.ts asserts it:
// no site label ever leaves find_availability. get_sites is where labels live.
import { groupByCampground, hasOpenings } from './core/domain/nights'
import { byPark } from './core/domain/parks'
import { siteTypesPhrase, siteTypeTags } from './core/domain/siteTypes'
import type { CampgroundAvailability } from './core/domain/types'
import type { NormalizedWhen } from './search'
import { withinRange } from './search'
import { siteTypeSlugs, type SiteTypeSlug } from './siteTypes'
import type { ResolvedWhere } from './where'

export interface OpenDate {
  date: string
  /** How many sites are free for the whole stay. Labels come from get_sites. */
  sites: number
}

export interface CampgroundSummary {
  facilityId: number
  name: string
  miles?: number
  /**
   * What this campground is — "Hike-in only", "RV up to 30 ft" — from the categories its
   * units report. Absent when they say nothing worth a tag.
   *
   * Describes the campground rather than the search: the tags are read from every unit,
   * including the kinds this search filtered out, so "can I get a trailer in?" is answered
   * without a second scan. Omitted when empty rather than sent as [].
   */
  tags?: string[]
  open: OpenDate[]
  bookingUrl: string
}

export interface ParkSummary {
  parkName: string
  placeId: number
  nearestMiles?: number
  campgrounds: CampgroundSummary[]
}

export interface AvailabilitySummary {
  criteria: {
    where: string
    nights: number
    arrivalDays: number[]
    /** The filter that ran, in the words the tool takes — always stated, since it defaults. */
    siteTypes: SiteTypeSlug[]
    /** The same set in ReserveCalifornia's own names. Absent when it is the default one. */
    siteTypesPhrase?: string
    from: string
    to: string
    datesChecked: number
  }
  scanned: { campgrounds: number; found: number; withOpenings: number; failed: number }
  nextOpen: string | null
  openDates: string[]
  parks: ParkSummary[]
  truncated?: string
  errors?: string[]
  shareUrl?: string
  note: string
}

/** The campground-level deep link. The API can't preselect a night, so dates are reported. */
export function bookingUrl(placeId: number, facilityId: number): string {
  return `https://www.reservecalifornia.com/park/${placeId}/${facilityId}`
}

const NOTE =
  'Site numbers omitted. Call get_sites with a facilityId, a date and the same nights to see which sites are free.'

export function summarize(
  slots: ReadonlyArray<CampgroundAvailability | null>,
  where: ResolvedWhere,
  when: NormalizedWhen,
  meta: { found: number; capped: boolean; datesChecked: number; shareUrl?: string },
): AvailabilitySummary {
  // Trim the range form's whole-month overscan before anything is counted or grouped, or
  // the totals would describe a wider search than the caller asked for.
  const trimmed = slots.map((s) => (s ? { ...s, results: withinRange(s.results, when) } : s))

  // groupByCampground already drops every zero-site result and orders most-nights-first;
  // byPark buckets by placeId and orders parks by their nearest campground.
  const groups = groupByCampground(trimmed)
  const parks = byPark(groups).map<ParkSummary>((bucket) => ({
    parkName: bucket.parkName,
    placeId: bucket.placeId,
    nearestMiles: bucket.nearestMiles === undefined ? undefined : round(bucket.nearestMiles),
    campgrounds: bucket.items.map<CampgroundSummary>((g) => {
      // `index` is the group's slot, which is how the campground's own description — its
      // categories and vehicle length — is reached: groupByCampground carries the openings,
      // not the facts about the place they are at.
      const tags = tagsFor(trimmed[g.index])
      return {
        facilityId: g.campground.facilityId,
        name: g.campground.name,
        miles: g.distanceMiles === undefined ? undefined : round(g.distanceMiles),
        ...(tags.length > 0 ? { tags } : {}),
        // The one transformation that matters: a count, never the FreeSite labels.
        open: g.nights.map((n) => ({ date: n.date, sites: n.freeSites.length })),
        bookingUrl: bookingUrl(g.campground.placeId, g.campground.facilityId),
      }
    }),
  }))

  const openDates = [...new Set(groups.flatMap((g) => g.nights.map((n) => n.date)))].sort()

  // Failures are counted and named rather than dropped: a campground that didn't answer is
  // not a campground with nothing free, and an agent that can't tell them apart will report
  // "nothing available" when it doesn't know that.
  const errors = trimmed
    .filter((s): s is CampgroundAvailability => Boolean(s?.error))
    .map((s) => `${s.campground.name}: ${s.error}`)

  return {
    criteria: {
      where: where.label,
      nights: when.settings.nights,
      arrivalDays: when.settings.arrivalDays,
      siteTypes: siteTypeSlugs(when.settings.siteTypes),
      // Empty for the default set — the search everybody gets is not worth a line.
      siteTypesPhrase: siteTypesPhrase(when.settings.siteTypes) || undefined,
      from: when.from,
      to: when.to,
      datesChecked: meta.datesChecked,
    },
    scanned: {
      campgrounds: trimmed.length,
      found: meta.found,
      withOpenings: trimmed.filter((s) => s && hasOpenings(s)).length,
      failed: errors.length,
    },
    nextOpen: openDates[0] ?? null,
    openDates,
    parks,
    truncated: meta.capped
      ? `Scanned the nearest ${trimmed.length} of ${meta.found} campgrounds in range. Narrow radiusMiles to reach past the cap.`
      : undefined,
    errors: errors.length > 0 ? errors : undefined,
    shareUrl: meta.shareUrl,
    note: NOTE,
  }
}

/**
 * What a campground is, in a few words, or nothing when it has said nothing.
 *
 * Shared with get_sites so the drill-down describes the campground exactly as the summary
 * that sent the agent there did.
 */
export function tagsFor(item: CampgroundAvailability | null | undefined): string[] {
  if (!item?.siteTypes) return []
  return siteTypeTags(item.siteTypes, item.maxVehicleLength)
}

/**
 * Whole miles, floored at 1 — the same rounding `formatDistance` renders in the app, so a
 * scan reported through the two surfaces never disagrees by a tenth of a mile.
 */
function round(mi: number): number {
  return Math.max(1, Math.round(mi))
}
