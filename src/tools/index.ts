// Every tool, registered on one server.
//
// Each handler is thin on purpose: resolve the arguments, call into the ported pipeline,
// shape the answer. The interesting decisions live in search.ts, where.ts and shape.ts, so
// they can be tested without a transport.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { availabilityFor, targetDates } from '../core/domain/availability'
import { searchFacilities } from '../core/domain/catalog'
import { addDays, isoDate, today } from '../core/domain/dates'
import { estimateScan } from '../core/domain/estimate'
import { buildFacilityParams, buildNearbyParams } from '../core/domain/geo'
import { byPark } from '../core/domain/parks'
import { runScan } from '../core/domain/scanner'
import { isNightCount } from '../core/domain/stay'
import type { CampgroundAvailability } from '../core/domain/types'
import { geocode, regionLabel } from '../node/geocode'
import { normalizeWhen, WhenError } from '../search'
import { bookingUrl, summarize, tagsFor } from '../shape'
import { resolveSiteTypes, siteTypeSlugs } from '../siteTypes'
import { coverageFor, nearbyFor, resolveWhere, WhereError } from '../where'
import { maxCampgroundsShape, siteTypesShape, whenShape, whereShape } from './schemas'

/** JSON in the content block. MCP clients read text; an agent reads JSON out of it fine. */
function json(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

/**
 * A failed tool call is an error the *model* should see and act on, not a protocol fault —
 * hence isError rather than a thrown exception. Argument mistakes come back as prose
 * telling the agent what to send instead.
 */
function fail(err: unknown): CallToolResult {
  const message =
    err instanceof WhenError || err instanceof WhereError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err)
  return { content: [{ type: 'text', text: message }], isError: true }
}

/** The web app's own link for a scan, when this server knows where the app is deployed. */
function shareUrl(params: string): string | undefined {
  const base = process.env.SCOUTER_WEB_URL
  return base ? `${base.replace(/\/$/, '')}/availability?${params}` : undefined
}

