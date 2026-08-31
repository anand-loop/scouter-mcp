#!/usr/bin/env node
// One bundled dist/index.js with a shebang.
//
// Bundling is not an optimisation here, it is the fix for the port's one build hazard:
// every relative import in the ported core is extensionless (`from './geo'`), which
// TypeScript's bundler resolution accepts and Node's ESM loader does not. esbuild resolves
// them at build time, so nothing reaches Node that it cannot load.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20.19',
  format: 'esm',
  // Off by default, and deliberately so: esbuild embeds `sourcesContent`, which would put
  // the complete original TypeScript of src/core/ — a copy of a private repo — into the
  // published tarball. Set SOURCEMAP=1 for a local debugging build.
  sourcemap: process.env.SOURCEMAP === '1',
  // Left external so the SDK resolves its own deps at runtime rather than being inlined.
  packages: 'external',
  banner: { js: '#!/usr/bin/env node' },
})

console.error(`Built dist/index.js${process.env.SOURCEMAP === '1' ? ' + sourcemap' : ''}`)
