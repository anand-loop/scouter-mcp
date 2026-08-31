// Civil-date helpers mirroring the java.time.LocalDate usage in the Android app.
// Dates are kept as local Date objects at midnight; equality/keys use yyyy-MM-dd strings
// to avoid timezone/DST pitfalls.
import { addDays, addMonths, format, isAfter, startOfDay } from 'date-fns'

export type IsoDate = string // yyyy-MM-dd

/** Today at local midnight (the app's "now"). */
export function today(): Date {
  return startOfDay(new Date())
}

/** MM-dd-yyyy — the format the grid endpoint expects. */
export function requestDate(d: Date): string {
  return format(d, 'MM-dd-yyyy')
}

/** yyyy-MM-dd — used as a stable date key/label. */
export function isoDate(d: Date): IsoDate {
  return format(d, 'yyyy-MM-dd')
}

/** java.time.DayOfWeek numbering: MON=1 … SUN=7. */
export function javaDayOfWeek(d: Date): number {
  const js = d.getDay() // Sun=0 … Sat=6
  return js === 0 ? 7 : js
}

export { addDays, addMonths, isAfter }
