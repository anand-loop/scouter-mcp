// Pre-scan cost estimate — the "about 10 seconds · 9 MB of data" caption.
//
// Built on the same monthRanges + windows path the real scan takes, so the number shown
// can't drift from the number of requests actually made. Pure, and kept out of the screen,
// so the caption can be unit-tested against the same inputs the scanner receives.
import { windows, WINDOW_DAYS } from './availability'
import { type MonthKey, monthRanges } from './months'

/** Measured average grid response. */
export const KB_PER_REQUEST = 61
/** Observed sustained throughput at the API's tolerated concurrency. */
export const REQUESTS_PER_SECOND = 15

export interface ScanEstimate {
  requests: number
  seconds: number
  megabytes: number
}

export function estimateScan(
  campgroundCount: number,
  monthKeys: MonthKey[],
  today: Date,
  /** Nights per stay — a longer stay fetches further past each month's end. */
  nights = 1,
): ScanEstimate {
  const perCampground = monthRanges(today, monthKeys, nights - 1).reduce(
    (n, [s, e]) => n + windows(s, e, WINDOW_DAYS).length,
    0,
  )
  const requests = Math.max(0, campgroundCount) * perCampground
  return {
    requests,
    // Callers hide the caption at zero rather than claiming "about 1 second" for no work.
    seconds: requests === 0 ? 0 : Math.max(1, Math.round(requests / REQUESTS_PER_SECOND)),
    megabytes: (requests * KB_PER_REQUEST) / 1024,
  }
}
