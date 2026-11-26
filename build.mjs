#!/usr/bin/env node
/**
 * Build every module's page part: a market carries its modules' `ui` files as browser JavaScript, because the page
 * imports one as it is (`/module-ui/<module>/<file>`), with `boardlab/ui` — the import map's name for the SDK — left
 * external.
 *
 *   node build.mjs
 *
 * A manifest entry names its page part with `ui`, as the file the page loads (`<module>/ui.js`); the source it is built
 * from is the same name with `.ts`/`.tsx` beside it. A module that writes its page part in plain `.js` already has no
 * source and is left alone.
 *
 * The `ui` files import the SDK through `boardlab/ui`; the import map in every frontend's `index.html` points that at
 * boardd's own `sdk.browser.js`, so a market brings no copy of boardlab with it. Only that one name is external:
 * anything else a `ui` file imports is bundled in, or the build fails and says which import it could not resolve.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { build } from 'esbuild'

const here = import.meta.dirname
const manifestFile = join(here, 'market.json')
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
const built = []
const problems = []

for (const item of manifest.modules ?? []) {
  if (typeof item.ui !== 'string' || !item.ui.endsWith('.js')) continue
  const outfile = resolve(here, item.ui)
  const source = ['.ts', '.tsx'].map(ext => outfile.replace(/\.js$/, ext)).find(path => existsSync(path))
  if (!source) { if (!existsSync(outfile)) problems.push(`${item.id}：ui ${item.ui} 不在，也没有同名的 .ts`); continue }
  try {
    await build({
      entryPoints: [source], outfile, bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
      external: ['boardlab/ui', 'boardlab'], legalComments: 'none', sourcemap: false,
    })
    built.push(`${item.id}: ${relative(here, source)} -> ${item.ui}`)
  } catch (error) { problems.push(`${item.id}：${error.message}`) }
}

if (problems.length) { for (const problem of problems) console.error(`!! ${problem}`); process.exit(1) }
for (const line of built) console.log(`built ${line}`)
if (!built.length) console.log('nothing to build')
