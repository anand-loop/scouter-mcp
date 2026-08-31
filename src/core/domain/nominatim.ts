// Turns a typed city or ZIP into coordinates, using OpenStreetMap's Nominatim.
//
// Nominatim is free and CORS-open, in exchange for a courtesy rate limit of one request
// per second and a request that we identify ourselves. Browsers send User-Agent, Origin
// and Referer automatically, which is the identification they ask of web apps — we
// deliberately send no custom headers (that would force a CORS preflight, and fetch
// forbids overriding User-Agent anyway) and no `email` param (meant for bulk server use;
// it would leak the user's address to a third party).
//
// Consequently these two functions only work from a browser: Nominatim answers 403 to
// requests with no User-Agent, which is what a bare Node fetch sends. That's expected —
// don't "fix" it by adding headers, which would break the browser path.
import type { LatLng } from './geo'

const BASE_URL = 'https://nominatim.openstreetmap.org'
/** Published policy is 1 req/s; the extra 100ms absorbs timer jitter. */
const MIN_INTERVAL_MS = 1100

export type PlaceKind = 'postcode' | 'city' | 'county' | 'state' | 'other'

export interface GeocodeResult {
  lat: number
  lng: number
  /** Full "Santa Cruz, Santa Cruz County, California, United States". */
  label: string
  /** Just "Santa Cruz" — what we show once a result is chosen. */
  shortLabel: string
  kind: PlaceKind
  importance: number
}

const CITY_TYPES = new Set([
  'city',
  'town',
  'village',
  'hamlet',
  'suburb',
  'neighbourhood',
  'municipality',
])

function classify(addressType: string): PlaceKind {
  if (addressType === 'postcode') return 'postcode'
  if (CITY_TYPES.has(addressType)) return 'city'
  if (addressType === 'county') return 'county'
  if (addressType === 'state') return 'state'
  return 'other'
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Narrows Nominatim's JSON to what we use. Coordinates arrive as strings, and any entry
 * that doesn't parse is dropped rather than thrown on — a geocoder hiccup should degrade
 * to "no matches", not break the screen.
 */
export function parseNominatimResults(json: unknown): GeocodeResult[] {
  if (!Array.isArray(json)) return []
  const out: GeocodeResult[] = []
  for (const raw of json) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const lat = num(r.lat)
    const lng = num(r.lon)
    if (lat === null || lng === null) continue
    const label = typeof r.display_name === 'string' ? r.display_name : ''
    const name = typeof r.name === 'string' && r.name ? r.name : label.split(',')[0].trim()
    out.push({
      lat,
      lng,
      label: label || name,
      shortLabel: name,
      kind: classify(typeof r.addresstype === 'string' ? r.addresstype : ''),
      importance: num(r.importance) ?? 0,
    })
  }
  return out
}

/**
 * The line under a result's name — "Santa Cruz County, California".
 *
 * `display_name` leads with the place itself and trails with the country, neither of which
 * the row needs: the name is already the line above it, and every result is US by
 * construction (`countrycodes=us`).
 */
export function regionLabel(r: GeocodeResult): string {
  const parts = r.label
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  const rest = parts[0] === r.shortLabel ? parts.slice(1) : parts
  return rest.filter((p) => p !== 'United States').join(', ')
}

const KIND_RANK: Record<PlaceKind, number> = {
  postcode: 0,
  city: 1,
  other: 2,
  county: 3,
  state: 4,
}

/**
 * Orders matches the way someone typing a place name means them.
 *
 * Nominatim ranks by its own `importance`, where a county routinely outscores the city
 * inside it — searching "Santa Cruz" returns Santa Cruz County first, whose centroid sits
 * in the mountains well away from town. Sorting by specificity first puts the city back on
 * top; `importance` still breaks ties between peers.
 */
export function rankGeocodeResults(results: GeocodeResult[]): GeocodeResult[] {
  return [...results].sort(
    (a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.importance - a.importance,
  )
}

// One request at a time, spaced by MIN_INTERVAL_MS. A spacer (not a concurrency limit) is
// right here because Nominatim's limit is an absolute rate — the opposite of the grid
// endpoint, which cares about simultaneous load. See api/limiter.ts.
let chain: Promise<unknown> = Promise.resolve()

function spaced<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.then(
    () => new Promise((r) => setTimeout(r, MIN_INTERVAL_MS)),
    () => new Promise((r) => setTimeout(r, MIN_INTERVAL_MS)),
  )
  return run
}

// Repeat lookups are common (re-typing, back navigation), and every one avoided is one
// less request against a service run on donations.
const cache = new Map<string, GeocodeResult[]>()

/** Geocodes a US city, ZIP, or address. Returns [] on no match or a failed request. */
export async function geocode(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const key = query.trim().toLowerCase()
  if (!key) return []
  const hit = cache.get(key)
  if (hit) return hit

  const url = `${BASE_URL}/search?q=${encodeURIComponent(key)}&format=jsonv2&countrycodes=us&limit=5`
  const results = await spaced(async () => {
    const res = await fetch(url, { signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} from Nominatim`)
    return rankGeocodeResults(parseNominatimResults(await res.json()))
  })
  cache.set(key, results)
  return results
}

/** Best-effort place name for a coordinate — used to label "my location". */
export async function reverseGeocode(p: LatLng, signal?: AbortSignal): Promise<string | null> {
  const url = `${BASE_URL}/reverse?lat=${p.lat}&lon=${p.lng}&format=jsonv2&zoom=10`
  try {
    return await spaced(async () => {
      const res = await fetch(url, { signal })
      if (!res.ok) return null
      const json = (await res.json()) as Record<string, unknown>
      const name = typeof json.name === 'string' ? json.name : ''
      const display = typeof json.display_name === 'string' ? json.display_name : ''
      return name || display.split(',').slice(0, 2).join(',').trim() || null
    })
  } catch {
    // A missing label never blocks the search that prompted it.
    return null
  }
}
