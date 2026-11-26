/**
 * Console watchers: one watcher over several boards' consoles, a matching line (or, in `absent` mode, the silence of
 * the line a healthy run prints) raising an alert on the bus. The consoles are fake sessions the test drives; the bus is
 * given a poster, so the Feishu request a watch would send is what is checked.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from 'boardlab-core/core/db.ts'
import { BoardLab } from 'boardlab-core/core/lab.ts'
import type { ConsoleSession } from 'boardlab-core/core/console.ts'
import { alerts } from '../alerts/index.ts'
import { consoleWatch, compilePattern } from './index.ts'

const dirs: string[] = []
/** A directory this test owns, removed after it. */
function dir(): string {
  const made = mkdtempSync(join(tmpdir(), 'boardlab-watch-'))
  dirs.push(made)
  return made
}
process.on('exit', () => { for (const made of dirs) rmSync(made, { recursive: true, force: true }) })

async function call(lab: BoardLab, method: 'GET' | 'POST', path: string, body: Record<string, unknown> = {}, holder = 'user:dana'): Promise<any> {
  const url = new URL(path, 'http://boardd')
  const found = lab.api.match(method, url.pathname)
  if (!found) throw new Error(`no ${method} ${url.pathname}`)
  return found.endpoint.handle({ query: url.searchParams, params: found.params, body, caller: { holder, local: true } } as never)
}

describe('console watchers', () => {
  /** A lab with a console whose session the test drives, and the bus it raises on. */
  function bench(name: string) {
    const sent: any[] = []
    const lab = new BoardLab({ db: openDatabase(join(dir(), `${name}.sqlite`)), now: () => Date.parse('2026-11-26T10:00:00Z') })
    const watchers: Array<(data: Buffer) => void> = []
    const session = {
      hello: {}, history: [], send: () => {}, onOutput: (fn: (data: Buffer) => void) => { watchers.push(fn); return () => {} }, onClose: () => {}, close: () => {},
    } as unknown as ConsoleSession
    // Drive the console from the test, and pretend the lab has one board.
    ;(lab.consoles as unknown as { open: (board: string) => Promise<ConsoleSession> }).open = async () => session
    ;(lab.boards as unknown as { list: () => Array<{ name: string }> }).list = () => [{ name: 'board-1' }, { name: 'board-2' }]
    const bus = alerts({ post: async (_url, payload) => { sent.push(payload); return { ok: true, detail: 'HTTP 200' } } })
    const watch = consoleWatch({ tickMs: 5 })
    lab.use(bus)
    lab.use(watch)
    const say = (line: string) => watchers.forEach(fn => fn(Buffer.from(`${line}\n`)))
    return { lab, sent, say }
  }

  it('turns a matching line on any watched board into an alert, once per board', async () => {
    const { lab, sent, say } = bench('watch-line')
    await call(lab, 'POST', '/api/alerts/channels', { id: 'lab', kind: 'feishu', url: 'https://open.feishu.cn/open-apis/bot/v2/hook/w' })
    await call(lab, 'POST', '/api/console-watch', { id: 'aging-1', title: '老化', boards: '*', patterns: ['re:panic', 'str:login:'], mode: 'line' })
    const started = await call(lab, 'POST', '/api/console-watch/aging-1/start')
    expect(started.watching).toEqual(['board-1', 'board-2'])
    await new Promise(resolve => setTimeout(resolve, 30))
    say('all good, booting')
    say('Kernel panic - not syncing: VFS')
    await new Promise(resolve => setTimeout(resolve, 30))
    const { alerts: recorded } = await call(lab, 'GET', '/api/alerts')
    expect(recorded).toHaveLength(2)           // one attachment per board; the line came to both
    expect(recorded.every((alert: { topic: string }) => alert.topic === 'aging')).toBe(true)
    expect(recorded[0].tags).toContain('aging-1')
    expect(sent.length).toBe(2)
  })

  it('alerts on silence in absent mode: the line a healthy run prints stopped coming', async () => {
    let clock = Date.parse('2026-11-26T10:00:00Z')
    const sent: any[] = []
    const lab = new BoardLab({ db: openDatabase(join(dir(), 'watch-absent.sqlite')), now: () => clock })
    const watchers: Array<(data: Buffer) => void> = []
    const session = { hello: {}, history: [], send: () => {}, onOutput: (fn: (data: Buffer) => void) => { watchers.push(fn); return () => {} }, onClose: () => {}, close: () => {} } as unknown as ConsoleSession
    ;(lab.consoles as unknown as { open: () => Promise<ConsoleSession> }).open = async () => session
    ;(lab.boards as unknown as { list: () => Array<{ name: string }> }).list = () => [{ name: 'board-1' }]
    lab.use(alerts({ post: async (_url, payload) => { sent.push(payload); return { ok: true, detail: 'HTTP 200' } } }))
    lab.use(consoleWatch({ tickMs: 5 }))
    await call(lab, 'POST', '/api/probe/../console-watch', {}).catch(() => {})
    await call(lab, 'POST', '/api/console-watch', { id: 'soak', boards: ['board-1'], patterns: ['str:heartbeat'], mode: 'absent', silentMs: 60_000 })
    await call(lab, 'POST', '/api/console-watch/soak/start')
    // The run says it is alive every 30 s: the silence never reaches the limit.
    for (let step = 0; step < 2; step++) {
      await new Promise(resolve => setTimeout(resolve, 30))
      clock += 30_000
      watchers.forEach(fn => fn(Buffer.from('heartbeat ok\n')))
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    expect((await call(lab, 'GET', '/api/alerts')).alerts).toHaveLength(0)
    clock += 61_000
    await new Promise(resolve => setTimeout(resolve, 40))
    const { alerts: recorded } = await call(lab, 'GET', '/api/alerts')
    expect(recorded.length).toBeGreaterThan(0)
    expect(recorded[0].title).toContain('没有看到')
  })

  it('refuses a bad pattern when the watcher is added, not once per line', () => {
    expect(() => compilePattern('re:(')).toThrow(/不是合法的正则/)
    expect(compilePattern('str:a.b').regex.test('a.b')).toBe(true)
    expect(compilePattern('str:a.b').regex.test('axb')).toBe(false)
    expect(compilePattern('panic i').regex.flags).toBe('i')
  })
})
