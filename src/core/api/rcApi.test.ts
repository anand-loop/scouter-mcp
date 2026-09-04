import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getGrid, getPlaces, isUnreachable } from './rcApi'

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
const status = (code: number) => new Response('', { status: code })

/**
 * Runs a request to completion with the backoff waits collapsed.
 *
 * The outcome is captured synchronously, before the timers are advanced. Awaiting the
 * request itself afterwards would leave it unhandled for the moment it rejects in, which
 * vitest reports as an unhandled rejection even though the test goes on to assert on it.
 */
async function settle<T>(p: Promise<T>): Promise<T> {
  const outcome = p.then(
    (v) => () => v,
    (e: unknown) => () => {
      throw e
    },
  )
  await vi.runAllTimersAsync()
  return (await outcome)()
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('fetchWithBackoff, through getPlaces', () => {
  it('returns the body when the request works first time', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok([{ PlaceId: 1 }])))
    await expect(settle(getPlaces())).resolves.toEqual([{ PlaceId: 1 }])
  })

  // The train case: the connection dies mid-request and comes back a moment later. Before
  // this retry existed, that single blip was the whole difference between a working app and
  // "Couldn't load".
  it('retries a dropped connection and succeeds on the second try', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(ok([{ PlaceId: 2 }]))
    vi.stubGlobal('fetch', fetchMock)
    await expect(settle(getPlaces())).resolves.toEqual([{ PlaceId: 2 }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after four attempts, and says it never got through', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)
    const err = await settle(getPlaces()).catch((e: unknown) => e)
    expect(isUnreachable(err)).toBe(true)
    // The first attempt plus MAX_RETRIES.
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('retries a server error', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(status(503)).mockResolvedValue(ok([]))
    vi.stubGlobal('fetch', fetchMock)
    await expect(settle(getPlaces())).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // Asking again gets the same answer; three backoffs only make the failure slower.
  it('does not retry a 404', async () => {
    const fetchMock = vi.fn().mockResolvedValue(status(404))
    vi.stubGlobal('fetch', fetchMock)
    const err = await settle(getPlaces()).catch((e: unknown) => e)
    expect(isUnreachable(err)).toBe(false)
    expect(String(err)).toContain('404')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // A server that answered is a different problem from one that never did, and the results
  // screen says something different about each.
  it('tells a bad answer apart from no answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(status(403)))
    const err = await settle(getPlaces()).catch((e: unknown) => e)
    expect(isUnreachable(err)).toBe(false)
  })
})

// Stop, and navigating away mid-scan, both work by aborting the signal. The retry loop has
// to treat that as the answer rather than as a failure worth asking again — otherwise
// leaving a scan would fire three more rounds of requests on the way out.
describe('cancellation', () => {
  it('does not send a request for an already-abandoned scan', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({}))
    vi.stubGlobal('fetch', fetchMock)
    const signal = AbortSignal.abort()
    await expect(settle(getGrid(1, '09-01-2026', '09-21-2026', signal))).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('gives up rather than retrying when the caller aborts mid-request', async () => {
    const control = new AbortController()
    const fetchMock = vi.fn().mockImplementation(() => {
      control.abort()
      return Promise.reject(new DOMException('Aborted', 'AbortError'))
    })
    vi.stubGlobal('fetch', fetchMock)
    const err = await settle(
      getGrid(1, '09-01-2026', '09-21-2026', control.signal),
    ).catch((e: unknown) => e)
    expect(isUnreachable(err)).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
