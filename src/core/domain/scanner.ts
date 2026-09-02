// Runs availability lookups for many campgrounds at once.
//
// Used by both the watchlist scan and the nearby scan. Campground-level concurrency is
// modest because each campground fans out into several grid windows; the real governor
// is the shared request semaphore in api/rcApi.ts.
import { availabilityFor } from './availability'
import { today as todayFn } from './dates'
import { facilityLocation, type LatLng } from './geo'
import type { CampgroundAvailability, SavedCampground, WatchSettings } from './types'

/** How many campgrounds are worked on at once (each expands to ~4-7 grid requests). */
export const SCAN_CONCURRENCY = 4

export interface ScanTarget {
  campground: SavedCampground
  /** Present only for nearby scans; carried through onto the result for display. */
  distanceMiles?: number
  /** The park's coordinates, used to plot a campground whose grid omits its own. */
  fallbackLocation?: LatLng
}

export interface ScanOptions {
  concurrency?: number
  signal?: AbortSignal
  todayDate?: Date
  /** Called as each campground finishes. `index` is its position in `targets`. */
  onResult: (index: number, result: CampgroundAvailability) => void
}

/**
 * Applies `fn` to every item with at most `concurrency` running at once, in a
 * shared-cursor worker pool. Aborting stops new work being claimed; already-running
 * calls settle normally. Pure control flow — no network, no browser globals.
 */
export async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () =>
    (async () => {
      while (true) {
        if (signal?.aborted) return
        const index = cursor++
        if (index >= items.length) return
        await fn(items[index], index)
      }
    })(),
  )
  await Promise.all(workers)
}

/**
 * Copies a target's display extras onto its result. Exported so a single-campground
 * retry decorates its replacement exactly as the original scan did.
 */
export function decorate(
  result: CampgroundAvailability,
  target: ScanTarget,
): CampgroundAvailability {
  // availabilityFor sets `location` from the grid when it can; the park is both the backstop
  // for a grid that reported nothing and the reference that catches one reporting nonsense.
  const location = facilityLocation(result.location, target.fallbackLocation)
  return {
    ...result,
    ...(target.distanceMiles !== undefined ? { distanceMiles: target.distanceMiles } : {}),
    ...(location ? { location } : {}),
  }
}

/**
 * Scans every target, reporting results through `onResult` as they land. Results arrive
 * out of order — callers that care about ordering should slot them in by index.
 * Never throws: `availabilityFor` folds per-campground failures onto the result.
 */
export async function runScan(
  targets: ScanTarget[],
  settings: WatchSettings,
  opts: ScanOptions,
): Promise<void> {
  const todayDate = opts.todayDate ?? todayFn()
  await mapWithConcurrency(
    targets,
    opts.concurrency ?? SCAN_CONCURRENCY,
    async (target, index) => {
      const result = await availabilityFor(
        target.campground,
        settings,
        todayDate,
        opts.signal,
      )
      if (opts.signal?.aborted) return
      opts.onResult(index, decorate(result, target))
    },
    opts.signal,
  )
}
