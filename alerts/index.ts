/**
 * Notification bus: everything boardlab wants a person to know, whether they are looking at the page or not.
 *
 * An **alert** is one thing to tell someone: a board failed to reset, a long console run printed the line it was
 * waiting for, a board waits for a person. Alerts are recorded whether or not any channel is set up — the page reads
 * them, and `boardlab alerts` shows them — and the router sends each one to the **channels** whose rules match it.
 *
 * A **channel** is one place a person receives messages: a browser (the page's own notification — nothing to set up), a
 * Feishu webhook (a chat group), and, in time, whatever else a site adds. A channel has a URL (where it posts), enabled,
 * and a list of **rules**: each rule says which alert `topics` it takes and which `tags` (a board, a host, a console
 * run) it takes. No rules means everything; one rule with `topics: ['failed']` means only failures; `tags: ['aging']`
 * means only what an aging run produced, so a long-running test can raise its hand in a chat channel on its own.
 *
 * Where the decision is made, and why: the router runs in boardd and posts to a channel's webhook itself, so a
 * notification does not depend on anyone keeping a page open. The browser's own notifications stay the page's (see
 * `src/ui/notify.ts`): the page reads the alerts through the API.
 *
 * Secrets: a channel's webhook URL is a credential (whoever has it can post to the group). It is kept in boardd's state
 * database, never in the repository, and the API gives it back masked.
 */
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { hostname } from 'node:os'
import type { Caller, Module, Row, State } from 'boardlab'
import { BoardError, isHuman } from 'boardlab'

/** What an alert is about: the list is the router's mask (every part names what a person sees). */
export const TOPICS = ['failed', 'attention', 'aging', 'free', 'granted', 'stolen'] as const
export type Topic = typeof TOPICS[number]
/** One sentence per topic, for the page and the CLI. */
export const TOPIC_TEXT: Record<Topic, string> = {
  failed: '操作失败（复位、刷机、启动、锁…）',
  attention: '板子等人操作（按 RESET 等）',
  aging: '老化/长跑监控匹配到了设定的一行',
  free: '关注的板子空闲了',
  granted: '排队轮到我、拿到锁',
  stolen: '我的锁被抢',
}

export interface Alert {
  id: number
  at: string
  topic: Topic
  board: string | null
  title: string
  body: string
  /** Free tags the router matches rules by: board names, a console-run id, an installation's own word. */
  tags: string[]
  /** Who or what raised it (`user:…`, `claude:…`, `boardd`, `console:<run>`). */
  actor: string
  /** Which channels it went to, and what each answered (a webhook's code, a failure's reason). */
  delivered: Array<{ channel: string, ok: boolean, detail: string | null }>
}

/** A rule on a channel: which alerts it takes. An empty list is "any". */
export interface Rule { topics: Topic[], tags: string[] }
/** One channel: where it posts, and which alerts go there. */
export interface Channel {
  id: string
  /** `feishu` (a webhook) or `browser` (the page: recorded only, delivered by whoever has it open). */
  kind: string
  title: string
  enabled: boolean
  /** Where it posts: the webhook URL. Never given back unmasked. */
  url: string | null
  rules: Rule[]
  /** What the last delivery answered, and when. */
  last: { at: string, ok: boolean, detail: string | null } | null
  /** A hint a channel needs to be set up (a Feishu bot's members, say): the page shows it. */
  note?: string
}

export interface AlertOptions {
  /** How many alerts the page state carries. */
  shown?: number
  /** How the module posts to a webhook; the default is over HTTP/1.1 (`postJson`). Tests pass their own to see the request. */
  post?: (url: string, payload: unknown) => Promise<{ ok: boolean, detail: string | null, status?: number }>
  /** The machine a card's footer names: a chat group collects alerts from more than one boardd. The release comes from ctx. */
  machine?: string
}

const TABLE = `CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, topic TEXT NOT NULL, board TEXT,
  title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', actor TEXT NOT NULL,
  delivered TEXT NOT NULL DEFAULT '[]')`
const CHANNELS = `CREATE TABLE IF NOT EXISTS alert_channels (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  url TEXT, rules TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL, last TEXT)`

