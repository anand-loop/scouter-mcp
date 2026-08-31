import { describe, expect, it } from 'vitest'
import { WINDOW_DAYS } from './availability'
import { estimateScan } from './estimate'

const AUG_22 = new Date(2026, 7, 22)

describe('estimateScan', () => {
  it('claims no work and no time for zero campgrounds', () => {
    const e = estimateScan(0, ['2026-08'], AUG_22)
    expect(e.requests).toBe(0)
    expect(e.seconds).toBe(0)
    expect(e.megabytes).toBe(0)
  })

  it('costs nothing when no months are selected', () => {
    expect(estimateScan(40, [], AUG_22).requests).toBe(0)
  })

  it('counts one window for the 10 days left in the current month', () => {
    expect(estimateScan(1, ['2026-08'], AUG_22).requests).toBe(1)
  })

  it('grows with the campground count', () => {
    const one = estimateScan(1, ['2026-09'], AUG_22).requests
    expect(estimateScan(40, ['2026-09'], AUG_22).requests).toBe(one * 40)
  })

  it('grows with the number of months', () => {
    const short = estimateScan(10, ['2026-09'], AUG_22).requests
    const long = estimateScan(10, ['2026-09', '2026-10'], AUG_22).requests
    expect(long).toBeGreaterThan(short)
  })

  it('charges only for the months chosen, not the span they cover', () => {
    // The point of month ranges: a gap in the selection is never fetched. Aug+Nov must
    // cost less than Aug through Nov, even though it spans the same calendar distance.
    const gapped = estimateScan(1, ['2026-08', '2026-11'], AUG_22).requests
    const contiguous = estimateScan(
      1,
      ['2026-08', '2026-09', '2026-10', '2026-11'],
      AUG_22,
    ).requests
    expect(gapped).toBeLessThan(contiguous)
  })

  it('costs no more for merged adjacent months than for the same months apart', () => {
    const merged = estimateScan(1, ['2026-09', '2026-10'], AUG_22).requests
    const apart =
      estimateScan(1, ['2026-09'], AUG_22).requests +
      estimateScan(1, ['2026-10'], AUG_22).requests
    expect(merged).toBeLessThanOrEqual(apart)
  })

  it('prices a single far month as a single month, not as everything up to it', () => {
    const far = estimateScan(1, ['2026-11'], AUG_22).requests
    const everythingUpToIt = estimateScan(
      1,
      ['2026-08', '2026-09', '2026-10', '2026-11'],
      AUG_22,
    ).requests
    expect(far).toBeLessThan(everythingUpToIt)
    // November's 30 days, and nothing else. Derived rather than hardcoded, so the window
    // size can change without this test claiming a regression it hasn't found.
    expect(far).toBe(Math.ceil(30 / WINDOW_DAYS))
  })

  it('reports a plausible size and duration for a full scan', () => {
    const e = estimateScan(40, ['2026-09'], AUG_22)
    expect(e.megabytes).toBeGreaterThan(1)
    expect(e.seconds).toBeGreaterThanOrEqual(1)
  })
})

describe('estimateScan with a longer stay', () => {
  it('never costs less than a single night', () => {
    const one = estimateScan(10, ['2026-09'], AUG_22, 1).requests
    for (const nights of [2, 3]) {
      expect(estimateScan(10, ['2026-09'], AUG_22, nights).requests).toBeGreaterThanOrEqual(one)
    }
  })

  it('defaults to a single night, so the existing price is unchanged', () => {
    expect(estimateScan(10, ['2026-09'], AUG_22).requests).toBe(
      estimateScan(10, ['2026-09'], AUG_22, 1).requests,
    )
  })

  it('adds at most one window per span for the tail', () => {
    const one = estimateScan(1, ['2026-08', '2026-11'], AUG_22, 1).requests
    const three = estimateScan(1, ['2026-08', '2026-11'], AUG_22, 3).requests
    expect(three - one).toBeLessThanOrEqual(2) // two disjoint spans
  })
})
