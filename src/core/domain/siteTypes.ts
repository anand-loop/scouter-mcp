// What kind of site counts as a match.
//
// Every unit in a grid response carries a `UnitCategoryId`. ReserveCalifornia's own
// /rdr/search/filters endpoint publishes the vocabulary — eight categories for California —
// and these ids are stable enough to hardcode: they are shared across every UseDirect state
// and the list has not moved in the type table. Hardcoding also keeps the app to the two
// catalog fetches it already makes, which is the same call `RADIUS_OPTIONS` and
// `NIGHT_OPTIONS` make about their own short lists.
//
// What a search *does* with a category lives in availability.ts; this file is the vocabulary
// and the rules for reading a stored or URL-borne set, in the shape days.ts and stay.ts use.
import { joinWithAmpersand } from './whenLabel'

/** A `UnitCategoryId` as the grid reports it. */
export type SiteTypeId = number

export interface SiteType {
  id: SiteTypeId
  name: string
  /** The line under the name — what the category actually gets you. */
  sub: string
}

/**
 * The eight categories California offers, in the order the filter screen lists them:
 * the ones most people are looking for first, day use last.
 *
 * A ninth exists in the unit-type table — 1010, boat slips and docks — but ReserveCalifornia
 * omits it from its own filter list, and no web-bookable California facility uses it. A row
 * that can never match anything is worse than a missing one, so it isn't offered.
 */
export const SITE_TYPES: readonly SiteType[] = [
  { id: 1, name: 'Standard campsite', sub: 'Drive-up tent or small trailer' },
  { id: 2, name: 'Group', sub: 'One booking, many tents' },
  { id: 1008, name: 'Lodging', sub: 'Cabins, yurts, tent cabins' },
  { id: 1014, name: 'Hike-in / bike-in / boat-in', sub: 'No road access' },
  { id: 1015, name: 'Hook-up (RV)', sub: 'Water, power, or sewer' },
  { id: 1016, name: 'Equestrian', sub: 'Corrals or stock water' },
  { id: 1022, name: 'Environmental', sub: 'Primitive, walk-in' },
  { id: 7, name: 'Day use', sub: 'No overnight stay' },
]

const KNOWN = new Set(SITE_TYPES.map((t) => t.id))

/** Every id, in the order above. */
export const ALL_SITE_TYPES: SiteTypeId[] = SITE_TYPES.map((t) => t.id)

/**
 * Everything you can sleep in.
 *
 * Day use is the only category off by default, and it is the reason the filter exists:
 * a picnic-area reservation is not a campsite, and China Camp reporting "Weber Point Picnic
 * Area" as an opening is the bug this fixes. Every other category is on, so nobody loses a
 * result they were getting before — the filter only ever narrows from a full picture.
 */
export const DEFAULT_SITE_TYPES: SiteTypeId[] = ALL_SITE_TYPES.filter((id) => id !== 7)

export function isSiteTypeId(v: unknown): v is SiteTypeId {
  return typeof v === 'number' && KNOWN.has(v)
}

/**
 * Coerces a stored or URL-borne list into a usable set.
 *
 * Unknown ids are dropped rather than kept: a category we have no label for cannot be shown,
 * so leaving it in would make the filter screen disagree with the search it describes.
 * Order follows `SITE_TYPES` rather than the input, so a set has one canonical spelling and
 * two links choosing the same types produce the same URL.
 *
 * Empty survives, as it does in `normalizeDays` — having turned everything off is a state
 * the UI prompts about rather than an error to repair.
 */
export function normalizeSiteTypes(v: unknown): SiteTypeId[] {
  if (!Array.isArray(v)) return []
  const picked = new Set(v.filter(isSiteTypeId))
  return ALL_SITE_TYPES.filter((id) => picked.has(id))
}

/** Whether a set leaves nothing out — the case worth saying nothing about. */
export function isEverySiteType(ids: SiteTypeId[]): boolean {
  return ids.length === ALL_SITE_TYPES.length
}

/** Whether a set is what a search gets when it says nothing about site types. */
export function isDefaultSiteTypes(ids: SiteTypeId[]): boolean {
  return (
    ids.length === DEFAULT_SITE_TYPES.length && DEFAULT_SITE_TYPES.every((id) => ids.includes(id))
  )
}

/**
 * The Home row's value: "All site types" · "No site types" · "5 site types".
 *
 * Collapsed at both ends the way `arrivalPhrase` collapses to "Any arrival day", because a
 * complete set and an empty one are facts about the search rather than lists to read.
 */
export function siteTypesLabel(ids: SiteTypeId[]): string {
  if (isEverySiteType(ids)) return 'All site types'
  if (ids.length === 0) return 'No site types'
  return `${ids.length} site types`
}

/** The muted half of that row: what the count means. */
export function siteTypesSub(ids: SiteTypeId[]): string {
  if (isEverySiteType(ids)) return 'nothing excluded'
  if (ids.length === 0) return 'pick at least one'
  return `${ALL_SITE_TYPES.length - ids.length} excluded`
}

/**
 * The types named in full, for a criteria line — "Standard campsite & Group".
 *
 * Empty when the set is the default, since that is what a search means when it says nothing,
 * and repeating it on every results header would be noise rather than information.
 */
export function siteTypesPhrase(ids: SiteTypeId[]): string {
  if (isDefaultSiteTypes(ids)) return ''
  if (ids.length === 0) return 'No site types'
  if (isEverySiteType(ids)) return 'Any site type'
  const names = SITE_TYPES.filter((t) => ids.includes(t.id)).map((t) => t.name)
  return joinWithAmpersand(names)
}

/**
 * What a campground is, in a few words — "Group site", "Hike-in only", "RV up to 30 ft".
 *
 * Derived from the categories its units actually report, so every tag is a fact rather than
 * a description someone typed. The design's canvas also shows "Ferry access", "No cars" and
 * "Tables"; no endpoint carries anything of the sort, and inventing them would make the
 * honest tags beside them untrustworthy too.
 *
 * "only" appears where a category is the campground's whole story — a hike-in campground is
 * a different proposition from one with a hike-in loop, and the distinction is exactly what
 * someone deciding whether to drive there needs.
 */
export function siteTypeTags(ids: SiteTypeId[], maxVehicleLength?: number): string[] {
  const has = (id: SiteTypeId) => ids.includes(id)
  const only = (id: SiteTypeId) => ids.length === 1 && ids[0] === id
  const tags: string[] = []

  if (only(7)) tags.push('Day use only')
  else if (has(2)) tags.push(only(2) ? 'Group site' : 'Group sites')

  if (has(1014)) tags.push(only(1014) ? 'Hike-in only' : 'Hike-in sites')
  if (has(1022)) tags.push('Environmental')
  if (has(1016)) tags.push('Equestrian')
  if (has(1008)) tags.push(only(1008) ? 'Cabins & lodging' : 'Lodging')
  // The length is only worth showing where something can actually park: a hike-in
  // campground reporting a vehicle length is reporting a field nobody set.
  if (has(1015)) {
    tags.push(maxVehicleLength ? `RV up to ${maxVehicleLength} ft` : 'RV hook-ups')
  } else if (maxVehicleLength && (has(1) || has(2))) {
    tags.push(`Up to ${maxVehicleLength} ft`)
  }
  return tags
}
