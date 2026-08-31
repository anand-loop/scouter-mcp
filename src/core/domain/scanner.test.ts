import { describe, expect, it } from 'vitest'
import { decorate, mapWithConcurrency } from './scanner'

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

describe('mapWithConcurrency', () => {
  it('visits every item exactly once', async () => {
    const items = [1, 2, 3, 4, 5, 6, 7]
    const seen: number[] = []
    await mapWithConcurrency(items, 3, async (item) => {
      await tick()
      seen.push(item)
    })
    expect([...seen].sort((a, b) => a - b)).toEqual(items)
  })

  it('never exceeds the requested concurrency', async () => {
    let running = 0
    let peak = 0
    await mapWithConcurrency([...Array(20).keys()], 4, async () => {
      running++
      peak = Math.max(peak, running)
      await tick()
      running--
    })
    expect(peak).toBe(4)
  })

  it('passes the index alongside the item', async () => {
    const pairs: Array<[number, string]> = []
    await mapWithConcurrency(['a', 'b', 'c'], 1, async (item, index) => {
      pairs.push([index, item])
    })
    expect(pairs).toEqual([
      [0, 'a'],
      [1, 'b'],
      [2, 'c'],
    ])
  })

  it('stops claiming work once aborted', async () => {
    const controller = new AbortController()
    let processed = 0
    await mapWithConcurrency(
      [...Array(50).keys()],
      2,
      async () => {
        processed++
        if (processed === 4) controller.abort()
        await tick()
      },
      controller.signal,
    )
    // The in-flight pair finishes; nothing new is picked up.
    expect(processed).toBeLessThanOrEqual(6)
    expect(processed).toBeGreaterThanOrEqual(4)
  })

  it('does not start anything when aborted up front', async () => {
    const controller = new AbortController()
    controller.abort()
    let processed = 0
    await mapWithConcurrency([1, 2, 3], 2, async () => void processed++, controller.signal)
    expect(processed).toBe(0)
  })

  it('propagates a rejection rather than hanging', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
  })

  it('handles an empty list', async () => {
    await expect(mapWithConcurrency([], 4, async () => {})).resolves.toBeUndefined()
  })
})

describe('decorate', () => {
  const campground = { facilityId: 1, placeId: 2, name: 'Loop A', parkName: 'Park' }
  const base = { campground, results: [] }
  const park = { lat: 37.1, lng: -122.1 }
  const own = { lat: 37.17, lng: -122.22 }

  it('prefers the campground’s own coordinates over the park’s', () => {
    const r = decorate({ ...base, location: own }, { campground, fallbackLocation: park })
    expect(r.location).toEqual(own)
  })

  it('falls back to the park when the grid reported no location', () => {
    const r = decorate(base, { campground, fallbackLocation: park })
    expect(r.location).toEqual(park)
  })

  it('leaves location unset when neither source has one', () => {
    expect(decorate(base, { campground }).location).toBeUndefined()
    expect('location' in decorate(base, { campground })).toBe(false)
  })

  it('carries distance through, and omits it entirely when absent', () => {
    expect(decorate(base, { campground, distanceMiles: 8.2 }).distanceMiles).toBe(8.2)
    expect('distanceMiles' in decorate(base, { campground })).toBe(false)
  })

  it('preserves an error result untouched', () => {
    const r = decorate({ ...base, error: 'HTTP 500' }, { campground, fallbackLocation: park })
    expect(r.error).toBe('HTTP 500')
    expect(r.location).toEqual(park)
  })
})
