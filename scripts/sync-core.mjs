#!/usr/bin/env node
// Copies the scan pipeline out of scouter-web and records what was taken.
//
// The files land byte-identical — no reformatting, no import rewriting, no header stamped
// into them — so `diff` against the source is always meaningful and a re-sync is a no-op
// when nothing moved. Everything scouter-mcp adds lives outside src/core/.
//
//   node scripts/sync-core.mjs          # copy, then write the manifest
//   node scripts/sync-core.mjs --check  # verify only; non-zero exit on drift
//
// --check is the guard against the one real hazard of porting rather than sharing: the
// availability rules quietly disagreeing between the two projects. It compares src/core/
// against its manifest always, and against the live scouter-web when that checkout is
// present.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const CORE = join(ROOT, 'src', 'core')
const MANIFEST = join(CORE, 'MANIFEST.json')

const SOURCE = process.env.SCOUTER_WEB ?? resolve(ROOT, '..', 'scouter-web')

/**
 * What the scan needs, and nothing else.
 *
 * Excluded on purpose: api/geolocation.ts and api/share.ts (browser-only, and a scan never
 * touches them), all of src/store/ (localStorage — an MCP scan is fully specified by its
 * arguments), and the label modules, since an agent wants fields rather than "Fri & Sat
 * arrivals · 2 nights".
 *
 * whenLabel.ts is the one label module that comes anyway, and not for its labels:
 * siteTypes.ts imports joinWithAmpersand from it. Copying the module is better than the
 * alternatives — rewriting the import would break the byte-identical rule, and reimplementing
 * three lines here would put a second copy of a shared helper in the tree.
 *
 * nominatim.ts is here for its *pure* halves — the parser, the ranker, the region label.
 * Its two fetch functions cannot work under Node and are never called; see src/node/geocode.ts.
 */
const FILES = [
  'domain/types.ts',
  'domain/days.ts',
  'domain/stay.ts',
  'domain/dates.ts',
  'domain/months.ts',
  'domain/calendar.ts',
  'domain/geo.ts',
  'domain/parks.ts',
  'domain/nights.ts',
  'domain/estimate.ts',
  'domain/siteTypes.ts',
  'domain/whenLabel.ts',
  'domain/availability.ts',
  'domain/catalog.ts',
  'domain/scanner.ts',
  'domain/nominatim.ts',
  'api/rcApi.ts',
  'api/limiter.ts',
]

/**
 * The upstream tests come with the code — ~200 assertions pinning the availability rules on
 * this side too, for the cost of copying them. A botched port fails `npm test` rather than
 * silently returning different dates from the web app.
 */
const TESTS = [
  'domain/stay.test.ts',
  'domain/months.test.ts',
  'domain/calendar.test.ts',
  'domain/geo.test.ts',
  'domain/parks.test.ts',
  'domain/nights.test.ts',
  'domain/estimate.test.ts',
  'domain/siteTypes.test.ts',
  'domain/whenLabel.test.ts',
  'domain/availability.test.ts',
  'domain/scanner.test.ts',
  'domain/nominatim.test.ts',
  'api/limiter.test.ts',
]

const ALL = [...FILES, ...TESTS]

const sha = (buf) => createHash('sha256').update(buf).digest('hex')

async function sourceCommit() {
  try {
    const { stdout } = await run('git', ['-C', SOURCE, 'rev-parse', 'HEAD'])
    return stdout.trim()
  } catch {
    return null
  }
}

async function check() {
  if (!existsSync(MANIFEST)) {
    console.error('No MANIFEST.json — run `npm run sync:core` first.')
    process.exit(1)
  }
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'))
  const problems = []

  for (const [rel, want] of Object.entries(manifest.files)) {
    const path = join(CORE, rel)
    if (!existsSync(path)) {
      problems.push(`${rel}: missing from src/core/`)
      continue
    }
    const got = sha(await readFile(path))
    if (got !== want) problems.push(`${rel}: edited locally — src/core/ must stay byte-identical`)
  }

  const haveSource = existsSync(join(SOURCE, 'src'))
  if (!haveSource) {
    console.error(`scouter-web not found at ${SOURCE}; checked the manifest only.`)
  } else {
    for (const rel of ALL) {
      const from = join(SOURCE, 'src', rel)
      if (!existsSync(from)) {
        problems.push(`${rel}: gone from scouter-web — the port list is out of date`)
        continue
      }
      const got = sha(await readFile(from))
      if (got !== manifest.files[rel]) problems.push(`${rel}: scouter-web has moved on`)
    }
  }

  if (problems.length > 0) {
    console.error('Core is out of sync with scouter-web:\n')
    for (const p of problems) console.error(`  ${p}`)
    console.error('\nRun `npm run sync:core`, then re-read the diff before trusting a scan.')
    process.exit(1)
  }
  console.error(`Core matches scouter-web${manifest.commit ? ` @ ${manifest.commit.slice(0, 7)}` : ''}.`)
}

async function sync() {
  if (!existsSync(join(SOURCE, 'src'))) {
    console.error(`scouter-web not found at ${SOURCE}. Set SCOUTER_WEB to its path.`)
    process.exit(1)
  }
  const files = {}
  for (const rel of ALL) {
    const buf = await readFile(join(SOURCE, 'src', rel))
    const to = join(CORE, rel)
    await mkdir(dirname(to), { recursive: true })
    await writeFile(to, buf)
    files[rel] = sha(buf)
  }
  await writeFile(
    MANIFEST,
    `${JSON.stringify(
      { source: 'scouter-web', commit: await sourceCommit(), syncedAt: new Date().toISOString(), files },
      null,
      2,
    )}\n`,
  )
  console.error(`Synced ${ALL.length} files from ${SOURCE}.`)
}

await (process.argv.includes('--check') ? check() : sync())
