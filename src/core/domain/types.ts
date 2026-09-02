import type { MonthKey } from './months'
import type { SiteTypeId } from './siteTypes'
import type { StaySelection } from './stay'

// Domain models — ports of com.scouter.domain.Models and data.prefs.SavedCampground.

/** A campground the user has saved to their watchlist. */
export interface SavedCampground {
  facilityId: number
  placeId: number
  name: string
  parkName: string
}

/** User's search: the stay they want, and the calendar months to look in. */
export interface WatchSettings extends StaySelection {
  /** Calendar months to search, "YYYY-MM", ascending. */
  monthKeys: MonthKey[]
  /**
   * Which kinds of site count as a match. Here rather than on StaySelection, which would
   * drag it through the two generations of stay migration for no reason — a site type is
   * not part of "when", it is part of "what".
   */
  siteTypes: SiteTypeId[]
}

/** A searchable campground from the catalog. */
export interface Facility {
  facilityId: number
  placeId: number
  name: string
  parkName: string
}

/** A bookable site that is free on a given date. `label` is the site's short name/number. */
export interface FreeSite {
  unitId: number
  label: string
}

/**
 * One candidate stay: the arrival night, and the sites bookable for the *whole* stay.
 *
 * The length isn't here on purpose — every result in a scan shares it, so a per-row copy
 * would be N copies of one fact and N chances to disagree. Consumers that render it take
 * it from the screen, which already holds the search.
 */
export interface StayResult {
  /** Arrival night, yyyy-MM-dd. */
  date: string
  /** Units free on `date` and every night after — bookable as one reservation. */
  freeSites: FreeSite[]
}

/** Computed availability for one saved campground over the selected weekdays/horizon. */
export interface CampgroundAvailability {
  campground: SavedCampground
  results: StayResult[]
  error?: string
  /** Every kind of site here, filter or no filter — what the campground is. */
  siteTypes?: SiteTypeId[]
  /** Longest vehicle any site here takes, in feet. Absent when none is recorded. */
  maxVehicleLength?: number
  /** Set only by a nearby scan — distance from the searched location. */
  distanceMiles?: number
  /** Where to plot this campground: its own coordinates, else its park's. */
  location?: { lat: number; lng: number }
}
