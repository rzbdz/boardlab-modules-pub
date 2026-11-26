/**
 * The market module: module markets are git repositories, and the page shows the ones this machine has — what each
 * offers, which of those boardd loaded — and does what a person does with them: add one, install a module, take one out,
 * pull newer versions, reload boardd. Adding a market is also the CLI's job (`boardlab market add`).
 *
 * A real git repository stands in for a market (a real `git init`), so the chain the page depends on — a market added →
 * boardd's copy → manifest read → page API → install into boardd.json → update — is the one exercised.
 */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from 'boardlab-core/core/db.ts'
import { BoardLab } from 'boardlab-core/core/lab.ts'
import { market, type MarketState } from './index.ts'

const dirs: string[] = []
/** A directory this test owns, removed after it. */
function dir(): string {
  const made = mkdtempSync(join(tmpdir(), 'boardlab-market-'))
  dirs.push(made)
  return made
}
process.on('exit', () => { for (const made of dirs) rmSync(made, { recursive: true, force: true }) })

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.org', ...args], { cwd, encoding: 'utf8' }).trim()

/** A market repository: `probe` adds nothing, it is only listed. */
function marketRepo(name: string): string {
  const at = join(dir(), name)
  mkdirSync(join(at, 'probe'), { recursive: true })
  writeFileSync(join(at, 'market.json'), JSON.stringify({ modules: [{ id: 'probe', title: '探针', tags: ['content'], inject: [], provide: [] }] }))
  writeFileSync(join(at, 'probe/module.js'), 'export default { id: "probe", title: "探针", setup: () => ({}) }')
  git(at, 'init', '-q', '-b', 'main'); git(at, 'add', '-A'); git(at, 'commit', '-q', '-m', 'market')
  return at
}

async function call(lab: BoardLab, method: 'GET' | 'POST', path: string, body: Record<string, unknown> = {}, holder = 'user:dana'): Promise<any> {
  const url = new URL(path, 'http://boardd')
  const found = lab.api.match(method, url.pathname)
  if (!found) throw new Error(`no ${method} ${url.pathname}`)
  return found.endpoint.handle({ query: url.searchParams, params: found.params, body, caller: { holder, local: true } } as never)
}

/** A boardd with the market module, over a state directory of its own (the one every call in the test then uses). */
const labAt = (sub: string) => {
  state = dir()
  return new BoardLab({ db: openDatabase(join(state, `${sub}.sqlite`)), stateDir: state, modules: [market] })
}

/** The state directory the test's lab uses, set by `labAt` and read by the clone and the config writes. */
let state = ''

