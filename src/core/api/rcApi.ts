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

/** Executes a request, retrying with backoff on HTTP 429. */
async function fetchWithBackoff(url: string, init?: RequestInit): Promise<Response> {
  let attempt = 0
  let throttled = false
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await passGate()
    const res = await fetch(url, init)
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
    const res = await fetchWithBackoff(`${BASE_URL}/rdr/search/grid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal,
    })
    return res.json()
  })
}
