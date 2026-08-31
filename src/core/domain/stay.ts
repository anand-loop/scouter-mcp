// What the user is looking for: a night to arrive on, and how long to stay.
//
// Replaces the old "which nights should I check" model. The difference is not cosmetic —
// a two-night stay means one *site* free on both nights, so this pair is what decides
// whether a date counts as available at all.
import { ALL_DAYS } from './days'

export interface StaySelection {
  /** java.time.DayOfWeek values to arrive on: MON=1 … SUN=7. Ascending, may be empty. */
  arrivalDays: number[]
  /** Consecutive nights the same unit must be free. 1, 2 or 3. */
  nights: number
}

export const NIGHT_OPTIONS = [1, 2, 3] as const

/** Friday, two nights — the trip most people are looking for. */
export const DEFAULT_STAY: StaySelection = { arrivalDays: [5], nights: 2 }

export function isWeekday(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 7
}

export function isNightCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 3
}

/** Whole weekdays 1–7, deduped and ascending. Empty is a real state, not an error. */
export function normalizeDays(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  const out = new Set<number>()
  for (const d of v) if (isWeekday(d)) out.add(d)
  return [...out].sort((a, b) => a - b)
}

/**
 * Coerces stored or URL-borne values into a usable selection.
 *
 * A night count outside the offered range is clamped rather than rejected — the same
 * treatment `snapRadius` gives a radius, and for the same reason: the value is a choice
 * from a short list, so the nearest offered one is what was meant. Arrival days have no
 * meaningful "nearest", so unusable ones are simply dropped; an empty result is kept, since
 * having deselected every day is a state the UI prompts about rather than an error.
 */
export function normalizeStay(arrivalDays: unknown, nights: unknown): StaySelection {
  const n =
    typeof nights === 'number' && Number.isInteger(nights)
      ? Math.min(3, Math.max(1, nights))
      : DEFAULT_STAY.nights
  return { arrivalDays: normalizeDays(arrivalDays), nights: n }
}

export function stayText(nights: number): string {
  return nights === 1 ? '1 night' : `${nights} nights`
}

function parseArray(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * A pre-redesign weekday set carried no notion of consecutive nights, so it becomes those
 * same days for a single night. Multi-select arrival days make this lossless — the set the
 * user picked is the set they keep.
 */
function stayForWeekdays(days: number[]): StaySelection {
  return days.length === 0 ? DEFAULT_STAY : { arrivalDays: days, nights: 1 }
}

/**
 * Resolves the stored stay, upgrading either of the two older shapes on first read: the day
 * presets that preceded it, and before those a bare weekday array. Pure — takes raw strings
 * so the migration is testable without a DOM, which matters because it runs once and then
 * deletes what it read.
 */
export function migrateStay(
  arrivalDaysRaw: string | null,
  nightsRaw: string | null,
  presetRaw: string | null,
  customRaw: string | null,
  legacyWeekdaysRaw: string | null,
): StaySelection {
  const nights = nightsRaw === null ? undefined : Number(nightsRaw)
  const stored = parseArray(arrivalDaysRaw)
  // An empty stored selection is respected: the UI prompts for it rather than guessing.
  if (Array.isArray(stored)) return normalizeStay(stored, nights)

  if (presetRaw === 'weekend') return { arrivalDays: [5, 6, 7], nights: 1 }
  if (presetRaw === 'any') return { arrivalDays: [...ALL_DAYS], nights: 1 }
  if (presetRaw === 'custom') return stayForWeekdays(normalizeDays(parseArray(customRaw)))

  const legacy = normalizeDays(parseArray(legacyWeekdaysRaw))
  if (legacy.length > 0) return stayForWeekdays(legacy)

  return DEFAULT_STAY
}
