// Thin client for the public ReserveCalifornia / UseDirect API — port of data/network/RcApi.kt.
//
// The API is unauthenticated and (verified) CORS-permissive: it returns
// `access-control-allow-origin: *` on the catalog GETs and the grid POST, so the
// browser can call it directly from any origin. No proxy or backend needed.
//
// Grid requests run through a shared concurrency limiter: measured against the live
// API, 160 POSTs at 6-way concurrency (~56 req/s) returned zero 429s, so the binding
// constraint is bandwidth (~61 KB per window), not request rate. We still back off on
// 429 — and when one arrives it pauses every in-flight caller, not just the unlucky
// one, since siblings hammering away would defeat a single request's backoff.
import { createLimiter } from './limiter'

/** One campground from GET /rdr/fd/facilities (top-level JSON array). */
export interface FacilityDto {
  FacilityId: number
  PlaceId: number
  Name: string
  AllowWebBooking: boolean
}

/**
 * One park from GET /rdr/fd/places (top-level JSON array).
 *
 * The coordinate/address fields are already on the wire for every park, so the
 * nearby search needs no extra endpoint. A handful of rows carry 0/0 coordinates
 * or null address parts — see `toGeoPlace` in domain/geo.ts for the validation.
 */
export interface PlaceDto {
  PlaceId: number
  Name: string
  RegionId: number
  City: string | null
  State: string | null
  Zip: string | null
  Latitude: number
  Longitude: number
}

export interface GridSlice {
  /** ISO date, e.g. "2026-04-22". */
  Date: string
  IsFree: boolean
  IsBlocked: boolean
}

export interface GridUnit {
  UnitId: number
  Name: string
  ShortName: string
  IsAda: boolean
  AllowWebBooking: boolean
  /**
   * What kind of site this is — see domain/siteTypes.ts for the vocabulary. Already on the
   * wire for every unit; declaring it costs nothing and no change to the request.
   *
   * Passing a category in the grid POST deliberately isn't done: the server returns every
   * unit either way and only flips each one's `IsFiltered`, so it would buy no bandwidth
   * and split the filtering rule across two places.
   */
  UnitCategoryId: number
  /** Longest vehicle the site takes, in feet. 0 where none is recorded. */
  VehicleLength?: number
  Slices: Record<string, GridSlice>
}

export interface GridFacility {
  FacilityId: number
  Name: string
  Units: Record<string, GridUnit>
  /**
   * Campground-level coordinates — more precise than the park's, and free: they ride
   * along on grid responses we already fetch. A few facilities report 0/0, so validate
   * with `toLatLng` before using.
   */
  Latitude?: number
  Longitude?: number
}

export interface GridResponse {
  Facility?: GridFacility
}

/** Live UseDirect host for ReserveCalifornia (swap here if it ever migrates again). */
const BASE_URL =
  'https://california-rdr.prod.cali.rd12.recreation-management.tylerapp.com'
const MAX_RETRIES = 3
const BACKOFF_BASE_MS = 1500
/**
 * How long one attempt may hang before it counts as a connection that isn't coming back.
 *
 * Generous on purpose. This is aimed at a phone on a train, where a request that has gone
 * quiet for fifteen seconds may still land — the timeout is here to convert a socket that
 * has silently died into a retry, not to give up on a slow one.
 */
const REQUEST_TIMEOUT_MS = 20_000

/** `name` on errors that mean we never got an answer, as opposed to one we didn't like. */
const UNREACHABLE = 'Unreachable'

/**
 * Whether a request failed on the way out rather than on the way back.
 *
 * Worth telling apart, because the two have different things to say to whoever is reading:
 * one is about their connection or something on their network, the other is about
 * ReserveCalifornia. Carried on `name` rather than a subclass, which `erasableSyntaxOnly`
 * would allow but the rest of this codebase gives no precedent for.
 */
export function isUnreachable(e: unknown): boolean {
  return e instanceof Error && e.name === UNREACHABLE
}

function unreachable(url: string, cause: unknown): Error {
  const e = new Error(`Could not reach ${url}`, { cause })
  e.name = UNREACHABLE
  return e
}
/** Simultaneous grid requests. Verified clean at 6; degrades to 2 if we ever see a 429. */
const GRID_CONCURRENCY = 6
const GRID_CONCURRENCY_FLOOR = 2

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const gridLimit = createLimiter(GRID_CONCURRENCY, GRID_CONCURRENCY_FLOOR)

/** Epoch ms until which *every* caller holds off — set when the API returns 429. */
let gateUntil = 0

