import { describe, expect, it } from 'vitest'
import { DEFAULT_STAY, isNightCount, isWeekday, migrateStay, normalizeStay, stayText } from './stay'

describe('isWeekday / isNightCount', () => {
  it('accepts only the offered integers', () => {
    expect(isWeekday(1)).toBe(true)
    expect(isWeekday(7)).toBe(true)
    for (const bad of [0, 8, 1.5, '5', null]) expect(isWeekday(bad)).toBe(false)
    expect(isNightCount(1)).toBe(true)
    expect(isNightCount(3)).toBe(true)
    for (const bad of [0, 4, 2.5, '2', null]) expect(isNightCount(bad)).toBe(false)
  })
})

describe('normalizeStay', () => {
  it('passes a valid selection through, deduped and ascending', () => {
    expect(normalizeStay([6, 2, 6], 3)).toEqual({ arrivalDays: [2, 6], nights: 3 })
  })

  it('clamps a night count to the offered range rather than rejecting it', () => {
    expect(normalizeStay([5], 9).nights).toBe(3)
    expect(normalizeStay([5], 0).nights).toBe(1)
  })

  it('drops unusable days rather than the whole selection', () => {
    expect(normalizeStay([0, 5, 8, 1.5, '6'], 2).arrivalDays).toEqual([5])
  })

  it('keeps an empty selection, which the UI prompts about', () => {
    expect(normalizeStay([], 2).arrivalDays).toEqual([])
    expect(normalizeStay('nope', 2).arrivalDays).toEqual([])
  })

  it('falls back for a non-integer night count', () => {
    expect(normalizeStay([5], '2').nights).toBe(DEFAULT_STAY.nights)
    expect(normalizeStay([5], undefined).nights).toBe(DEFAULT_STAY.nights)
  })
})

describe('stayText', () => {
  it('is singular at one night', () => {
    expect(stayText(1)).toBe('1 night')
    expect(stayText(2)).toBe('2 nights')
    expect(stayText(3)).toBe('3 nights')
  })
})

describe('migrateStay', () => {
  const none = null

  it('prefers a stored arrival selection over any older key', () => {
    expect(migrateStay('[3,4]', '1', 'weekend', '[5,6,7]', '[1,2]')).toEqual({
      arrivalDays: [3, 4],
      nights: 1,
    })
  })

  it('clamps a stored night count', () => {
    expect(migrateStay('[5]', '9', none, none, none).nights).toBe(3)
  })

  it('respects a stored empty selection instead of guessing', () => {
    expect(migrateStay('[]', '2', 'weekend', none, none)).toEqual({ arrivalDays: [], nights: 2 })
  })

  it('carries a Weekend preset across as its three nights', () => {
    expect(migrateStay(none, none, 'weekend', none, none)).toEqual({
      arrivalDays: [5, 6, 7],
      nights: 1,
    })
  })

  it('carries Any day across as every day', () => {
    expect(migrateStay(none, none, 'any', none, none)).toEqual({
      arrivalDays: [1, 2, 3, 4, 5, 6, 7],
      nights: 1,
    })
  })

  it('keeps a custom selection intact — multi-select makes this lossless', () => {
    expect(migrateStay(none, none, 'custom', '[4,2]', none)).toEqual({
      arrivalDays: [2, 4],
      nights: 1,
    })
  })

  it('falls back when a custom selection was left empty', () => {
    expect(migrateStay(none, none, 'custom', '[]', none)).toEqual(DEFAULT_STAY)
  })

  it('upgrades an install old enough to still carry the bare weekday array', () => {
    expect(migrateStay(none, none, none, none, '[5,6,7]')).toEqual({
      arrivalDays: [5, 6, 7],
      nights: 1,
    })
    expect(migrateStay(none, none, none, none, '[2,4]')).toEqual({
      arrivalDays: [2, 4],
      nights: 1,
    })
  })

  it('falls back on a fresh install or unusable input', () => {
    expect(migrateStay(none, none, none, none, none)).toEqual(DEFAULT_STAY)
    expect(migrateStay(none, none, 'nonsense', none, none)).toEqual(DEFAULT_STAY)
    expect(migrateStay(none, none, none, none, 'not json')).toEqual(DEFAULT_STAY)
    expect(migrateStay('', none, none, none, none)).toEqual(DEFAULT_STAY)
  })
})
