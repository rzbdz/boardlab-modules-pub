/**
 * The notification bus: an alert is recorded and routed to the channels whose rules take it, and a Feishu channel is a
 * webhook posted to boardd itself. The webhook is never called: a test passes `post`, so the request it would send is
 * what is checked.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { openDatabase } from 'boardlab-core/core/db.ts'
import { BoardLab } from 'boardlab-core/core/lab.ts'
import { alerts, cardBody, CARD_BODY, feishuPayload, matches } from './index.ts'

const dirs: string[] = []
/** A directory this test owns, removed after it. */
function dir(): string {
  const made = mkdtempSync(join(tmpdir(), 'boardlab-alerts-'))
  dirs.push(made)
  return made
}
process.on('exit', () => { for (const made of dirs) rmSync(made, { recursive: true, force: true }) })

/** The webhook posts a test makes: (url, payload), answered with `answer`. */
function poster(answer: { ok: boolean, detail: string | null } = { ok: true, detail: 'HTTP 200' }) {
  const sent: Array<{ url: string, payload: any }> = []
  return { sent, post: async (url: string, payload: unknown) => { sent.push({ url, payload }); return answer } }
}

async function call(lab: BoardLab, method: 'GET' | 'POST', path: string, body: Record<string, unknown> = {}, holder = 'user:dana'): Promise<any> {
  const url = new URL(path, 'http://boardd')
  const found = lab.api.match(method, url.pathname)
  if (!found) throw new Error(`no ${method} ${url.pathname}`)
  return found.endpoint.handle({ query: url.searchParams, params: found.params, body, caller: { holder, local: true } } as never)
}

const labWith = (post: ((url: string, payload: unknown) => Promise<{ ok: boolean, detail: string | null }>) | undefined, name: string) =>
  new BoardLab({ db: openDatabase(join(dir(), `${name}.sqlite`)), modules: [post ? alerts({ post }) : alerts()] })