export function registerTools(server: McpServer): void {
  server.registerTool(
    'geocode_place',
    {
      title: 'Geocode a place',
      description:
        'Turn a town, ZIP or address into coordinates for use with the other tools. Returns matches most-specific first — a county centroid can sit far from the town of the same name, so check the region before scanning.',
      inputSchema: {
        query: z.string().describe('A US place name, ZIP or address.'),
        limit: z.number().int().optional().describe('How many matches to return. Default 5.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, limit }, extra) => {
      try {
        const results = await geocode(query, extra.signal)
        return json({
          query,
          matches: results.slice(0, limit ?? 5).map((r) => ({
            label: r.shortLabel,
            region: regionLabel(r),
            lat: r.lat,
            lng: r.lng,
            kind: r.kind,
          })),
        })
      } catch (err) {
        return fail(err)
      }
    },
  )

  server.registerTool(
    'find_campground',
    {
      title: 'Find a campground by name',
      description:
        'Search the ReserveCalifornia catalog by campground or park name to get a facilityId, which find_availability and get_sites take to scan one specific campground.',
      inputSchema: {
        query: z.string().describe('Part of a campground or park name, e.g. "Kirby Cove".'),
        limit: z.number().int().optional().describe('Maximum matches. Default 20.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, limit }) => {
      try {
        const found = await searchFacilities(query, limit ?? 20)
        return json({
          query,
          matches: found.map((f) => ({
            facilityId: f.facilityId,
            name: f.name,
            parkName: f.parkName,
            bookingUrl: bookingUrl(f.placeId, f.facilityId),
          })),
        })
      } catch (err) {
        return fail(err)
      }
    },
  )

  server.registerTool(
    'list_campgrounds',
    {
      title: 'List campgrounds near a place',
      description:
        'Which campgrounds are within a radius, grouped under their park and nearest first. Catalog-only — no availability is checked and nothing is fetched, so this is instant and free. Use it to scope a search before paying for a scan.',
      inputSchema: whereShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args, extra) => {
      try {
        const where = await resolveWhere(args, extra.signal)
        const near = await nearbyFor(where)
        const buckets = byPark(
          near.map((n) => ({ campground: n.facility, distanceMiles: n.distanceMiles })),
        )
        return json({
          where: where.label,
          resolvedPlace: where.kind === 'area' ? where.resolvedPlace : undefined,
          otherMatches: where.kind === 'area' ? where.otherMatches : undefined,
          total: near.length,
          parks: buckets.map((b) => ({
            parkName: b.parkName,
            placeId: b.placeId,
            nearestMiles: b.nearestMiles === undefined ? undefined : Math.max(1, Math.round(b.nearestMiles)),
            campgrounds: b.items.map((i) => ({
              facilityId: i.campground.facilityId,
              name: i.campground.name,
              miles: i.distanceMiles === undefined ? undefined : Math.max(1, Math.round(i.distanceMiles)),
            })),
          })),
        })
      } catch (err) {
        return fail(err)
      }
    },
  )

  server.registerTool(
    'estimate_search',
    {
      title: 'Estimate what a search will cost',
      description:
        'How many campgrounds and arrival dates a find_availability call would cover, and roughly how long it would take and how much data it would pull. Catalog-only, so it costs nothing. Worth calling before a wide radius over several months.',
      inputSchema: { ...whereShape, ...whenShape, ...maxCampgroundsShape, ...siteTypesShape },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args, extra) => {
      try {
        const where = await resolveWhere(args, extra.signal)
        // The site-type filter costs nothing here — it narrows what counts as a match, not
        // what is fetched — but it is echoed back so the estimate names the same search.
        const when = normalizeWhen(args, today(), resolveSiteTypes(args.siteTypes))
        const { targets, found, capped } = await coverageFor(where, args.maxCampgrounds)
        const dates = targetDates(today(), when.settings.monthKeys, when.settings.arrivalDays)
        const cost = estimateScan(targets.length, when.settings.monthKeys, today(), when.settings.nights)
        return json({
          where: where.label,
          from: when.from,
          to: when.to,
          nights: when.settings.nights,
          arrivalDays: when.settings.arrivalDays,
          siteTypes: siteTypeSlugs(when.settings.siteTypes),
          campgrounds: targets.length,
          found,
          truncated: capped
            ? `${found} campgrounds are in range; only the nearest ${targets.length} would be scanned.`
            : undefined,
          // Dates before the range trim, which is what the scan actually walks.
          datesChecked: dates.filter((d) => when.byMonth || (d >= when.from && d <= when.to)).length,
          ...cost,
        })
      } catch (err) {
        return fail(err)
      }
    },
  )

  server.registerTool(
    'find_availability',
    {
      title: 'Find open campsites',
      description:
        "The main tool. Scans campgrounds for arrival dates where one site is free for the whole stay — not merely 'something was free each night', which counts stays nobody can book. Returns open dates and per-campground counts, grouped under their park; nextOpen is the soonest. Day-use areas are not counted as campsites unless siteTypes asks for them. Site numbers are deliberately omitted: call get_sites once you know which campground and date you want. A wide radius over several months takes ~10 seconds.",
      inputSchema: { ...whereShape, ...whenShape, ...maxCampgroundsShape, ...siteTypesShape },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args, extra) => {
      try {
        const where = await resolveWhere(args, extra.signal)
        const when = normalizeWhen(args, today(), resolveSiteTypes(args.siteTypes))
        const { targets, found, capped } = await coverageFor(where, args.maxCampgrounds)

        if (targets.length === 0) {
          return json({
            where: where.label,
            scanned: { campgrounds: 0, found: 0, withOpenings: 0, failed: 0 },
            nextOpen: null,
            openDates: [],
            parks: [],
            note: `No campgrounds within ${where.kind === 'area' ? where.radiusMiles : 0} mi. Widen radiusMiles, or use list_campgrounds to see what is out there.`,
          })
        }

        const dates = targetDates(today(), when.settings.monthKeys, when.settings.arrivalDays)
        const inRange = dates.filter((d) => when.byMonth || (d >= when.from && d <= when.to))
        if (inRange.length === 0) {
          return json({
            where: where.label,
            nextOpen: null,
            openDates: [],
            parks: [],
            note: `No arrival dates match. Between ${when.from} and ${when.to} there are no days falling on arrivalDays ${JSON.stringify(when.settings.arrivalDays)}.`,
          })
        }

        // Fixed-length and filled by index: the worker pool finishes out of order, and
        // targets are sorted by distance, so this keeps nearest-first ordering.
        const slots: Array<CampgroundAvailability | null> = new Array(targets.length).fill(null)
        const token = extra._meta?.progressToken
        let done = 0

        await runScan(targets, when.settings, {
          signal: extra.signal,
          onResult: (index, result) => {
            slots[index] = result
            done += 1
            // A silent ten-second call is indistinguishable from a hang, so report progress
            // when the client asked for it. Failures here must never fail the scan.
            if (token !== undefined) {
              void extra
                .sendNotification({
                  method: 'notifications/progress',
                  params: { progressToken: token, progress: done, total: targets.length },
                })
                .catch(() => {})
            }
          },
        })

        const params =
          where.kind === 'area'
            ? buildNearbyParams({
                lat: where.lat,
                lng: where.lng,
                radiusMiles: where.radiusMiles,
                label: where.resolvedPlace?.label ?? '',
                monthKeys: when.settings.monthKeys,
                arrivalDays: when.settings.arrivalDays,
                nights: when.settings.nights,
                // Without this the link would open the web app on a wider search than the
                // one being reported — the same dates, but counting day-use areas.
                siteTypes: when.settings.siteTypes,
              })
            : buildFacilityParams({
                facilityId: where.facility.facilityId,
                monthKeys: when.settings.monthKeys,
                arrivalDays: when.settings.arrivalDays,
                nights: when.settings.nights,
                siteTypes: when.settings.siteTypes,
              })

        return json(
          summarize(slots, where, when, {
            found,
            capped,
            datesChecked: inRange.length,
            shareUrl: shareUrl(params),
          }),
        )
      } catch (err) {
        return fail(err)
      }
    },
  )

  server.registerTool(
    'get_sites',
    {
      title: 'List the sites free on a date',
      description:
        'The drill-down from find_availability: which specific sites are free at one campground for a stay starting on one date. Pass the same nights and siteTypes the search used — a site free for one night need not be free for two, and a different filter gives a different count.',
      inputSchema: {
        facilityId: z.number().int().describe('From find_availability or find_campground.'),
        date: z.string().describe('Arrival date, YYYY-MM-DD.'),
        nights: z.number().int().optional().describe('Consecutive nights, 1-3. Default 1.'),
        ...siteTypesShape,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ facilityId, date, nights, siteTypes }, extra) => {
      try {
        const where = await resolveWhere({ facilityId }, extra.signal)
        if (where.kind !== 'campground') throw new WhereError('Expected a campground.')
        const stay = nights ?? 1
        if (!isNightCount(stay)) throw new WhenError(`nights must be 1, 2 or 3, got ${nights}`)

        // One month, one campground: the scan is bounded to the date being asked about.
        // The filter defaults exactly as find_availability's does — a drill-down that
        // counted day-use sites the summary had excluded would contradict the number that
        // sent the agent here.
        const when = normalizeWhen(
          { from: date, to: date, nights: stay },
          today(),
          resolveSiteTypes(siteTypes),
        )
        const result = await availabilityFor(where.facility, when.settings, today(), extra.signal)
        if (result.error) throw new Error(`${where.facility.name}: ${result.error}`)

        const match = result.results.find((r) => r.date === date)
        if (!match) {
          throw new WhenError(
            `${date} is not an arrival date this scan covers — it may already be past, or beyond the booking horizon.`,
          )
        }

        // addDays on a local midnight, formatted locally — going through toISOString here
        // would report the wrong day for anyone east of Greenwich.
        const checkout = addDays(new Date(`${date}T00:00:00`), stay)

        const tags = tagsFor(result)

        return json({
          campground: where.facility.name,
          park: where.facility.parkName,
          facilityId,
          ...(tags.length > 0 ? { tags } : {}),
          ...(result.maxVehicleLength ? { maxVehicleLength: result.maxVehicleLength } : {}),
          date,
          nights: stay,
          siteTypes: siteTypeSlugs(when.settings.siteTypes),
          checkout: isoDate(checkout),
          siteCount: match.freeSites.length,
          sites: match.freeSites.map((s) => ({ unitId: s.unitId, site: s.label })),
          bookingUrl: bookingUrl(where.facility.placeId, facilityId),
          note: 'ReserveCalifornia booking URLs are campground-level and cannot preselect a night; pick the dates once there.',
        })
      } catch (err) {
        return fail(err)
      }
    },
  )
}
