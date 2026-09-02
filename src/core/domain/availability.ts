// Availability computation — direct port of com.scouter.domain.AvailabilityUseCase.
// Computes, for a saved campground, which of the user's selected weekdays over the next
// N months have at least one bookable site free ("any selected night free").
import { getGrid, type GridResponse } from '../api/rcApi'
import { type LatLng, toLatLng } from './geo'
import { parseISO } from 'date-fns'
import {
  addDays,
  isAfter,
  isoDate,
  type IsoDate,
  javaDayOfWeek,
  requestDate,
  today as todayFn,
} from './dates'
import { type MonthKey, monthRanges } from './months'
import { isEverySiteType, type SiteTypeId } from './siteTypes'
import { isWeekday } from './stay'
import type {
  CampgroundAvailability,
  StayResult,
  FreeSite,
  SavedCampground,
  WatchSettings,
} from './types'

/**
 * Days per grid request. **Do not raise this** without re-measuring the endpoint.
 *
 * The grid silently caps what it returns. Ask for up to 22 days and you get a slice per day;
 * ask for more and the response stops at 21 slices per unit — with `EndDate` still echoing
 * the range you asked for, and no error. Measured against facility 767, and not a month
 * boundary effect: windows starting Nov 5 and Dec 1 truncate the same way.
 *
 *   requested 20 → 20 slices     requested 23 → 21 slices
 *   requested 22 → 22 slices     requested 30 → 21 slices
 *
 * That matters more than a missing-data bug usually would, because `sitesFreeForSpan` treats
 * a date the grid never returned as *unavailable* rather than unknown — deliberately, and
 * for good reason, but on the assumption that it is a rare edge at a month boundary. At 30
 * days it was not an edge: every window lost its last nine days, so roughly a third of all
 * arrival dates were reported as fully booked without ever being checked.
 *
 * 21 rather than 22 because 22 is the last value that works and the rule behind the cliff
 * isn't understood; one day over costs two days of silently wrong answers. The extra
 * requests are cheap — a four-month scan goes from four windows per campground to five.
 */
export const WINDOW_DAYS = 21

/** True only when the whole string is an integer (matches Kotlin's String.toIntOrNull). */
function intOrMax(s: string): number {
  return /^-?\d+$/.test(s) ? parseInt(s, 10) : Number.MAX_SAFE_INTEGER
}

/** Sort site labels numerically when possible (e.g. "9" before "10"), else lexically. */
function siteOrder(a: FreeSite, b: FreeSite): number {
  const na = intOrMax(a.label)
  const nb = intOrMax(b.label)
  if (na !== nb) return na - nb
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0
}

/** First value that isn't blank (null/empty/whitespace-only), matching Kotlin's ifBlank chain. */
function firstNonBlank(...vals: string[]): string {
  for (const v of vals) if (v && v.trim() !== '') return v
  return ''
}

/**
 * Every candidate arrival date: days in the selected months falling on `arrivalDay`,
 * ascending, never in the past.
 *
 * Deliberately unpadded — an arrival on the last day of a selected month is still an
 * arrival in that month, even though the stay runs past it. Suppressing those would make
 * the final dates of every month appear and disappear as the night count changed.
 */
export function targetDates(
  today: Date,
  monthKeys: MonthKey[],
  arrivalDays: number[],
): IsoDate[] {
  const wanted = new Set(arrivalDays.filter(isWeekday))
  if (wanted.size === 0) return []
  const out: IsoDate[] = []
  // Ranges are disjoint and ascending, so the output needs no sort or dedupe.
  for (const [start, end] of monthRanges(today, monthKeys)) {
    let day = start
    while (!isAfter(day, end)) {
      if (wanted.has(javaDayOfWeek(day))) out.push(isoDate(day))
      day = addDays(day, 1)
    }
  }
  return out
}

/** Inclusive [start, end] split into contiguous windows of at most `size` days. */
export function windows(start: Date, end: Date, size: number): Array<[Date, Date]> {
  const out: Array<[Date, Date]> = []
  let s = start
  while (!isAfter(s, end)) {
    const candidate = addDays(s, size - 1)
    const e = isAfter(candidate, end) ? end : candidate
    out.push([s, e])
    s = addDays(e, 1)
  }
  return out
}

/**
 * What kinds of site a campground has, and the longest vehicle any of them takes.
 *
 * Read across every window's response because a campground can be partly out of season, and
 * a unit absent from one window may be present in another. Web-bookable only, since a unit
 * nobody can reserve is not a fact about what you can book here.
 */
function describeUnits(responses: GridResponse[]): {
  siteTypes: SiteTypeId[]
  maxVehicleLength: number
} {
  const types = new Set<SiteTypeId>()
  let longest = 0
  for (const response of responses) {
    for (const unit of Object.values(response.Facility?.Units ?? {})) {
      if (!unit.AllowWebBooking) continue
      if (typeof unit.UnitCategoryId === 'number') types.add(unit.UnitCategoryId)
      if (typeof unit.VehicleLength === 'number') longest = Math.max(longest, unit.VehicleLength)
    }
  }
  return { siteTypes: [...types].sort((a, b) => a - b), maxVehicleLength: longest }
}

/**
 * Bookable units free per date in one grid response ("any unit free"). Pure — unit tested.
 *
 * The grid can return multiple slices for the same unit+date (e.g. per rate/occupancy option),
 * so each unit is counted at most once per date.
 *
 * `allowed` is the site-type filter, and this is the only correct place to apply it. A stay
 * is a *unit* free on every night, and `sitesFreeForSpan` establishes that by intersecting
 * these lists on `unitId`. Filtering the finished `StayResult.freeSites` instead would
 * compile, read the same, and quietly report two-night stays that only ever spanned via a
 * unit the user had excluded. Omit it and nothing is filtered.
 */
