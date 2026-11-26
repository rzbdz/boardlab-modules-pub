/**
 * The market's page parts as a browser gets them. The page imports a module's `ui` file as it is, so what is committed
 * must be built from the source beside it and must reach the SDK only through the import map's name.
 */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { build } from 'esbuild'

const here = import.meta.dirname
const manifest = JSON.parse(readFileSync(join(here, 'market.json'), 'utf8')) as {
  modules: Array<{ id: string, ui?: string, cli?: string, entry: string }>
}

/** A module's page part, built from `ui.ts` beside it the way `pnpm build` does. */
async function rebuilt(outfile: string): Promise<string> {
  const source = ['.ts', '.tsx'].map(ext => outfile.replace(/\.js$/, ext)).find(path => existsSync(path))!
  const result = await build({
    entryPoints: [source], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    external: ['boardlab/ui', 'boardlab'], legalComments: 'none', sourcemap: false,
  })
  return result.outputFiles[0]!.text
}

describe('the page parts the market carries', () => {
  const withUi = manifest.modules.filter(module => module.ui)

  it('has one for every module the page shows, and the file is there', () => {
    expect(withUi.map(module => module.id).sort()).toEqual(['alerts', 'console-watch', 'feedback', 'human', 'market'])
    for (const module of withUi) expect(existsSync(join(here, module.ui!))).toBe(true)
  })

  it('reaches the SDK by the import map\'s name, and nothing else outside its file', () => {
    for (const module of withUi) {
      const text = readFileSync(join(here, module.ui!), 'utf8')
      expect(text).toMatch(/from\s*["']boardlab\/ui["']/)
      // A relative import would mean the module imports a file the page cannot fetch (only its own file is served).
      expect(text).not.toMatch(/from\s*["']\.\.?\//)
    }
  })

  it('is the build of the source beside it: a stale ui.js is a page that shows an old module', async () => {
    for (const module of withUi) {
      const outfile = join(here, module.ui!)
      if (!existsSync(outfile.replace(/\.js$/, '.ts'))) continue
      expect(readFileSync(outfile, 'utf8'), `${module.id}: run pnpm build`).toBe(await rebuilt(outfile))
    }
  })

  it('names a command file and an entry for every module, and they exist', () => {
    for (const module of manifest.modules) {
      expect(existsSync(join(here, module.entry)), `${module.id} entry`).toBe(true)
      if (module.cli) expect(existsSync(join(here, module.cli)), `${module.id} cli`).toBe(true)
    }
  })

  it('carries a help page for every page a module\'s view links to', () => {
    for (const module of withUi) {
      const page = dirname(join(here, module.ui!))
      const docs = join(page, 'docs')
      if (!existsSync(docs)) continue
      // The view's help link, and not a field's (`{ kind: 'text', …, help: '…' }`): a view's is by name.
      const help = /\bhelp:\s*['"]([a-z0-9-]+\/[a-z0-9-]+)['"]/.exec(readFileSync(join(here, module.ui!), 'utf8'))?.[1]
      if (!help) continue
      const [owner, name] = help.split('/')
      expect(owner, `${module.id}: a help page of its own is named <module>/<page>`).toBe(module.id)
      expect(existsSync(join(docs, `${name}.md`)), `${module.id}: docs/${name}.md`).toBe(true)
    }
  })
})

describe('this market as boardd loads it', () => {
  it('is what the manifest says, read by the reader boardd uses', () => {
    // The real reader, run in a child: the market's own tests do not depend on the distribution's source layout.
    const reader = process.env.BOARDLAB_CORE ?? resolve(here, '../better-boardlab/core')
    const out = execFileSync(process.execPath, ['-e', `
      const { readMarket } = await import(${JSON.stringify(join(reader, 'src/core/module-markets.ts'))})
      console.log(JSON.stringify(readMarket('pub', ${JSON.stringify(here)})))
    `, '--input-type=module', '--experimental-transform-types', '--no-warnings'], { encoding: 'utf8' })
    const read = JSON.parse(out.trim().split('\n').at(-1)!)
    expect(read.problems).toEqual([])
    expect(read.modules.map((module: { id: string }) => module.id).sort()).toEqual(['alerts', 'console-watch', 'feedback', 'human', 'market', 'nexus-images', 'sftp-images'])
  })
})