async function passGate(): Promise<void> {
  const wait = gateUntil - Date.now()
  if (wait > 0) await delay(wait)
}

/** Seconds or an HTTP-date; we only honour the numeric form, which is what this API sends. */
function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get('Retry-After')
  if (!raw) return null
  const secs = Number(raw)
  return Number.isFinite(secs) && secs >= 0 ? secs * 1000 : null
}

/**
 * One attempt, abandoned if it hangs.
 *
 * The caller's signal and the timeout are merged by hand rather than with AbortSignal.any,
 * which is newer than the browsers this has to work on — and a phone old enough to lack it
 * is exactly the phone most likely to be on the connection this exists for.
 */
async function fetchOnce(
  url: string,
  init: RequestInit | undefined,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const attemptSignal = new AbortController()
  const timer = setTimeout(() => attemptSignal.abort(), REQUEST_TIMEOUT_MS)
  const relay = () => attemptSignal.abort()
  signal?.addEventListener('abort', relay, { once: true })
  try {
    return await fetch(url, { ...init, signal: attemptSignal.signal })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', relay)
  }
}

/**
 * Executes a request, retrying with backoff on the failures that are worth asking again.
 *
 * Three kinds, and they are not the same kind of problem:
 *
 * A 429 is the API telling the whole app to slow down, so it holds every caller back and
 * walks the grid ceiling down rather than just pausing this one request.
 *
 * A 5xx or a dropped connection is worth simply asking again. This is the case that matters
 * on a phone: a train goes into a cutting, one of the two catalog requests dies, and without
 * a retry that single blip is the difference between a working app and "Couldn't load".
 * Everything else about the search was fine.
 *
 * A 4xx that isn't 429 is not retried at all — asking a second time gets the same answer,
 * and spending three backoffs to hear it again only makes the failure slower.
 */
async function fetchWithBackoff(
  url: string,
  init?: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  let attempt = 0
  let throttled = false
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await passGate()
    signal?.throwIfAborted()

    let res: Response
    try {
      res = await fetchOnce(url, init, signal)
    } catch (e) {
      // A caller who cancelled is not a failure to retry — it is the answer they asked for.
      signal?.throwIfAborted()
      if (attempt >= MAX_RETRIES) throw unreachable(url, e)
      attempt++
      await delay(BACKOFF_BASE_MS * attempt)
      continue
    }

    if (res.status === 429 && attempt < MAX_RETRIES) {
      attempt++
      const wait = retryAfterMs(res) ?? BACKOFF_BASE_MS * attempt
      // Hold the whole fleet back, not just this request.
      gateUntil = Math.max(gateUntil, Date.now() + wait)
      if (!throttled) {
        // Once per request, so a rough patch walks the ceiling down instead of collapsing it.
        throttled = true
        gridLimit.reduce(2)
      }
      continue
    }
    if (res.status >= 500 && attempt < MAX_RETRIES) {
      attempt++
      await delay(BACKOFF_BASE_MS * attempt)
      continue
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
    return res
  }
}

// The catalog GETs deliberately bypass the limiter: they're two requests that every
// screen depends on, and queueing them behind a scan would stall the whole UI.

/** GET /rdr/fd/facilities — full catalog of campgrounds. */
export async function getFacilities(): Promise<FacilityDto[]> {
  const res = await fetchWithBackoff(`${BASE_URL}/rdr/fd/facilities`)
  return res.json()
}

/** GET /rdr/fd/places — full catalog of parks. */
export async function getPlaces(): Promise<PlaceDto[]> {
  const res = await fetchWithBackoff(`${BASE_URL}/rdr/fd/places`)
  return res.json()
}

/**
 * POST /rdr/search/grid — per-site availability for a facility over [start]..[end] (MM-DD-YYYY).
 *
 * Rate-limited by the shared grid semaphore. `signal` cancels both queued and in-flight
 * work, so stopping a scan (or navigating away) frees the queue immediately.
 */
export async function getGrid(
  facilityId: number,
  start: string,
  end: string,
  signal?: AbortSignal,
): Promise<GridResponse> {
  const body = JSON.stringify({
    StartDate: start,
    EndDate: end,
    FacilityId: facilityId,
    WebOnly: true,
    InSeasonOnly: true,
    UnitSort: 'orderby',
  })
  return gridLimit.run(async () => {
    // Waiting for a permit may have taken a while; don't spend a request on a dead scan.
    signal?.throwIfAborted()
    const res = await fetchWithBackoff(
      `${BASE_URL}/rdr/search/grid`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
      signal,
    )
    return res.json()
  })
}