export function freeSitesByDate(
  response: GridResponse,
  allowed?: ReadonlySet<SiteTypeId>,
): Map<IsoDate, FreeSite[]> {
  const map = new Map<IsoDate, FreeSite[]>()
  const units = response.Facility?.Units ?? {}
  for (const unit of Object.values(units)) {
    if (!unit.AllowWebBooking) continue
    if (allowed && !allowed.has(unit.UnitCategoryId)) continue
    const label = firstNonBlank(unit.ShortName, unit.Name, String(unit.UnitId))
    const freeDates = new Set<IsoDate>()
    for (const slice of Object.values(unit.Slices ?? {})) {
      if (!slice.IsFree || !slice.Date) continue
      const date = slice.Date.slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
      freeDates.add(date)
    }
    for (const date of freeDates) {
      const list = map.get(date) ?? []
      list.push({ unitId: unit.UnitId, label })
      map.set(date, list)
    }
  }
  return map
}

/**
 * The units bookable for a whole stay: free on the arrival night and on every night after.
 *
 * The intersection is by unit, not by count. A reservation is one site for the whole trip,
 * so "something was free each night" is a different and much weaker question — it would
 * report stays nobody can actually book.
 *
 * A date the grid never returned is treated as **unavailable**, not unknown. Promising a
 * stay we couldn't verify is the worse failure, and `monthRanges`' tail padding is what
 * keeps that from being the normal outcome at a month boundary.
 */
export function sitesFreeForSpan(
  freeByDate: ReadonlyMap<IsoDate, FreeSite[]>,
  arrival: IsoDate,
  nights: number,
): FreeSite[] {
  const first = freeByDate.get(arrival)
  if (!first) return []
  // Keyed by unit, which also collapses a unit the grid listed twice for one date.
  const surviving = new Map<number, FreeSite>()
  for (const site of first) surviving.set(site.unitId, site)

  const start = parseISO(arrival)
  for (let n = 1; n < nights && surviving.size > 0; n++) {
    const nightSites = freeByDate.get(isoDate(addDays(start, n)))
    if (!nightSites) return []
    const free = new Set(nightSites.map((s) => s.unitId))
    for (const unitId of [...surviving.keys()]) {
      if (!free.has(unitId)) surviving.delete(unitId)
    }
  }
  // Labels come from the arrival night; a unit's label doesn't change mid-stay.
  return [...surviving.values()]
}

/**
 * Fetches the grid in 30-day windows and returns, for each target weekday date, the
 * bookable sites that are free. Errors are captured on the result rather than thrown.
 *
 * The windows are fetched together — pacing is the shared limiter's job in rcApi, which
 * is the only place that can bound the *aggregate* rate across concurrent campgrounds.
 * `Promise.all` keeps the old semantics: the previous serial loop also abandoned the
 * whole campground on the first failed window.
 */
export async function availabilityFor(
  campground: SavedCampground,
  settings: WatchSettings,
  todayDate: Date = todayFn(),
  signal?: AbortSignal,
): Promise<CampgroundAvailability> {
  const targets = targetDates(todayDate, settings.monthKeys, settings.arrivalDays)
  if (targets.length === 0) return { campground, results: [] }

  try {
    const freeByDate = new Map<IsoDate, FreeSite[]>()
    // Only the selected months are fetched — picking November alone skips August–October.
    // The tail covers the nights after an arrival on a month's last day.
    const wins = monthRanges(todayDate, settings.monthKeys, settings.nights - 1).flatMap(
      ([s, e]) => windows(s, e, WINDOW_DAYS),
    )
    const responses = await Promise.all(
      wins.map(([start, stop]) =>
        getGrid(campground.facilityId, requestDate(start), requestDate(stop), signal),
      ),
    )
    // Undefined rather than a full set when nothing is excluded, so the common search does
    // no per-unit lookups at all.
    const allowed =
      settings.siteTypes && !isEverySiteType(settings.siteTypes)
        ? new Set(settings.siteTypes)
        : undefined
    for (const response of responses) {
      for (const [date, sites] of freeSitesByDate(response, allowed)) {
        const list = freeByDate.get(date) ?? []
        list.push(...sites)
        freeByDate.set(date, list)
      }
    }
    // `freeByDate` must stay whole here: sitesFreeForSpan reads the nights *after* each
    // arrival, and they are not themselves arrival dates. Filtering it down to `targets`
    // first would compile fine and quietly return fewer stays.
    const results: StayResult[] = targets.map((date) => ({
      date,
      freeSites: sitesFreeForSpan(freeByDate, date, settings.nights).sort(siteOrder),
    }))
    // What this campground *is*, read from every unit rather than the ones that survived the
    // filter: its tags describe the campground, not the search that happened to find it.
    const { siteTypes, maxVehicleLength } = describeUnits(responses)

    // The grid carries the campground's own coordinates, which beat the park centroid it
    // would otherwise be plotted at — by up to a couple of miles.
    let location: LatLng | undefined
    for (const r of responses) {
      const point = toLatLng(r.Facility?.Latitude, r.Facility?.Longitude)
      if (point) {
        location = point
        break
      }
    }
    return {
      campground,
      results,
      siteTypes,
      ...(maxVehicleLength ? { maxVehicleLength } : {}),
      ...(location ? { location } : {}),
    }
  } catch (e) {
    return {
      campground,
      results: [],
      error: e instanceof Error ? e.message : 'Failed to load availability',
    }
  }
}
