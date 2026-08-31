// Nominatim from Node, which the browser version deliberately cannot do.
//
// core/domain/nominatim.ts sends no headers at all — a browser supplies User-Agent, Origin
// and Referer on its own, and setting them from fetch would force a CORS preflight. Its own
// comment says not to "fix" that, so this is the sibling rather than an edit: same URLs,
// same parser, same ranker, plus the User-Agent Nominatim answers 403 without.
//
// Everything specific to the request lives here; everything about interpreting the answer
// is imported, so the two paths can't drift on what a result means.
import {
  type GeocodeResult,
  parseNominatimResults,
  rankGeocodeResults,
  regionLabel,
} from '../core/domain/nominatim'

const BASE_URL = 'https://nominatim.openstreetmap.org'
/** Their published policy is 1 req/s; the extra 100ms absorbs timer jitter. */
const MIN_INTERVAL_MS = 1100

/**
 * Nominatim's usage policy requires a genuine identifying User-Agent with a way to reach
 * the operator. Override via SCOUTER_USER_AGENT if you fork this.
 */
const USER_AGENT =
  process.env.SCOUTER_USER_AGENT ??
  'scouter-mcp/0.1 (+https://github.com/anand-loop/scouter-web)'

// One request at a time, spaced. A spacer rather than a concurrency limit, because their
// limit is an absolute rate — the opposite of the grid endpoint, which cares about
// simultaneous load. The chain is per-process, which is what a single stdio server is.
let chain: Promise<unknown> = Promise.resolve()

function spaced<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.then(
    () => new Promise((r) => setTimeout(r, MIN_INTERVAL_MS)),
    () => new Promise((r) => setTimeout(r, MIN_INTERVAL_MS)),
  )
  return run
}

// Repeat lookups are common — an agent geocoding a place, then estimating, then scanning it
// — and every one avoided is one less request against a service run on donations.
const cache = new Map<string, GeocodeResult[]>()

/** Geocodes a US city, ZIP or address. Ranked most-specific first. */
export async function geocode(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const key = query.trim().toLowerCase()
  if (!key) return []
  const hit = cache.get(key)
  if (hit) return hit

  const url = `${BASE_URL}/search?q=${encodeURIComponent(key)}&format=jsonv2&countrycodes=us&limit=5`
  const results = await spaced(async () => {
    const res = await fetch(url, { signal, headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) throw new Error(`HTTP ${res.status} from Nominatim`)
    return rankGeocodeResults(parseNominatimResults(await res.json()))
  })
  cache.set(key, results)
  return results
}

export { regionLabel, type GeocodeResult }
