# scouter-mcp

Finds open campsites in California state parks by searching
[ReserveCalifornia](https://www.reservecalifornia.com), exposed as MCP tools over stdio.
Ask an area, a date range and a length of stay; get back the dates a site is actually
bookable for the whole trip.

## Install

Requires Node 20.19+.

```bash
claude mcp add scouter -- npx -y scouter-mcp
```

Or, for any MCP client that reads a JSON config (Claude Desktop, Cursor, VS Code, …):

```json
{
  "mcpServers": {
    "scouter": {
      "command": "npx",
      "args": ["-y", "scouter-mcp"]
    }
  }
}
```

From source instead:

```bash
git clone https://github.com/anand-loop/scouter-mcp && cd scouter-mcp
npm install && npm run build
claude mcp add scouter -- node "$PWD/dist/index.js"
```

## Tools

| Tool | Arguments | Returns |
|---|---|---|
| `find_availability` | `where`, `when`, `siteTypes?`, `maxCampgrounds?` | **The main one.** Open dates and per-campground counts, grouped by park, with `nextOpen` hoisted to the top. No site numbers. |
| `get_sites` | `facilityId`, `date`, `nights?`, `siteTypes?` | The drill-down: which specific sites are free at one campground on one date. |
| `list_campgrounds` | `where` | What's in the radius, nearest first. Catalog-only, so instant and free. |
| `find_campground` | `query`, `limit?` | `facilityId` for a campground or park by name. |
| `geocode_place` | `query`, `limit?` | Coordinates for a town, ZIP or address, most-specific first. |
| `estimate_search` | `where`, `when`, `siteTypes?`, `maxCampgrounds?` | How many campgrounds and dates a scan would cover, and roughly how long it'd take. Free — worth calling before a wide radius over several months. |

### Shared arguments

**`where`** — exactly one of:

- `place` — a town, ZIP or address, e.g. `"Big Sur"`. Geocoded; the response reports which
  match it used and lists the others, since a county centroid can sit far from the town of
  the same name.
- `lat` + `lng`
- `facilityId` — one specific campground

Areas also take `radiusMiles` (default `50`, max `200`). `facilityId` doesn't — a radius
around a single campground means nothing.

**`when`** — a date range *or* whole months, never both. Everything is optional:

| Field | Default |
|---|---|
| `from` | today |
| `to` | end of the ~4-month booking horizon |
| `months` | `["2026-09"]` — an alternative to `from`/`to` |
| `nights` | `1` (max 3) |
| `arrivalDays` | any day. Monday=1 … Sunday=7 |

**`siteTypes`** — `standard`, `group`, `lodging`, `hike-in`, `rv`, `equestrian`,
`environmental`, `day-use`. Omitted, it means everything you can sleep in; day-use areas
are excluded unless you name them.

**A stay is one site for the whole trip.** A two-night Saturday arrival matches only when a
single site is free Saturday *and* Sunday — "something was free each night" would count
stays nobody can book.

## Example prompts

> Find me the next available campsite in Big Sur where I can arrive on a Saturday.

> Anything open within 30 miles of Santa Cruz for two nights in October?

> Is there a hike-in site at Big Basin this month? Which sites, exactly?

> What campgrounds are near Mendocino, and what would scanning all of them cost?

> Can I get an RV that fits a 30 ft trailer somewhere near Lake Tahoe in September?

## Configuration

All optional.

| Variable | Effect |
|---|---|
| `TZ` | Defaults to `America/Los_Angeles`. The process timezone decides what "today" and "September" mean, and the booking API deals in Pacific civil dates. |
| `SCOUTER_WEB_URL` | When set, `find_availability` includes a `shareUrl` into the Scouter web app — a link the agent can hand a human. |
| `SCOUTER_USER_AGENT` | Overrides how the server identifies itself to Nominatim. Their policy wants a real one with a way to reach the operator. |

## Notes and limits

- `find_availability` returns counts, not site numbers — a three-weekday search over two
  months is ~1,000 results, and serializing every site list runs to hundreds of KB.
  `get_sites` fetches the labels for the one campground and date you care about.
- A scan is capped at the 40 nearest campgrounds (~10 MB, ~10 s). `found` reports how many
  were really in range, so a truncated scan never passes for a complete one.
- Campgrounds carry `tags` — "Hike-in only", "RV up to 30 ft" — read from every unit,
  including the kinds the filter excluded, so "will a trailer fit?" needs no second scan.
- Booking URLs are campground-level; ReserveCalifornia can't preselect a night, so dates
  are reported rather than made to look selectable.
- The catalog is fetched once per process (~675 KB) and cached, after which
  `list_campgrounds` and `find_campground` cost nothing.
- Geocoding by [Nominatim](https://nominatim.openstreetmap.org), data © OpenStreetMap
  contributors, ODbL. A free community service — keep usage light.

## Development

```bash
npm test         # 328 tests, mostly the ported availability rules
npm run build    # typecheck, then bundle to dist/index.js with esbuild
npm run inspect  # build and open the MCP Inspector
```

## License

MIT
