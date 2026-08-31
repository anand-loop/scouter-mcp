// Weekday vocabulary. Numbers are java.time.DayOfWeek (MON=1 … SUN=7) throughout, matching
// the rest of the domain and the Android original.
//
// What a search *does* with a weekday lives in stay.ts; this file is only labels.

export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7]

export const DAY_ABBR: Record<number, string> = {
  1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun',
}

/** Single- and double-letter labels for the seven-across arrival row. */
export const DAY_MICRO: Record<number, string> = {
  1: 'M', 2: 'T', 3: 'W', 4: 'Th', 5: 'F', 6: 'S', 7: 'Su',
}

/** Spelled out — the accessible name for a pill labelled with one letter. */
export const DAY_NAME: Record<number, string> = {
  1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday',
  5: 'Friday', 6: 'Saturday', 7: 'Sunday',
}
