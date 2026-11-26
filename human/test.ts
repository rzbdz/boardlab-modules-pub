/**
 * The human module, run the way boardd runs it: an agent asks a person at the bench to plug, connect or press
 * something and waits; the page shows the open requests, and a person marks one done or says it could not be done.
 * Requests live in boardd's database, so they survive restarts.
 *
 * It is a test of this module alone (the core's `db` and `lab`, no boardd around it), kept beside the module so the
 * module ships with the test that says what it does. Run it from the market's root: `pnpm test`.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase } from 'boardlab-core/core/db.ts'
import { BoardLab } from 'boardlab-core/core/lab.ts'
import { human, type HumanRequest } from './index.ts'

/** A state directory of its own for each test: the archive is a table in that database. */
const dir = mkdtempSync(join(tmpdir(), 'boardlab-human-'))

/** An endpoint called in the process, as the HTTP gateway would (the query in the path). */
async function call(lab: BoardLab, method: 'GET' | 'POST', path: string, body: Record<string, unknown> = {}, holder = 'claude:task-1'): Promise<unknown> {
  const url = new URL(path, 'http://boardd')
  const found = lab.api.match(method, url.pathname)
  if (!found) throw new Error(`no ${method} ${url.pathname}`)
  return found.endpoint.handle({ query: url.searchParams, params: found.params, body, caller: { holder, local: true } } as never)
}

const inbox = (lab: BoardLab, you = 'user:dana') => (lab.state(you) as unknown as { human: { open: number, items: HumanRequest[] } }).human

describe('the human inbox', () => {
  it('files a request, falls back to its first line as the title, and shows it to everyone as open', async () => {
    const lab = new BoardLab({ db: openDatabase(join(dir, 'human.sqlite')), now: () => Date.parse('2026-11-13T10:00:00Z'), modules: [human] })
    const filed = await call(lab, 'POST', '/api/human/ask', {
      body: 'Plug the K3 board\'s USB cable into port 2-1.1.\nThe console should print "ROM: usb download handler" when it is in.',
      kind: 'plug', context: { port: '2-1.1' },
    }) as HumanRequest
    expect(filed).toMatchObject({
      id: 1, actor: 'claude:task-1', kind: 'plug', status: 'open',
      title: 'Plug the K3 board\'s USB cable into port 2-1.1.', at: '2026-11-13T10:00:00.000Z',
      context: { port: '2-1.1' }, resolution: null, resolvedAt: null, resolvedBy: null,
    })
    expect(inbox(lab)).toMatchObject({ open: 1, items: [{ id: 1, title: 'Plug the K3 board\'s USB cable into port 2-1.1.' }] })
    expect(await call(lab, 'GET', '/api/human/requests')).toMatchObject({ open: 1, items: [{ id: 1 }] })
    expect((await call(lab, 'GET', '/api/human/requests?status=all') as { items: unknown[] }).items).toHaveLength(1)
  })

  it('takes a title of its own and refuses what it cannot understand', async () => {
    const lab = new BoardLab({ db: openDatabase(join(dir, 'human2.sqlite')), modules: [human] })
    const filed = await call(lab, 'POST', '/api/human/ask', { title: '  Connect   the UART  ', body: 'to the test point next to the button', kind: 'connect' }) as HumanRequest
    expect(filed).toMatchObject({ title: 'Connect the UART', kind: 'connect' })
    await expect(call(lab, 'POST', '/api/human/ask', { body: '   ' })).rejects.toThrow(/缺少 title/)
    await expect(call(lab, 'GET', '/api/human/requests?status=wish')).rejects.toThrow(/status 要是/)
    await expect(call(lab, 'GET', '/api/human/request?id=99')).rejects.toThrow(/没有这条人工请求：#99/)
  })

  it('asks once per key while it is open, and again once it was answered', async () => {
    const lab = new BoardLab({ db: openDatabase(join(dir, 'human3.sqlite')), modules: [human] })
    const first = await call(lab, 'POST', '/api/human/ask', { title: 'Press RESET once', key: 'reset-1' }) as HumanRequest
    const again = await call(lab, 'POST', '/api/human/ask', { title: 'Press RESET once', key: 'reset-1' }) as HumanRequest
    expect(again.id).toBe(first.id)
    await call(lab, 'POST', '/api/human/resolve', { id: first.id, status: 'done', note: '按了' })
    const later = await call(lab, 'POST', '/api/human/ask', { title: 'Press RESET once', key: 'reset-1' }) as HumanRequest
    expect(later.id).not.toBe(first.id)
    // A person's answer is kept with who gave it, and the archive still shows the earlier one.
    const all = await call(lab, 'GET', '/api/human/requests?status=all') as { items: HumanRequest[] }
    expect(all.items.find(item => item.id === first.id)).toMatchObject({ status: 'done', resolution: '按了', resolvedBy: 'claude:task-1' })
  })
})
