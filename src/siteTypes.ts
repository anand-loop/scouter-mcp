// The site-type filter, in words rather than ids.
//
// A grid unit's kind is a `UnitCategoryId` — 1, 2, 1008, 1014… — which is the right thing to
// send over the wire and the wrong thing to ask an agent for: nothing in the number says
// "hike-in", so a model has to guess or read the source. The tools take slugs instead and
// this module is the only place the two vocabularies meet.
//
// The ids themselves, and everything a search *does* with them, stay in core/domain/
// siteTypes.ts. Nothing here is a second opinion about what a category means.
import {
  ALL_SITE_TYPES,
  DEFAULT_SITE_TYPES,
  normalizeSiteTypes,
  SITE_TYPES,
  type SiteTypeId,
} from './core/domain/siteTypes'

/**
 * The wire vocabulary, in the order `SITE_TYPES` lists it.
 *
 * Short and guessable rather than faithful to ReserveCalifornia's own names: an agent
 * writing `"rv"` should not have to know the category is called "Hook-up (RV)". The full
 * names are still reported back in `siteTypesPhrase`, so a human reading the answer sees the
 * category as the booking site names it.
 */
export const SITE_TYPE_SLUGS = [
  'standard',
  'group',
  'lodging',
  'hike-in',
  'rv',
  'equestrian',
  'environmental',
  'day-use',
] as const

export type SiteTypeSlug = (typeof SITE_TYPE_SLUGS)[number]

/**
 * Slug → id, positionally against `SITE_TYPES`.
 *
 * Zipped rather than written out as a literal so the two lists cannot silently drift apart:
 * a category added upstream leaves an id with no slug, which siteTypes.test.ts fails on
 * rather than quietly dropping from the filter.
 */
const BY_SLUG = new Map<SiteTypeSlug, SiteTypeId>(
  SITE_TYPE_SLUGS.map((slug, i) => [slug, SITE_TYPES[i]?.id]).filter(
    (pair): pair is [SiteTypeSlug, SiteTypeId] => typeof pair[1] === 'number',
  ),
)

const BY_ID = new Map<SiteTypeId, SiteTypeSlug>([...BY_SLUG].map(([slug, id]) => [id, slug]))

export class SiteTypeError extends Error {}

/**
 * What kinds of site count as a match, defaulting the way the app defaults.
 *
 * An omitted argument is `DEFAULT_SITE_TYPES` — everything you can sleep in, day use
 * excluded. That is the app's default too, and it is the point of the filter: a picnic-area
 * reservation is not a campsite, and reporting one as an opening sends someone to book a
 * table. An agent that genuinely wants day use asks for it by name.
 *
 * An explicitly empty list is rejected rather than honoured. The app treats empty as a state
 * to prompt about, but a tool call has nobody to prompt: it describes a search that checks
 * nothing and can only be a mistake — the same reading `arrivalDays: []` gets in search.ts.
 */
export function resolveSiteTypes(slugs?: string[]): SiteTypeId[] {
  if (slugs === undefined) return [...DEFAULT_SITE_TYPES]
  if (slugs.length === 0) {
    throw new SiteTypeError(
      `siteTypes cannot be empty — it would exclude every site. Omit it for everything you can sleep in, or name some of: ${SITE_TYPE_SLUGS.join(', ')}.`,
    )
  }
  const ids: SiteTypeId[] = []
  const unknown: string[] = []
  for (const slug of slugs) {
    const id = BY_SLUG.get(slug.trim().toLowerCase() as SiteTypeSlug)
    if (id === undefined) unknown.push(slug)
    else ids.push(id)
  }
  if (unknown.length > 0) {
    throw new SiteTypeError(
      `Unknown site type${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}. Valid: ${SITE_TYPE_SLUGS.join(', ')}.`,
    )
  }
  // normalizeSiteTypes dedupes and puts the set in its one canonical order, so two calls
  // naming the same types produce the same settings — and the same shareUrl.
  return normalizeSiteTypes(ids)
}

/** The same set on the way back out, so a caller reads its filter in the words it sent. */
export function siteTypeSlugs(ids: readonly SiteTypeId[]): SiteTypeSlug[] {
  return ids.map((id) => BY_ID.get(id)).filter((s): s is SiteTypeSlug => s !== undefined)
}

/** Every id the slugs cover — what a test compares against `ALL_SITE_TYPES`. */
export const SLUGGED_IDS: SiteTypeId[] = ALL_SITE_TYPES.filter((id) => BY_ID.has(id))
