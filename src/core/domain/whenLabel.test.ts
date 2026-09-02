import { describe, expect, it } from 'vitest'
import type { StaySelection } from './stay'
import {
  arrivalDaysSentence,
  joinWithAmpersand,
  monthsPhrase,
  monthsPhraseCompact,
  whenText,
} from './whenLabel'

const AUG_22 = new Date(2026, 7, 22)
const stay = (arrivalDays: number[], nights: number): StaySelection => ({ arrivalDays, nights })

describe('joinWithAmpersand', () => {
  it('joins with an ampersand before the last item and no Oxford comma', () => {
    expect(joinWithAmpersand([])).toBe('')
    expect(joinWithAmpersand(['A'])).toBe('A')
    expect(joinWithAmpersand(['A', 'B'])).toBe('A & B')
    expect(joinWithAmpersand(['A', 'B', 'C'])).toBe('A, B & C')
    expect(joinWithAmpersand(['A', 'B', 'C', 'D'])).toBe('A, B, C & D')
  })
})

describe('monthsPhrase', () => {
  it('uses full names in calendar order', () => {
    expect(monthsPhrase(['2026-09', '2026-08'], AUG_22)).toBe('August & September')
  })

  it('adds a year only for months outside the current one', () => {
    expect(monthsPhrase(['2026-12', '2027-01'], AUG_22)).toBe('December & January 2027')
  })
})

describe('whenText', () => {
  it('states the arrival and the stay, with the months beneath', () => {
    expect(whenText(stay([5], 2), ['2026-08', '2026-09'], AUG_22)).toEqual({
      label: 'Fri arrival · 2 nights',
      sub: 'in Aug & Sep',
    })
  })

  it('is singular at one night', () => {
    expect(whenText(stay([1], 1), ['2026-08'], AUG_22).label).toBe('Mon arrival · 1 night')
  })

  it('pluralises across several arrival days, in Mon-to-Sun order', () => {
    expect(whenText(stay([6, 5], 2), ['2026-08'], AUG_22).label).toBe(
      'Fri & Sat arrivals · 2 nights',
    )
  })

  it('collapses every day to a single phrase', () => {
    expect(whenText(stay([1, 2, 3, 4, 5, 6, 7], 1), ['2026-08'], AUG_22).label).toBe(
      'Any arrival day · 1 night',
    )
  })

  it('prompts when every arrival day has been deselected', () => {
    expect(whenText(stay([], 2), ['2026-08'], AUG_22)).toEqual({
      label: 'Pick an arrival day',
      sub: '',
    })
  })

  it('prompts for a month when none is chosen, and drops the sub-line with it', () => {
    expect(whenText(stay([5], 2), [], AUG_22)).toEqual({ label: 'Pick a month', sub: '' })
  })

  // A lone month keeps its full name, and with it the year that says which one it is.
  it('spells a single month out, since there is room and "Jan" is ambiguous', () => {
    expect(whenText(stay([5], 2), ['2027-01'], AUG_22).sub).toBe('in January 2027')
  })

  it('abbreviates once there is more than one month to fit', () => {
    expect(whenText(stay([5], 2), ['2026-12', '2027-01'], AUG_22).sub).toBe('in Dec & Jan')
  })

  it('names every single day correctly', () => {
    for (const day of [1, 2, 3, 4, 5, 6, 7]) {
      expect(whenText(stay([day], 1), ['2026-08'], AUG_22).label).toContain('arrival')
    }
  })
})

describe('monthsPhraseCompact', () => {
  it('spells a lone month out in full', () => {
    expect(monthsPhraseCompact(['2026-09'], AUG_22)).toBe('September')
  })

  it('abbreviates once there is more than one', () => {
    expect(monthsPhraseCompact(['2026-08', '2026-09'], AUG_22)).toBe('Aug & Sep')
    expect(monthsPhraseCompact(['2026-10', '2026-11', '2026-12'], AUG_22)).toBe('Oct, Nov & Dec')
  })

  it('sorts into calendar order regardless of how the keys arrive', () => {
    expect(monthsPhraseCompact(['2026-11', '2026-09'], AUG_22)).toBe('Sep & Nov')
  })

  it('keeps the year on a lone month outside this one, where there is room for it', () => {
    expect(monthsPhraseCompact(['2027-01'], AUG_22)).toBe('January 2027')
    // Abbreviated, there isn't — and a run of months makes the year inferable anyway.
    expect(monthsPhraseCompact(['2026-12', '2027-01'], AUG_22)).toBe('Dec & Jan')
  })

  it('is empty with nothing selected', () => {
    expect(monthsPhraseCompact([], AUG_22)).toBe('')
  })
})

describe('arrivalDaysSentence', () => {
  it('spells the day out for prose', () => {
    expect(arrivalDaysSentence([5])).toBe('Friday')
  })

  // "or", not "&" — the label reads as a list, this reads as a sentence.
  it('joins several with or, in weekday order', () => {
    expect(arrivalDaysSentence([6, 5])).toBe('Friday or Saturday')
    expect(arrivalDaysSentence([1, 5, 6])).toBe('Monday, Friday or Saturday')
  })

  it('collapses a full week rather than naming all seven', () => {
    expect(arrivalDaysSentence([1, 2, 3, 4, 5, 6, 7])).toBe('any day')
  })

  it('is empty when nothing is picked, which the caller turns into a prompt', () => {
    expect(arrivalDaysSentence([])).toBe('')
  })
})
