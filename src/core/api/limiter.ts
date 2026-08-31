// A bounded-concurrency semaphore for outbound requests.
//
// Deliberately a *concurrency* limiter, not a request spacer: a spacer caps total
// throughput at 1/spacing no matter how many callers there are, which defeats the
// point of scanning many campgrounds at once. Bounding in-flight requests instead
// keeps the load on the API predictable while still pipelining away latency.
// (The Nominatim client does use a spacer — its published policy is an absolute
// 1 req/s, which is a rate limit rather than a concurrency limit.)

export interface Limiter {
  /** Runs `fn` once a permit is free. Rejections propagate; the permit is always released. */
  run<T>(fn: () => Promise<T>): Promise<T>
  /** Permanently lowers the ceiling for this session (used when the API pushes back). */
  reduce(by?: number): void
  readonly inFlight: number
  readonly max: number
}

export function createLimiter(max: number, floor = 1): Limiter {
  let ceiling = Math.max(floor, max)
  let inFlight = 0
  const queue: Array<() => void> = []

  function release(): void {
    inFlight--
    // Ceiling may have shrunk since the permit was taken, so re-check rather than
    // waking exactly one waiter.
    while (inFlight < ceiling && queue.length > 0) {
      const next = queue.shift()!
      inFlight++
      next()
    }
  }

  function acquire(): Promise<void> {
    if (inFlight < ceiling) {
      inFlight++
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => queue.push(resolve))
  }

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire()
      try {
        return await fn()
      } finally {
        release()
      }
    },
    reduce(by = 1) {
      ceiling = Math.max(floor, ceiling - by)
    },
    get inFlight() {
      return inFlight
    },
    get max() {
      return ceiling
    },
  }
}
