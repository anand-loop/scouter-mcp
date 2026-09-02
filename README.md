# scouter-mcp

Campsite availability search for [ReserveCalifornia](https://www.reservecalifornia.com),
exposed as MCP tools over stdio. The same question the
[Scouter web app](../scouter-web) answers — *is anything open on these dates?* — asked by an
agent instead of a person.

```bash
npm install && npm run build
claude mcp add scouter -- node "$PWD/dist/index.js"
```

> "Find me the next available campsite in Big Sur where I can arrive on a Saturday."

## Tools

| Tool | Cost | Answers |
|---|---|---|
| `geocode_place` | 1 request, ≥1.1 s | Where is Big Sur? |
| `find_campground` | free after warm-up | What's the ID for Pfeiffer Big Sur? |
| `list_campgrounds` | free after warm-up | What's within 30 mi? |
| `estimate_search` | free after warm-up | What will that scan cost? |
| `find_availability` | seconds | **What's open?** |
| `get_sites` | ~1 s | Which sites, exactly? |

Three argument shapes are shared, so the vocabulary is learned once.

**`where`** is an area or one campground — the same two answers the app's picker offers.
`{ place, radiusMiles }`, `{ lat, lng, radiusMiles }`, or `{ facilityId }`. A radius around a
single campground would mean nothing, so that variant doesn't take one. When `place` is used
the response reports **which match was chosen and lists the others**: a county centroid can
sit thirty miles from the town of the same name, and an agent that silently searched the
wrong one has no way to notice.

**`when`** is a date range or whole calendar months, never both. Everything in the range form
is optional, because the question an agent usually carries is open-ended:

- `from` defaults to today — "the next available" must not offer dates that have passed.
- `to` defaults to the end of the four-month booking horizon. Wider would spend requests on
  months the reservation system has nothing to say about.
- `nights` defaults to **1**, deliberately not the app's 2. A longer stay is a strictly
  narrower search, so an unstated stay length should give the broadest true answer.
- `arrivalDays` defaults to every day. Monday=1 … Sunday=7.

**`siteTypes`** is what kind of site counts as a match, named rather than numbered:
`standard`, `group`, `lodging`, `hike-in`, `rv`, `equestrian`, `environmental`, `day-use`.
Omitted, it means **everything you can sleep in** — day use has to be asked for, because
"Weber Point Picnic Area, 1 site free" is not an answer to *where can I camp?*, and an agent
that can't tell the two apart will report it as one. `get_sites` takes it too and defaults
identically, so a drill-down can never contradict the count that sent the agent there.

So `find_availability({ place: "Big Sur", arrivalDays: [6] })` is a complete question, and
`find_availability({ place: "Big Sur", siteTypes: ["hike-in"] })` is a narrower one.

**A stay is one site for the whole trip.** A two-night Saturday arrival matches only when a
single site is free on Saturday *and* Sunday — "something was free each night" would count
stays nobody can book.

## Summary, then drill down

`find_availability` returns open dates and per-campground **counts**, grouped under their
park, with `nextOpen` hoisted to the top. It never returns site numbers.

That isn't tidiness. The scan emits one result per candidate date whether or not anything is
free, so a three-weekday search over two months is ~1,000 results — serialized with their
site lists, hundreds of KB, most of it empty. `get_sites` fetches the labels for one
campground and date once the agent knows which it wants. A test asserts that no site label
can escape the summary.

Each campground also carries `tags` — "Hike-in only", "RV up to 30 ft" — derived from the
categories its units actually report. They describe the *campground*, not the search: they
are read from every unit including the kinds the filter excluded, so "will a trailer fit?" is
answered without a second scan.

Campgrounds nest under their park for the same reason the web UI does it: a radius scan
routinely returns four campgrounds from one park, and repeating the park name on four
consecutive entries spends tokens restating the entry above.

## The port

`src/core/` is copied **byte-identical** from scouter-web and never edited here — no
reformatting, no import rewriting — so a diff against the source is always meaningful.
`MANIFEST.json` records a SHA-256 per file and the commit it came from.

```bash
npm run sync:core    # re-copy from ../scouter-web (or $SCOUTER_WEB)
npm run check:core   # fail if src/core/ was edited, or scouter-web has moved on
```

The upstream test suites come with the code — ~260 assertions pinning the availability rules
on this side too — so a botched port fails `npm test` rather than quietly returning different
dates from the web app.

The port is the scan pipeline and nothing else: no `src/store/` (an MCP scan is fully
specified by its arguments) and no label modules, since an agent wants fields rather than
"Fri & Sat arrivals · 2 nights". `domain/whenLabel.ts` is the one exception, and not for its
labels — `siteTypes.ts` imports `joinWithAmpersand` from it, and copying the module beats
rewriting an import in a tree that has to stay byte-identical.

Two things bend around the port rather than the port bending around them. `tsconfig.json`
keeps `lib: DOM` even though this is a Node project, because the core must typecheck exactly
as it does upstream. And the build bundles with esbuild, because every relative import in
the core is extensionless (`from './geo'`) — which TypeScript's bundler resolution accepts
and Node's ESM loader does not.

The published tarball carries `dist/index.js` and nothing else. Sourcemaps are off by
default (`SOURCEMAP=1 npm run build` for a debugging build) because esbuild embeds the
original sources, which would ship scouter-web's TypeScript verbatim.

`src/node/geocode.ts` is the one deliberate exception. Nominatim answers 403 without a
User-Agent, which browsers send automatically and `fetch` cannot override — so
`core/domain/nominatim.ts` documents itself as browser-only and says not to "fix" it. The
Node sibling sends the header and reuses the same URLs, parser and ranker, so the two can't
disagree about what a result means.

## Environment

| Variable | Effect |
|---|---|
| `TZ` | Defaults to `America/Los_Angeles`. The process timezone decides what "today" and "September" mean; every park is in California and the booking API deals in Pacific civil dates. |
| `SCOUTER_WEB_URL` | When set, `find_availability` includes a `shareUrl` into the web app — something the agent can hand a human. |
| `SCOUTER_USER_AGENT` | Overrides the Nominatim identification. Their policy requires a real one with a way to reach the operator. |
| `SCOUTER_WEB` | Where `sync:core` reads from. Defaults to `../scouter-web`. |
| `SOURCEMAP` | Set to `1` to emit `dist/index.js.map`. Off by default; see the port notes. |

## Notes and limits

- **The grid endpoint caps at 21 days per request** — ask for more and it silently returns
  21 slices with no error, and the missing dates read as *booked* rather than unknown.
  `WINDOW_DAYS` is 21 upstream for exactly this reason and must not be raised without
  re-measuring; the ported `availability.test.ts` pins it.
- **Day-use areas are not campsites.** They are excluded by default and counted only when
  `siteTypes` names `day-use`. The filter is applied per unit *before* multi-night spans are
  intersected, so a two-night stay is never reported via a site the caller excluded.
- A campground's coordinates are taken from the grid response, but discarded when they land
  more than 25 mi from their own park — a handful of catalog rows drop a minus sign or point
  at the wrong county, and a park's position is the mean of its campgrounds.
- Booking URLs are campground-level; the API cannot preselect a night, so dates are reported
  rather than made to look selectable.
- A scan is capped at the 40 nearest campgrounds (~10 MB, ~10 s). `found` reports how many
  were actually in range, so a truncated scan never passes for a complete one.
- The catalog is fetched once per process (~675 KB, two requests) and cached in memory;
  after that `list_campgrounds` and `find_campground` cost nothing.
- Attribution: geocoding by [Nominatim](https://nominatim.openstreetmap.org), data
  © OpenStreetMap contributors, ODbL. A free community service — keep usage light.