describe('the module market on the page', () => {
  it('lists the markets the CLI added, with what each offers and which of it boardd loaded', async () => {
    const lab = labAt('list')
    // The CLI writes the record and clones the market; the page reads the same files, so a market added on the
    // command line shows up without asking boardd again.
    expect(await call(lab, 'GET', '/api/market')).toEqual({ markets: [], problems: [], selected: [], canReload: false })
    const repo = marketRepo('listed')
    const { syncMarket } = await import('boardlab-core/core/module-markets.ts')
    const synced = await syncMarket(state, 'pub', { url: repo })
    writeFileSync(join(state, 'markets.json'), JSON.stringify({ markets: [{ id: 'pub', url: repo, branch: null, commit: synced.commit }] }))
    const after = await call(lab, 'GET', '/api/market') as MarketState
    expect(after.markets).toHaveLength(1)
    expect(after.markets[0]).toMatchObject({ id: 'pub', url: repo, modules: [{ id: 'probe', title: '探针', tags: ['content'] }] })
    expect(after.markets[0]!.problems).toEqual([])
  })

  it('pulls a market to its newest commit and says what changed, and a person is the one who may', async () => {
    const lab = labAt('update')
    const repo = marketRepo('updated')
    const { syncMarket } = await import('boardlab-core/core/module-markets.ts')
    const first = await syncMarket(state, 'up', { url: repo })
    writeFileSync(join(state, 'markets.json'), JSON.stringify({ markets: [{ id: 'up', url: repo, branch: null, commit: first.commit }] }))
    // The market moves on: a second module appears.
    mkdirSync(join(repo, 'extra'), { recursive: true })
    const manifest = JSON.parse(execFileSync('cat', [join(repo, 'market.json')], { encoding: 'utf8' })) as { modules: unknown[] }
    manifest.modules.push({ id: 'extra', title: '新模块' })
    writeFileSync(join(repo, 'market.json'), JSON.stringify(manifest))
    writeFileSync(join(repo, 'extra/module.js'), 'export default { id: "extra", title: "新模块", setup: () => ({}) }')
    git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'more')
    // An agent may not swap what runs on the machine.
    await expect(call(lab, 'POST', '/api/market/update', {}, 'claude:task-1')).rejects.toMatchObject({ code: 'forbidden' })
    const pulled = await call(lab, 'POST', '/api/market/update', {}) as { changed: Array<{ added: string[] }>, restart: boolean, message: string }
    expect(pulled.changed[0]!.added).toEqual(['extra'])
    expect(pulled.restart).toBe(true)
    expect(pulled.message).toMatch(/重启 boardd/)
    // Pulling again is a no-op that says so.
    expect(await call(lab, 'POST', '/api/market/update', {})).toMatchObject({ restart: false })
  })

  it('searches across the markets by name, description and tag', async () => {
    const lab = labAt('search')
    const repo = marketRepo('searched')
    const { syncMarket } = await import('boardlab-core/core/module-markets.ts')
    const synced = await syncMarket(state, 'sh', { url: repo })
    writeFileSync(join(state, 'markets.json'), JSON.stringify({ markets: [{ id: 'sh', url: repo, branch: null, commit: synced.commit }] }))
    const hit = await call(lab, 'GET', '/api/market/search?text=探针') as { hits: Array<{ ref: string }> }
    expect(hit.hits.map(item => item.ref)).toEqual(['sh/probe'])
    expect((await call(lab, 'GET', '/api/market/search?text=zzz')).hits).toEqual([])
  })

  it('removes a market only with a person saying yes, and takes its copy with it', async () => {
    const lab = labAt('remove')
    const repo = marketRepo('removed')
    const { syncMarket } = await import('boardlab-core/core/module-markets.ts')
    const synced = await syncMarket(state, 'rm', { url: repo })
    writeFileSync(join(state, 'markets.json'), JSON.stringify({ markets: [{ id: 'rm', url: repo, branch: null, commit: synced.commit }] }))
    await expect(call(lab, 'POST', '/api/market/remove', { id: 'rm' }, 'claude:task-1')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(call(lab, 'POST', '/api/market/remove', { id: 'rm' })).rejects.toMatchObject({ code: 'invalid' })
    expect(await call(lab, 'POST', '/api/market/remove', { id: 'rm', yes: true })).toMatchObject({ removed: 'rm' })
    expect((await call(lab, 'GET', '/api/market') as MarketState).markets).toEqual([])
  })

  it('adds a market from the page: the clone, the manifest it read, and its own name checked', async () => {
    const lab = labAt('add')
    // A person pastes the URL; an agent may not, since what is added decides what this machine runs.
    const first = marketRepo('added')
    await expect(call(lab, 'POST', '/api/market/add', { id: 'pub', url: first }, 'claude:task-1')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(call(lab, 'POST', '/api/market/add', { id: 'no spaces', url: 'https://example.org/x.git' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(call(lab, 'POST', '/api/market/add', { id: 'pub', url: 'not a url' })).rejects.toMatchObject({ code: 'invalid' })
    const added = await call(lab, 'POST', '/api/market/add', { id: 'pub', url: first }) as { id: string, commit: string, modules: string[] }
    expect(added).toMatchObject({ id: 'pub', modules: ['probe'] })
    expect(added.commit).toMatch(/^[0-9a-f]{40}$/)
    // It is a market now, in the list the page and the CLI read.
    expect((await call(lab, 'GET', '/api/market') as MarketState).markets.map(market => market.id)).toEqual(['pub'])
    // And the same name twice is refused: pulling that one is what a person means.
    await expect(call(lab, 'POST', '/api/market/add', { id: 'pub', url: marketRepo('added-two') })).rejects.toMatchObject({ code: 'conflict' })
  })

  it('installs and uninstalls a market module through the configuration, and says what it needs', async () => {
    const lab = labAt('install')
    const repo = marketRepo('installed')
    await call(lab, 'POST', '/api/market/add', { id: 'pub', url: repo })
    await expect(call(lab, 'POST', '/api/market/install', { id: 'probe' }, 'claude:task-1')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(call(lab, 'POST', '/api/market/install', { id: 'nope' })).rejects.toMatchObject({ code: 'not-found' })
    const installed = await call(lab, 'POST', '/api/market/install', { id: 'probe', settings: { key: 'value' } }) as { installed: string, market: string, needs: string[] }
    expect(installed).toMatchObject({ installed: 'probe', market: 'pub', needs: [] })
    // The configuration boardd reads is the one that changed: the module, with what was given it, and nothing else.
    const config = JSON.parse(readFileSync(join(state, 'boardd.json'), 'utf8')) as { modules: Record<string, unknown> }
    expect(config.modules).toEqual({ probe: { key: 'value' } })
    expect((await call(lab, 'GET', '/api/market') as MarketState).selected).toEqual(['probe'])
    expect(await call(lab, 'POST', '/api/market/uninstall', { id: 'probe' })).toMatchObject({ removed: 'probe' })
    expect(JSON.parse(readFileSync(join(state, 'boardd.json'), 'utf8')).modules).toEqual({})
    await expect(call(lab, 'POST', '/api/market/uninstall', { id: 'probe' })).rejects.toMatchObject({ code: 'not-found' })
  })

  it('keeps what the configuration had besides modules, and refuses a file that is not one', async () => {
    const lab = labAt('keep')
    const repo = marketRepo('kept')
    await call(lab, 'POST', '/api/market/add', { id: 'pub', url: repo })
    // Hand-written settings live in the same file (timings, a module added by hand): an install keeps every one.
    writeFileSync(join(state, 'boardd.json'), JSON.stringify({ modules: { hand: { a: 1 } }, timing: { syncMs: 30000 }, note: 'mine' }))
    await call(lab, 'POST', '/api/market/install', { id: 'probe' })
    const after = JSON.parse(readFileSync(join(state, 'boardd.json'), 'utf8')) as Record<string, unknown>
    expect(after).toMatchObject({ timing: { syncMs: 30000 }, note: 'mine', modules: { hand: { a: 1 }, probe: {} } })
    // A file boardd could not read is not overwritten: the change is refused with what is wrong with it.
    writeFileSync(join(state, 'boardd.json'), 'not json')
    await expect(call(lab, 'POST', '/api/market/install', { id: 'probe' })).rejects.toMatchObject({ code: 'invalid' })
    expect(readFileSync(join(state, 'boardd.json'), 'utf8')).toBe('not json')
  })

  it('reloads only where boardd has a supervisor, and only for a person', async () => {
    const lab = labAt('reload')
    // No supervisor in a test: the page says so rather than pretending the install took effect.
    await expect(call(lab, 'POST', '/api/market/reload', {})).rejects.toMatchObject({ code: 'invalid' })
    await expect(call(lab, 'POST', '/api/market/reload', {}, 'claude:task-1')).rejects.toMatchObject({ code: 'forbidden' })
    const asked: string[] = []
    lab.reloader = why => { asked.push(why) }
    expect(await call(lab, 'POST', '/api/market/reload', {})).toMatchObject({ reloading: true })
    expect(asked).toHaveLength(1)
    // The state says whether the page can offer the button at all.
    expect((await call(lab, 'GET', '/api/market') as MarketState).canReload).toBe(true)
  })
})
