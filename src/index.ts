// scouter-mcp — campsite availability search for ReserveCalifornia, as MCP tools.
//
// Two things have to happen before anything else, in this order.
//
// 1. The timezone. `today()` is startOfDay(new Date()) and monthStart/monthEnd build local
//    dates, so the process TZ decides what "September" and "today" mean. Every park is in
//    California and the booking API deals in Pacific civil dates, so a server left on UTC
//    would drop the current day's arrivals for seven hours every evening. Set before any
//    module reads a clock.
process.env.TZ ??= 'America/Los_Angeles'

// 2. Nothing but protocol frames on stdout. A stray console.log corrupts the JSON-RPC
//    stream and the client's failure looks nothing like its cause, so console.log is
//    re-pointed at stderr before any dependency gets the chance to use it.
console.log = console.error

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { preloadCatalog } from './core/domain/catalog'
import { registerTools } from './tools/index'

const server = new McpServer(
  { name: 'scouter', version: '0.2.0' },
  {
    instructions:
      'Finds open campsites in California state parks through ReserveCalifornia. A "stay" means one site free for every night of the trip, which is what can actually be booked. Start with find_availability — it accepts a place name directly and defaults to any arrival day, one night, the next four months, and every kind of site you can sleep in (day-use areas are excluded unless siteTypes names them). Call get_sites afterwards for the actual site numbers, and estimate_search first if the radius is wide and the window long.',
  },
)

registerTools(server)

// Deliberately not awaited: `initialize` must answer immediately, and every tool waits on
// this through the catalog's own module-level singleton anyway. Two requests and ~675 KB
// once per process, after which all catalog work is in memory.
preloadCatalog()

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('scouter-mcp ready on stdio')