describe('the notification bus', () => {
  it('records an alert and posts it to a Feishu channel, with the webhook never read back', async () => {
    const poster1 = poster()
    const lab = labWith(poster1.post, 'alerts-feishu')
    const webhook = 'https://open.feishu.cn/open-apis/bot/v2/hook/00000000-0000-0000-0000-000000000000'
    const added = await call(lab, 'POST', '/api/alerts/channels', { id: 'lab', kind: 'feishu', title: 'BOARDLAB告警群', url: webhook })
    expect(added.channel.url).toMatch(/^https:\/\/open\.feishu\.cn\/…0000…$|…/)
    expect(JSON.stringify(await call(lab, 'GET', '/api/alerts'))).not.toContain('00000000-0000-0000-0000-000000000000')
    const { alert } = await call(lab, 'POST', '/api/alerts', { topic: 'failed', title: 'board-1：复位失败', body: 'GPIO 超时', board: 'board-1' })
    expect(alert.delivered).toEqual([{ channel: 'lab', ok: true, detail: 'HTTP 200' }])
    expect(poster1.sent).toHaveLength(1)
    expect(poster1.sent[0]!.url).toBe(webhook)
    // Feishu's interactive card: a coloured header, the alert's own words, and its fields.
    expect(poster1.sent[0]!.payload).toMatchObject({ msg_type: 'interactive', card: { header: { template: 'red', title: { tag: 'plain_text', content: 'board-1：复位失败' } } } })
    expect(JSON.stringify(poster1.sent[0]!.payload.card.elements)).toContain('GPIO 超时')
    expect(JSON.stringify(poster1.sent[0]!.payload.card.elements)).toContain('board-1')
  })

  it('sends only what a channel\'s rule takes: failures to one group, an aging run to another', async () => {
    const poster2 = poster()
    const lab = labWith(poster2.post, 'alerts-rules')
    await call(lab, 'POST', '/api/alerts/channels', { id: 'failures', kind: 'feishu', url: 'https://open.feishu.cn/open-apis/bot/v2/hook/x-failures', rules: [{ topics: ['failed'], tags: [] }] })
    await call(lab, 'POST', '/api/alerts/channels', { id: 'aging', kind: 'feishu', url: 'https://open.feishu.cn/open-apis/bot/v2/hook/x-aging', rules: [{ topics: [], tags: ['aging-1'] }] })
    await call(lab, 'POST', '/api/alerts', { topic: 'attention', title: 'board-1 等按键' })
    expect(poster2.sent).toHaveLength(0)
    const failed = await call(lab, 'POST', '/api/alerts', { topic: 'failed', title: 'board-1 复位失败' })
    expect(failed.alert.delivered.map((item: { channel: string }) => item.channel)).toEqual(['failures'])
    const aged = await call(lab, 'POST', '/api/alerts', { topic: 'aging', title: 'aging-1：panic', tags: ['aging-1'] })
    expect(aged.alert.delivered.map((item: { channel: string }) => item.channel)).toEqual(['aging'])
    expect(poster2.sent.map(item => item.url)).toEqual(['https://open.feishu.cn/open-apis/bot/v2/hook/x-failures', 'https://open.feishu.cn/open-apis/bot/v2/hook/x-aging'])
  })

  it('says a channel refused a message instead of pretending it went, and sends a test message', async () => {
    const poster3 = poster({ ok: false, detail: '19021 bot not in group' })
    const lab = labWith(poster3.post, 'alerts-refused')
    await call(lab, 'POST', '/api/alerts/channels', { id: 'lab', kind: 'feishu', url: 'https://open.feishu.cn/open-apis/bot/v2/hook/y' })
    const { alert } = await call(lab, 'POST', '/api/alerts', { topic: 'failed', title: 'x' })
    expect(alert.delivered).toEqual([{ channel: 'lab', ok: false, detail: '19021 bot not in group' }])
    // A channel asking for a test is refused with the webhook's own reason.
    await expect(call(lab, 'POST', '/api/alerts/channels/lab', { test: true })).rejects.toMatchObject({ message: expect.stringContaining('19021') })
  })

  it('keeps the browser channel in boardd and marks it, and lets only a person change channels', async () => {
    const poster4 = poster()
    const lab = labWith(poster4.post, 'alerts-browser')
    await call(lab, 'POST', '/api/alerts/channels', { id: 'page', kind: 'browser', title: '页面' })
    const { alert } = await call(lab, 'POST', '/api/alerts', { topic: 'attention', title: 'board-1 等按键' })
    expect(alert.delivered).toEqual([{ channel: 'page', ok: true, detail: '页面自己通知' }])
    expect(poster4.sent).toHaveLength(0)
    await expect(call(lab, 'POST', '/api/alerts/channels', { id: 'evil', kind: 'feishu', url: 'https://open.feishu.cn/open-apis/bot/v2/hook/z' }, 'claude:task-1')).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('posts a webhook over HTTP/1.1, and reads its answer, without fetch', async () => {
    // `fetch` refuses the response headers some chat services answer with (Feishu's edge, as `Invalid header value
    // char`); the request boardd sends is what a webhook has to accept, whatever proxy answers it.
    const server = createServer((request, response) => {
      let body = ''
      request.on('data', chunk => { body += chunk })
      request.on('end', () => {
        seen = { method: request.method ?? '', type: request.headers['content-type'] ?? '', body }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ code: 19021, msg: 'bot not in group' }))
      })
    })
    let seen: { method: string, type: string, body: string } | null = null
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const port = (server.address() as AddressInfo).port
      const lab = labWith(undefined, 'alerts-http')
      await call(lab, 'POST', '/api/alerts/channels', { id: 'lab', kind: 'feishu', url: `http://127.0.0.1:${port}/open-apis/bot/v2/hook/x` })
      const { alert } = await call(lab, 'POST', '/api/alerts', { topic: 'failed', title: 'board-1 复位失败' })
      expect(seen).toMatchObject({ method: 'POST', type: 'application/json' })
      expect(JSON.parse(seen!.body).card.header.title.content).toBe('board-1 复位失败')
      // A 200 that carries a refusal is a refused message, not a delivered one.
      expect(alert.delivered).toEqual([{ channel: 'lab', ok: false, detail: '19021 bot not in group' }])
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  })

  it('reaches the page: the state carries recent alerts, and matches() is the rule', () => {
    expect(matches([], 'failed', [])).toBe(true)
    expect(matches([{ topics: ['failed'], tags: [] }], 'attention', [])).toBe(false)
    expect(matches([{ topics: [], tags: ['aging-1'] }], 'aging', ['aging-1'])).toBe(true)
    expect(matches([{ topics: ['aging'], tags: ['aging-1'] }], 'aging', ['aging-2'])).toBe(false)
    expect(feishuPayload({ topic: 'failed', board: 'b', title: 't', body: 'x', at: 'now' }).card.header.title.content).toBe('t')
  })

  it('writes a card a person can read at a glance: colour by topic, fields, and the machine it came from', () => {
    const failed = feishuPayload({ topic: 'failed', board: 'board-1', title: 'board-1：复位失败', body: 'GPIO 超时\n再试一次没用', at: '2026-11-26T09:05:00.000Z', actor: 'user:dana' }, { version: '0.5.0', machine: 'lab-1' })
    expect(failed.card.header.template).toBe('red')
    expect(failed.card.config.wide_screen_mode).toBe(true)
    const text = JSON.stringify(failed.card.elements)
    expect(text).toContain('GPIO 超时')
    expect(text).toContain('board-1')
    expect(text).toContain('user:dana')
    expect(text).toContain('lab-1')
    expect(text).toContain('boardlab 0.5.0')
    // Every topic has its own colour, and none is the same as another's: a group reads the header before the words.
    const colours = ['failed', 'attention', 'aging', 'free', 'granted', 'stolen'].map(topic => feishuPayload({ topic: topic as never, board: null, title: 't', body: '', at: 'now' }).card.header.template)
    expect(new Set(colours).size).toBe(colours.length)
    // An alert with no body still has its fields; no empty div is left in the card.
    const bare = feishuPayload({ topic: 'aging', board: null, title: 'aging-1：panic', body: '', at: 'now' })
    expect(bare.card.elements[0]).toMatchObject({ tag: 'div', fields: expect.any(Array) })
  })

  it('cuts a body that is a console dump to one glance, and says how much was left out', () => {
    // A boot hook's failure carries the board's console tail; a card with all of it is a wall nobody reads.
    const dump = ['EDK2 DHCP got no IPv4 address (media state / GMAC init); console tail:', ...Array.from({ length: 12 }, () => ''), ...Array.from({ length: 12 }, (_, i) => i % 2 ? 'FSOpen: Open \'\\\' Success' : 'FS0:\\> ifconfig -l')].join('\n')
    const card = feishuPayload({ topic: 'failed', board: 'board-1', title: 'board-1：启动中失败', body: dump, at: '2026-11-26T09:05:00.000Z' })
    const text = JSON.stringify(card.card.elements)
    // The failure itself stays: a person reads what went wrong in the group.
    expect(text).toContain('EDK2 DHCP got no IPv4 address')
    // The card is bounded whatever the body was, the rest is counted, and the card says where the whole of it is.
    expect(cardBody(dump).text.length).toBeLessThanOrEqual(CARD_BODY + 1)
    expect(cardBody(dump).text).not.toContain('\n')
    // What was dropped is countable: the card's own lines plus `more` are all the body's lines.
    const shownLines = cardBody(dump).text.split(/(?=FSOpen: Open|FS0:\\>)/).length
    expect(cardBody(dump).more).toBe(dump.split('\n').filter(line => line.trim()).length - shownLines)
    expect(cardBody(dump).more).toBeGreaterThan(0)
    expect(text).toMatch(/还有 \d+ 行没放在卡片里/)
    expect(text).not.toContain(dump.split('\n').at(-1)!.repeat(1) + ' FSOpen: Open')
    // A long body with no line break is cut at the limit, after a sentence end where there is one.
    const run = `${'x'.repeat(40)} ${'y'.repeat(400)}`
    expect(cardBody(run).text.length).toBeLessThanOrEqual(CARD_BODY + 1)
    expect(cardBody(run).more).toBe(1)
    expect(cardBody(`${'a'.repeat(200)}。${'b'.repeat(200)}`).text.endsWith('。')).toBe(true)
    // A short body goes as it is, with nothing counted.
    expect(cardBody('GPIO 超时')).toEqual({ text: 'GPIO 超时', more: 0 })
  })
})
