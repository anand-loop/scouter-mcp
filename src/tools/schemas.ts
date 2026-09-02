// The wire schemas, and the two argument shapes shared across tools.
//
// Zod validates the shape; the ported domain validates the meaning (isMonthKey, isNightCount,
// normalizeDays) inside search.ts and where.ts. Keeping those apart matters: MonthKey is a
// bare string alias upstream, so nothing but a call to isMonthKey will catch "2026-13".
import { z } from 'zod'
import { DEFAULT_RADIUS, SCAN_CAP } from '../core/domain/geo'
import { SITE_TYPE_SLUGS } from '../siteTypes'

export const whereShape = {
  place: z
    .string()
    .optional()
    .describe('A town, ZIP or address to search around, e.g. "Big Sur" or "95060". Geocoded; the response reports which match was used and lists the others.'),
  lat: z.number().optional().describe('Latitude, given together with lng instead of place.'),
  lng: z.number().optional().describe('Longitude, given together with lat instead of place.'),
  radiusMiles: z
    .number()
    .optional()
    .describe(`How far around the point to look. Default ${DEFAULT_RADIUS}. Ignored with facilityId.`),
  facilityId: z
    .number()
    .int()
    .optional()
    .describe('Search one specific campground instead of an area. Get one from find_campground.'),
}

export const whenShape = {
  from: z
    .string()
    .optional()
    .describe('Earliest arrival date, YYYY-MM-DD. Defaults to today.'),
  to: z
    .string()
    .optional()
    .describe('Latest arrival date, YYYY-MM-DD. Defaults to the end of the ~4-month booking horizon, which is as far ahead as the reservation system has anything to say.'),
  months: z
    .array(z.string())
    .optional()
    .describe('Whole calendar months to search, ["2026-09"]. An alternative to from/to, not a companion to it.'),
  arrivalDays: z
    .array(z.number().int())
    .optional()
    .describe('Weekdays you could arrive on, Monday=1 through Sunday=7. Omit for any day.'),
  nights: z
    .number()
    .int()
    .optional()
    .describe('Consecutive nights the same site must be free: 1, 2 or 3. Defaults to 1 — a longer stay is a strictly narrower search.'),
}

export const maxCampgroundsShape = {
  maxCampgrounds: z
    .number()
    .int()
    .optional()
    .describe(`Cap on campgrounds scanned, nearest first. Default and maximum ${SCAN_CAP}.`),
}

/**
 * What kinds of site count as a match.
 *
 * An enum rather than free text or the raw `UnitCategoryId`s: the allowed values travel with
 * the schema, so an agent reads them off the tool definition instead of guessing that
 * hike-in sites are category 1014.
 *
 * Omitted means everything you can sleep in. Day use has to be asked for by name, because
 * "Weber Point Picnic Area, 1 site free" is not an answer to "where can I camp?" — and an
 * agent that can't tell the two apart will happily report it as one.
 */
export const siteTypesShape = {
  siteTypes: z
    .array(z.enum(SITE_TYPE_SLUGS))
    .optional()
    .describe(
      'Which kinds of site count as a match. Defaults to everything you can sleep in — day use is excluded unless you name it.',
    ),
}
