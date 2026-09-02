// The WHEN value on the home screen — "Fri & Sat in August & September".
//
// Always derived, never stored: it's a rendering of the day selection and the month
// selection, and storing it would be one more thing to keep in sync with them.
import { ALL_DAYS, DAY_ABBR, DAY_NAME } from './days'
import { type MonthKey, monthLongLabel, monthShortLabel } from './months'
import { type StaySelection, stayText } from './stay'

/** "A" · "A & B" · "A, B & C" — an ampersand before the last item, no Oxford comma. */
export function joinWithAmpersand(parts: string[]): string {
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} & ${parts[parts.length - 1]}`
}

/**
 * "Fri arrival" · "Fri & Sat arrivals" · "Any arrival day" when every day is picked.
 * Empty when nothing is selected, which callers turn into a prompt.
 */
export function arrivalPhrase(arrivalDays: number[]): string {
  if (arrivalDays.length === 0) return ''
  if (arrivalDays.length === ALL_DAYS.length) return 'Any arrival day'
  const days = joinWithAmpersand([...arrivalDays].sort((a, b) => a - b).map((d) => DAY_ABBR[d]))
  return `${days} ${arrivalDays.length === 1 ? 'arrival' : 'arrivals'}`
}

/**
 * "Friday" · "Friday or Saturday" · "any day" — the arrival days inside a sentence.
 *
 * Spelled out and joined with "or" rather than "&", because this reads as prose ("starting
 * on a Friday or Saturday") where the abbreviated list reads as a label. Every day selected
 * collapses, as it does in `arrivalPhrase`: naming all seven says less than "any day".
 */
export function arrivalDaysSentence(arrivalDays: number[]): string {
  if (arrivalDays.length === 0) return ''
  if (arrivalDays.length === ALL_DAYS.length) return 'any day'
  const names = [...arrivalDays].sort((a, b) => a - b).map((d) => DAY_NAME[d])
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}

/** "Fri & Sat" — the bare day list, for sentences that supply their own preposition. */
export function daysList(arrivalDays: number[]): string {
  return joinWithAmpersand([...arrivalDays].sort((a, b) => a - b).map((d) => DAY_ABBR[d]))
}

/**
 * "September" for one month, "Aug & Sep" for several — the months half, compressed.
 *
 * For the 12px second line of a recent-search row, where the full phrase would ellipsise
 * away the arrival day that precedes it. A lone month keeps `monthLongLabel`, and with it
 * that function's year rule: there is room for it, and "Jan" alone can't say which January.
 */
export function monthsPhraseCompact(monthKeys: MonthKey[], today: Date): string {
  const keys = [...monthKeys].sort()
  if (keys.length === 1) return monthLongLabel(keys[0], today)
  return joinWithAmpersand(keys.map(monthShortLabel))
}

export interface WhenText {
  /** "Fri & Sat arrivals · 2 nights" */
  label: string
  /** "in August & September" — empty when there is no month to name. */
  sub: string
}

/** The months half, in calendar order. */
export function monthsPhrase(monthKeys: MonthKey[], today: Date): string {
  return joinWithAmpersand([...monthKeys].sort().map((k) => monthLongLabel(k, today)))
}

/**
 * The WHEN block's two lines.
 *
 * Returned together so the empty rule lives in one place rather than in two call sites that
 * have to agree. Months are the only input that can be empty — an arrival day and a night
 * count are always valid — so there is exactly one prompt to render.
 */
export function whenText(
  stay: StaySelection,
  monthKeys: MonthKey[],
  today: Date,
): WhenText {
  if (monthKeys.length === 0) return { label: 'Pick a month', sub: '' }
  if (stay.arrivalDays.length === 0) return { label: 'Pick an arrival day', sub: '' }
  return {
    label: `${arrivalPhrase(stay.arrivalDays)} · ${stayText(stay.nights)}`,
    // Abbreviated, because this is one line of a card row that also has to hold the arrival
    // day and the stay length: "in August & September" is the half that pushes the row into
    // an ellipsis, and it is the half that survives compression intact. A lone month keeps
    // its full name — there is room for it, and "Jan" alone can't say which January.
    sub: `in ${monthsPhraseCompact(monthKeys, today)}`,
  }
}