const asTags = (value: unknown): string[] => Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string' && !!tag.trim()).map(tag => tag.trim()) : []
const asTopic = (value: unknown): Topic => {
  if (typeof value !== 'string' || !(TOPICS as readonly string[]).includes(value)) throw new BoardError('invalid', `未知的通知类型：${String(value)}（有：${TOPICS.join('、')}）`)
  return value as Topic
}
/** A rule as written by a person or a CLI: `{topics, tags}`, either side may be left out. */
const asRule = (value: unknown): Rule => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BoardError('invalid', '一条规则要是一个对象：{topics: [...], tags: [...]}')
  const raw = value as { topics?: unknown, tags?: unknown }
  const topics = raw.topics === undefined ? [] : (Array.isArray(raw.topics) ? raw.topics.map(asTopic) : [asTopic(raw.topics)])
  return { topics, tags: asTags(raw.tags) }
}
const asRules = (value: unknown): Rule[] => value === undefined ? [] : (Array.isArray(value) ? value.map(asRule) : [asRule(value)])

/** Whether `rules` takes an alert with these topics/tags. No rules: everything. A rule matches when its topics and
 * its tags both fit (an empty side fits anything), so `{topics:['failed']}` is "every failure" and
 * `{tags:['aging']}` is "whatever the aging run says". */
export function matches(rules: Rule[], topic: Topic, tags: string[]): boolean {
  if (!rules.length) return true
  return rules.some(rule => (rule.topics.length === 0 || rule.topics.includes(topic)) && (rule.tags.length === 0 || rule.tags.some(tag => tags.includes(tag))))
}

/**
 * How each topic looks in a chat: a Feishu card's header colour, and the word a person reads. Feishu's own template
 * names (`red`, `orange`, …) are the channel's vocabulary, so they live here, not in an alert.
 */
export const TONES: Record<Topic, { colour: string, label: string }> = {
  failed: { colour: 'red', label: '失败' },
  attention: { colour: 'orange', label: '等人操作' },
  aging: { colour: 'blue', label: '老化匹配' },
  free: { colour: 'green', label: '空闲' },
  granted: { colour: 'turquoise', label: '轮到了' },
  stolen: { colour: 'violet', label: '被抢' },
}

