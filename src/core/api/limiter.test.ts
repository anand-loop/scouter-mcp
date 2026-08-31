import { describe, expect, it } from 'vitest'
import { createLimiter } from './limiter'

/** A promise plus the handles to settle it, so tests can control when work finishes. */
function deferred() {
  let resolve!: () => void
  let reject!: (e: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createLimiter', () => {
  it('never runs more than `max` at once', async () => {
    const limiter = createLimiter(2)
    let running = 0
    let peak = 0
    const gates = [deferred(), deferred(), deferred(), deferred()]

    const runs = gates.map((g) =>
      limiter.run(async () => {
        running++
        peak = Math.max(peak, running)
        await g.promise
        running--
      }),
    )

    expect(limiter.inFlight).toBe(2)
    gates.forEach((g) => g.resolve())
    await Promise.all(runs)
    expect(peak).toBe(2)
  })

  it('admits queued work in FIFO order', async () => {
    const limiter = createLimiter(1)
    const order: number[] = []
    const runs = [1, 2, 3].map((n) =>
      limiter.run(async () => {
        order.push(n)
      }),
    )
    await Promise.all(runs)
    expect(order).toEqual([1, 2, 3])
  })

  it('releases the permit when the task rejects', async () => {
    const limiter = createLimiter(1)
    await expect(limiter.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(limiter.inFlight).toBe(0)
    await expect(limiter.run(() => Promise.resolve('ok'))).resolves.toBe('ok')
  })

  it('lowers the ceiling on reduce but never past the floor', () => {
    const limiter = createLimiter(6, 2)
    limiter.reduce(2)
    expect(limiter.max).toBe(4)
    limiter.reduce(2)
    expect(limiter.max).toBe(2)
    limiter.reduce(2)
    expect(limiter.max).toBe(2)
  })

  it('applies a reduced ceiling to work that is still queued', async () => {
    const limiter = createLimiter(2, 1)
    let running = 0
    let peakAfterReduce = 0
    const gates = [deferred(), deferred(), deferred()]

    const runs = gates.map((g, i) =>
      limiter.run(async () => {
        running++
        if (i > 1) peakAfterReduce = Math.max(peakAfterReduce, running)
        await g.promise
        running--
      }),
    )

    limiter.reduce(1)
    gates[0].resolve()
    gates[1].resolve()
    await Promise.resolve()
    gates[2].resolve()
    await Promise.all(runs)
    expect(peakAfterReduce).toBe(1)
  })
})