/** A value inside a card's markdown: the characters that would otherwise turn it into formatting. */
const plain = (text: string): string => text.replace(/([*_~`\[\]])/g, '\\$1')

/** How much of an alert's own words a chat card carries: one glance, not a log dump. */
export const CARD_BODY = 220

/** Only the first nonblank line belongs in the preview; the stored alert keeps the rest. */
export function cardBody(body: string): { text: string, omitted: boolean } {
  const trimmed = body.trim()
  const first = trimmed.split(/[\r\n\u2028\u2029]/, 1)[0]!.trimEnd()
  const chars = Array.from(first)
  const clipped = chars.length > CARD_BODY
  return { text: clipped ? `${chars.slice(0, CARD_BODY - 1).join('').trimEnd()}…` : first, omitted: clipped || first !== trimmed }
}

/** A time as a person reads it in the chat: this boardd's own clock, minutes, no seconds. */
function when(at: string): string {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return at
  const two = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}

/**
 * The message a chat channel posts: a Feishu **interactive card**, not a line of text.
 *
 * A card is what a person can read at a glance in a group: a header in the topic's colour saying what happened, the
 * board and the time as a short field grid, the alert's own words as markdown, and a footer naming the boardd that
 * raised it. Feishu's webhook takes the card as `msg_type: 'interactive'` with the card under `card`; its older `post`
 * shape is a wall of text nobody scans.
 */
export function feishuPayload(alert: Pick<Alert, 'topic' | 'board' | 'title' | 'body' | 'at'> & { actor?: string, id?: number }, where: { version?: string, machine?: string } = {}) {
  const tone = TONES[alert.topic]
  const fields: Array<{ is_short: boolean, text: { tag: 'lark_md', content: string } }> = []
  const field = (label: string, value: string) => fields.push({ is_short: true, text: { tag: 'lark_md', content: `**${label}**\n${plain(value)}` } })
  if (alert.board) field('板子', alert.board)
  field('类型', `${tone.label} · ${alert.topic}`)
  field('时间', when(alert.at))
  if (alert.actor) field('发起', alert.actor)

  const elements: Array<Record<string, unknown>> = []
  const shown = cardBody(alert.body)
  if (shown.text) elements.push({ tag: 'div', text: { tag: 'plain_text', content: shown.text } })
  if (shown.omitted) elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: alert.id ? `查看完整通知：boardlab alerts show ${alert.id}` : '查看最近的完整通知：boardlab alerts' }] })
  if (elements.length) elements.push({ tag: 'hr' })
  elements.push({ tag: 'div', fields })
  const footer = [where.machine ? `boardd ${where.machine}` : 'boardd', where.version ? `boardlab ${where.version}` : null].filter(Boolean).join(' · ')
  elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: footer }] })

  return {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true, enable_forward: true },
      header: {
        template: tone.colour,
        title: { tag: 'plain_text', content: alert.title },
        subtitle: { tag: 'plain_text', content: `${tone.label} · ${alert.topic}` },
      },
      elements,
    },
  }
}

const mask = (url: string | null) => !url ? null : url.replace(/^(https?:\/\/[^/]+\/).*?([0-9a-f-]{8})[0-9a-f-]*$/i, '$1…$2…')

/**
 * Post a payload to a webhook over HTTP/1.1, and answer with what came back.
 *
 * `fetch` is not used: a chat service's edge does not always hand `fetch` a response header it accepts (Feishu's
 * answers through an HTTP/2 node whose hop-by-hop headers undici rejects, as `Invalid header value char`), while the
 * HTTP/1.1 client reads the same answer. What a person set up must work from boardd's machine, not only from a browser.
 */
async function postJson(url: string, payload: unknown, timeoutMs: number): Promise<{ status: number, body: string }> {
  const target = new URL(url)
  const client = target.protocol === 'http:' ? httpRequest : httpsRequest
  const body = JSON.stringify(payload)
  return new Promise((resolve, reject) => {
    const request = client({ hostname: target.hostname, port: target.port || undefined, path: `${target.pathname}${target.search}`, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
      response => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', chunk => { text += chunk })
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: text }))
      })
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`webhook 在 ${timeoutMs / 1000} 秒内没有回答`)))
    request.on('error', reject)
    request.end(body)
  })
}

const defaultPost = async (url: string, payload: unknown) => {
  const answer = await postJson(url, payload, 10_000)
  const ok = answer.status >= 200 && answer.status < 300
  let detail: string | null = null
  try { const body = JSON.parse(answer.body) as { code?: number, msg?: string, StatusCode?: number, StatusMessage?: string }; const code = body.code ?? body.StatusCode; const msg = body.msg ?? body.StatusMessage; if (code) detail = `${code}${msg ? ` ${msg}` : ''}` } catch { detail = ok ? null : `HTTP ${answer.status}` }
  return { ok: ok && !detail, status: answer.status, detail: detail ?? `HTTP ${answer.status}` }
}

/** What a channel's post answered: `ok` is the channel's own verdict (an HTTP 200 may still refuse a message). */
export function alerts(options: AlertOptions = {}): Module<{ raise(alert: { topic: Topic, title: string, body?: string, board?: string | null, tags?: string[], actor?: string }): Promise<Alert>, channels(): Channel[] }> {
  const shown = options.shown ?? 20
  const post = options.post ?? defaultPost
  const machine = options.machine
  return {
    id: 'alerts',
    title: '通知',
    about: '把要人知道的事（失败、等人、老化匹配）记下来并推到渠道：浏览器、飞书 webhook 群（boardlab alerts / alerts channel）',
    tags: ['notifications', 'own'],
    setup(lab, ctx) {
      // Every card says which boardd raised it: one group may collect alerts from several machines.
      const where = { version: ctx.release.version, machine: machine ?? hostname() }
      const k = lab.kernel
      k.schema(TABLE)
      k.schema(CHANNELS)

      const channelOf = (row: Row): Channel => ({
        id: String(row.id), kind: String(row.kind), title: String(row.title), enabled: Number(row.enabled) === 1,
        url: row.url ? String(row.url) : null, rules: JSON.parse(String(row.rules)) as Rule[],
        last: row.last ? JSON.parse(String(row.last)) as Channel['last'] : null,
      })
      const channelRows = () => k.db.prepare('SELECT * FROM alert_channels ORDER BY title, id').all() as Row[]
      const channels = (): Channel[] => channelRows().map(channelOf)
      const findChannel = (id: string): Channel => {
        const row = k.db.prepare('SELECT * FROM alert_channels WHERE id=?').get(id) as Row | undefined
        if (!row) throw new BoardError('not-found', `没有通知渠道 ${id}：boardlab alerts channel list 看看有哪些`)
        return channelOf(row)
      }
      const saveChannel = (channel: Channel) => {
        k.db.prepare('INSERT INTO alert_channels(id, kind, title, enabled, url, rules, updated_at, last) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, title=excluded.title, enabled=excluded.enabled, url=excluded.url, rules=excluded.rules, updated_at=excluded.updated_at, last=excluded.last')
          .run(channel.id, channel.kind, channel.title, channel.enabled ? 1 : 0, channel.url, JSON.stringify(channel.rules), new Date().toISOString(), channel.last ? JSON.stringify(channel.last) : null)
      }
      const addChannel = (input: { id?: unknown, kind?: unknown, title?: unknown, enabled?: unknown, url?: unknown, rules?: unknown }): Channel => {
        const id = typeof input.id === 'string' ? input.id.trim() : ''
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) throw new BoardError('invalid', '渠道 id 只能用字母、数字、点、下划线和短横线')
        const kind = typeof input.kind === 'string' ? input.kind : 'feishu'
        if (!['feishu', 'browser'].includes(kind)) throw new BoardError('invalid', `未知的渠道类型：${kind}（有：feishu、browser）`)
        let url = typeof input.url === 'string' && input.url.trim() ? input.url.trim() : null
        if (kind === 'feishu') {
          if (!url) throw new BoardError('invalid', '飞书渠道要一个 webhook 地址（群机器人给出的 https://open.feishu.cn/open-apis/bot/v2/hook/…）')
          // https, or http on this machine: a test and a local relay are the two reasons a webhook is not https.
          if (!/^(https|http):\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url) && !/^https:\/\/[\w.-]+\/[\w./-]+$/.test(url)) throw new BoardError('invalid', '飞书 webhook 要是一个 https 地址')
        }
        const channel: Channel = {
          id, kind, title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : id,
          enabled: input.enabled === undefined ? true : input.enabled === true || input.enabled === 1,
          url, rules: asRules(input.rules), last: null,
        }
        saveChannel(channel)
        return channel
      }

      const record = (row: Row): Alert => ({
        id: Number(row.id), at: String(row.at), topic: String(row.topic) as Topic, board: row.board ? String(row.board) : null,
        title: String(row.title), body: String(row.body), tags: JSON.parse(String(row.tags)) as string[],
        actor: String(row.actor), delivered: JSON.parse(String(row.delivered)) as Alert['delivered'],
      })
      const list = (limit = 50): Alert[] => (k.db.prepare('SELECT * FROM alerts ORDER BY id DESC LIMIT ?').all(limit) as Row[]).map(record)

      // Where an alert goes: each enabled channel whose rules match. The browser channel is delivered by the page
      // itself (the alert is in `/api/state`), so it is only marked here; a webhook is posted now, and its answer kept.
      const deliver = async (alert: Alert): Promise<Alert['delivered']> => {
        const out: Alert['delivered'] = []
        for (const channel of channels().filter(channel => channel.enabled && !(channel.rules.length && !matches(channel.rules, alert.topic, alert.tags)))) {
          if (channel.kind === 'browser') { out.push({ channel: channel.id, ok: true, detail: '页面自己通知' }); continue }
          if (channel.kind === 'feishu' && channel.url) {
            try {
              const answer = await post(channel.url, feishuPayload(alert, where))
              out.push({ channel: channel.id, ok: answer.ok, detail: answer.detail ?? (answer.ok ? '已发送' : '发送失败') })
              saveChannel({ ...channel, last: { at: new Date().toISOString(), ok: answer.ok, detail: out.at(-1)!.detail } })
            } catch (error) {
              out.push({ channel: channel.id, ok: false, detail: (error as Error).message })
              saveChannel({ ...channel, last: { at: new Date().toISOString(), ok: false, detail: (error as Error).message } })
            }
            continue
          }
          out.push({ channel: channel.id, ok: false, detail: '渠道没配好' })
        }
        return out
      }

      const raise = async (input: { topic: Topic, title: string, body?: string, board?: string | null, tags?: string[], actor?: string }): Promise<Alert> => {
        const topic = asTopic(input.topic)
        if (!input.title?.trim()) throw new BoardError('invalid', '一条通知要有标题')
        const tags = [...new Set([...(input.board ? [input.board] : []), ...asTags(input.tags)])]
        const at = new Date().toISOString()
        const info = k.db.prepare('INSERT INTO alerts(at, topic, board, title, body, tags, actor, delivered) VALUES(?,?,?,?,?,?,?,?)')
          .run(at, topic, input.board ?? null, input.title.trim(), input.body ?? '', JSON.stringify(tags), input.actor ?? 'boardd', '[]')
        const alert: Alert = { id: Number(info.lastInsertRowid), at, topic, board: input.board ?? null, title: input.title.trim(), body: input.body ?? '', tags, actor: input.actor ?? 'boardd', delivered: [] }
        alert.delivered = await deliver(alert)
        k.db.prepare('UPDATE alerts SET delivered=? WHERE id=?').run(JSON.stringify(alert.delivered), alert.id)
        k.emit({ type: 'alert', alert: { id: alert.id, topic: alert.topic, title: alert.title, board: alert.board } })
        return alert
      }

      // A board that starts waiting for a person, and a run that fails, are the two things the bus exists for. The
      // first the core already says on its event bus; a run that fails is read from the run store, where the end of a
      // run is written (`Kernel.doing`) — no module has to relay what the core already knows.
      k.events.on('event', event => {
        const e = event as { type?: string, board?: string, message?: string | null }
        if (e.type === 'attention' && e.board && e.message) void raise({ topic: 'attention', board: e.board, title: `${e.board}：等人操作`, body: e.message, actor: 'boardd' }).catch(() => {})
      })
      let seen = 0
      const watchRuns = () => {
        const rows = k.db.prepare(`SELECT rowid AS ord, id, kind, label, holder, status, message FROM runs WHERE ended_at IS NOT NULL AND rowid > ? ORDER BY rowid`).all(seen) as Row[]
        for (const row of rows) seen = Math.max(seen, Number(row.ord ?? 0))
        const boards = (id: string) => (k.db.prepare('SELECT board FROM run_boards WHERE run=?').all(id) as Row[]).map(r => String(r.board))
        for (const row of rows) {
          if (String(row.status) === 'running') continue
          const status = String(row.status)
          if (status !== 'failed' && status !== 'interrupted') continue
          for (const board of boards(String(row.id))) {
            const what = String(row.label ?? row.kind ?? '操作')
            void raise({ topic: 'failed', board, title: `${board}：${what}失败`, body: String(row.message ?? status), tags: [String(row.id)], actor: String(row.holder ?? 'boardd') }).catch(() => {})
          }
        }
      }
      // A finished run is seen within a few seconds: a failure is worth knowing about while a person is still near.
      const timer = setInterval(() => { try { watchRuns() } catch { /* the store is not readable yet; next tick */ } }, 5000)
      timer.unref?.()
      lab.addService(() => () => clearInterval(timer))

      lab.addState(() => ({ alerts: { recent: list(shown) } }) as unknown as Partial<State>)
      lab.api.add('alerts', [
        {
          method: 'GET', path: '/api/alerts',
          about: '最近的通知（?limit=，默认 50），以及装了哪些渠道、各自的规则和上次投递的结果',
          handle: ({ query }) => ({ alerts: list(Math.max(1, Math.min(Number(query.get('limit') ?? 50) || 50, 500))), channels: channels().map(channel => ({ ...channel, url: mask(channel.url) })) }),
        },
        {
          method: 'GET', path: '/api/alerts/records/:id',
          about: '按编号查看完整通知',
          handle: ({ params }) => {
            const row = k.db.prepare('SELECT * FROM alerts WHERE id=?').get(params.id!) as Row | undefined
            if (!row) throw new BoardError('not-found', `没有通知 #${params.id}`)
            return { alert: record(row) }
          },
        },
        {
          method: 'POST', path: '/api/alerts',
          about: '主动通知一件事（body: {topic, title, body, board, tags}），并按渠道规则推出去',
          handle: async ({ body, caller }) => {
            const raw = (body ?? {}) as Record<string, unknown>
            const alert = await raise({ topic: asTopic(raw.topic ?? 'attention'), title: String(raw.title ?? ''), body: String(raw.body ?? ''), board: raw.board ? String(raw.board) : null, tags: asTags(raw.tags), actor: (caller as Caller).holder })
            return { alert: { ...alert, delivered: alert.delivered } }
          },
        },
        {
          method: 'POST', path: '/api/alerts/channels',
          about: '加一个渠道（body: {id, kind: feishu|browser, title, url, rules: [{topics, tags}], enabled}）；url 只写不回',
          handle: ({ body, caller }) => {
            if (!isHuman(caller.holder)) throw new BoardError('forbidden', '加通知渠道要人来做：渠道的地址能往群里发消息')
            const channel = addChannel((body ?? {}) as Record<string, unknown>)
            return { channel: { ...channel, url: mask(channel.url) } }
          },
        },
        {
          method: 'POST', path: '/api/alerts/channels/:id',
          about: '改一个渠道（body: {title, enabled, url, rules}，只给要改的），或 {test: true} 发一条测试消息',
          handle: async ({ params, body, caller }) => {
            if (!isHuman(caller.holder)) throw new BoardError('forbidden', '改通知渠道要人来做')
            const channel = findChannel(params.id!)
            if ((body as { test?: unknown } | null)?.test === true) {
              if (!channel.url) throw new BoardError('invalid', `${channel.id} 没有地址，发不了测试`)
              const answer = await post(channel.url, feishuPayload({ topic: 'attention', board: null, title: '渠道测试', body: '这条来自 boardlab：收到就说明这个渠道配好了', at: new Date().toISOString() }, where))
              saveChannel({ ...channel, last: { at: new Date().toISOString(), ok: answer.ok, detail: answer.detail ?? `HTTP ${answer.status}` } })
              if (!answer.ok) throw new BoardError('invalid', `飞书拒绝了这条消息：${answer.detail ?? `HTTP ${answer.status}`}（检查 webhook 是否还有效、机器人是否还在群里）`)
              return { ok: true }
            }
            const raw = (body ?? {}) as Record<string, unknown>
            const next: Channel = {
              ...channel,
              title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : channel.title,
              enabled: raw.enabled === undefined ? channel.enabled : raw.enabled === true || raw.enabled === 1,
              url: raw.url === undefined ? channel.url : (typeof raw.url === 'string' && raw.url.trim() ? raw.url.trim() : null),
              rules: raw.rules === undefined ? channel.rules : asRules(raw.rules),
            }
            saveChannel(next)
            return { channel: { ...next, url: mask(next.url) } }
          },
        },
        {
          method: 'POST', path: '/api/alerts/channels/:id/remove',
          about: '删掉一个渠道（body: {yes: true} 确认）',
          handle: ({ params, body, caller }) => {
            if (!isHuman(caller.holder)) throw new BoardError('forbidden', '删通知渠道要人来做')
            const channel = findChannel(params.id!)
            if ((body as { yes?: unknown } | null)?.yes !== true) throw new BoardError('invalid', `删掉渠道 ${channel.id}（${channel.title}）？确认请带 yes`)
            k.db.prepare('DELETE FROM alert_channels WHERE id=?').run(channel.id)
            return { removed: channel.id }
          },
        },
      ])
      return { raise, channels }
    },
  }
}
