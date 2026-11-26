/**
 * Console watchers for long runs (aging tests, a soak, "tell me when it prints this"): one or more patterns watched
 * across one or more boards' serial consoles, all together, raising an alert on the bus for every match.
 *
 * A **watcher** binds patterns to boards: `boards` is a list of board names, or `*` for every board this boardd has
 * (including ones added while it runs), so ten boards are watched by one watcher. A **pattern** is a regular expression
 * (`re:panic.*`, or bare text matched as a regular expression) or `str:` for literal text, `a|b` for either, `i` for
 * case-insensitive. An `expect` watcher is the reverse: the line a healthy run prints, so the absence of it is the
 * alarm (`silentMs` after the run started, or after the last line at all) — that is what a soak needs when it hangs.
 *
 * Every match and every silence raises an alert (`topic: 'aging'`, tagged with the watcher's id and the board), and the
 * alerts module's channel rules decide where it goes: a Feishu group when nobody is at the desk, the browser when they
 * are. The watcher does not deliver anything itself.
 *
 * People and agents use it the same way: `boardlab watch console add`, `... start`, `... list`; or the page's part of
 * it. Nothing here types into a console or takes a lock: watching is read-only, so a soak can run under its own lease
 * while a watcher looks on.
 */
import type { Caller, Module, Row } from 'boardlab'
import { BoardError, isHuman } from 'boardlab'

/** One line a watcher looks for. */
export interface Pattern {
  /** `re:<regular expression>`, `str:<literal>`, or bare text taken as a regular expression. */
  match: string
  /** The compiled form, made once when the watcher is added. */
  regex: RegExp
  /** What this line means, in the alert's title (`console: panic`, say). */
  label: string
}

export type BoardSelector = string[] | '*'

export interface Watcher {
  id: string
  title: string
  /** Boards to watch: names, or `*` for every board this boardd has. */
  boards: BoardSelector
  patterns: Pattern[]
  /**
   * `line`: alert on every line that matches. `absent`: the line a healthy run prints; its silence (after `silentMs`
   * from start, or from the last line seen) is the alert, and a match says the run is alive.
   */
  mode: 'line' | 'absent'
  /** For `absent`: how long a silence means the run has hung. */
  silentMs: number
  /** For `absent`: how long a run may be quiet before it has hung (ms). */
  running: boolean
  startedAt: string | null
  /** Per board: the last time an alert was raised, so one noisy line does not post every second. */
  lastFired: Record<string, number>
  /** Per board: the last time a line was seen, for `absent`. */
  lastLine: Record<string, number>
  /** How many times this watcher fired, and on which boards. */
  fired: Array<{ at: string, board: string, line: string, pattern: string }>
}

const TABLE = `CREATE TABLE IF NOT EXISTS console_watchers (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, boards TEXT NOT NULL, patterns TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'line', silent_ms INTEGER NOT NULL DEFAULT 600000,
  running INTEGER NOT NULL DEFAULT 0, started_at TEXT, state TEXT NOT NULL DEFAULT '{}')`

/** A pattern as written -> the one it is matched by. A bad regular expression is refused here, not once per line. */
export function compilePattern(value: unknown): Pattern {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw new BoardError('invalid', '一个匹配要写成 re:<正则>、str:<原文>，或直接写正则')
  const flags = /(?:^|\s)i$/.test(text) ? 'i' : ''
  const body = flags ? text.slice(0, -1).trim() : text
  const literal = body.startsWith('str:')
  const source = body.startsWith('re:') ? body.slice(3) : literal ? body.slice(4) : body
  if (!source) throw new BoardError('invalid', `匹配 ${text} 里没有内容`)
  let regex: RegExp
  try { regex = new RegExp(literal ? source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : source, flags) }
  catch (error) { throw new BoardError('invalid', `匹配 ${text} 不是合法的正则：${(error as Error).message}`) }
  return { match: text, regex, label: literal ? source : source }
}

const compileAll = (value: unknown): Pattern[] => {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  if (!list.length) throw new BoardError('invalid', '一个监控至少要一条匹配（re:…、str:…）')
  return list.map(compilePattern)
}

/** The quiet-line alert interval, at most once a minute per board: a hung run keeps being hung, and nobody wants a
 * message every tick. A matching line alerts at most every five seconds per board, which is a noisy console's pace. */
const FIRE_MS = 5_000
const SILENT_MS = 60_000

export function consoleWatch(options: { tickMs?: number } = {}): Module<{ watchers(): Watcher[] }> {
  const tickMs = options.tickMs ?? 1500
  return {
    id: 'console-watch',
    title: '串口监控',
    about: '在不同板子的串口上同时盯住匹配（老化/长跑）：命中或缺行就发到通知总线（boardlab watch console）',
    tags: ['console', 'aging', 'own'],
    inject: ['alerts'],
    setup(lab, ctx) {
      const k = lab.kernel
      k.schema(TABLE)
      const alerts = lab.service<{ raise(alert: { topic: 'aging', title: string, body?: string, board?: string | null, tags?: string[], actor?: string }): Promise<unknown> }>('alerts')
      const sessions = new Map<string, () => void>()   // `${watcher}\0${board}` -> leave the console
      const tails = new Map<string, string>()       // `${watcher}\0${board}` -> the unterminated last piece

      const rowOf = (row: Row): Watcher => {
        const state = JSON.parse(String(row.state ?? '{}')) as Partial<Watcher>
        const patterns = (JSON.parse(String(row.patterns)) as string[]).map(compilePattern)
        return {
          id: String(row.id), title: String(row.title), boards: JSON.parse(String(row.boards)) as BoardSelector,
          patterns, mode: String(row.mode) === 'absent' ? 'absent' : 'line', silentMs: Number(row.silent_ms),
          running: Number(row.running) === 1, startedAt: row.started_at ? String(row.started_at) : null,
          lastFired: state.lastFired ?? {}, lastLine: state.lastLine ?? {}, fired: state.fired ?? [],
        }
      }
      const list = (): Watcher[] => (k.db.prepare('SELECT * FROM console_watchers ORDER BY title, id').all() as Row[]).map(rowOf)
      const save = (watcher: Watcher) => {
        k.db.prepare('INSERT INTO console_watchers(id, title, boards, patterns, mode, silent_ms, running, started_at, state) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, boards=excluded.boards, patterns=excluded.patterns, mode=excluded.mode, silent_ms=excluded.silent_ms, running=excluded.running, started_at=excluded.started_at, state=excluded.state')
          .run(watcher.id, watcher.title, JSON.stringify(watcher.boards), JSON.stringify(watcher.patterns.map(pattern => pattern.match)), watcher.mode, watcher.silentMs, watcher.running ? 1 : 0, watcher.startedAt, JSON.stringify({ lastFired: watcher.lastFired, lastLine: watcher.lastLine, fired: watcher.fired.slice(-100) }))
      }
      const find = (id: string): Watcher => {
        const watcher = list().find(item => item.id === id)
        if (!watcher) throw new BoardError('not-found', `没有监控 ${id}：boardlab watch console list 看看有哪些`)
        return watcher
      }

      /** The boards a watcher looks at now: its names that exist, or every board for `*`. */
      const boardsOf = (watcher: Watcher): string[] => {
        const present = lab.boards.list().map(board => board.name)
        return watcher.boards === '*' ? present : watcher.boards.filter(name => present.includes(name))
      }
      const fire = async (watcher: Watcher, board: string, title: string, body: string) => {
        const now = k.now()
        const last = watcher.lastFired[board] ?? 0
        if (now - last < FIRE_MS) return
        watcher.lastFired[board] = now
        watcher.fired.push({ at: new Date(now).toISOString(), board, line: title, pattern: watcher.id })
        save(watcher)
        await alerts.raise({ topic: 'aging', board, title, body, tags: [watcher.id, `watcher:${watcher.id}`], actor: 'console-watch' })
      }

      const attach = (watcher: Watcher, board: string) => {
        const key = `${watcher.id}\0${board}`
        if (sessions.has(key)) return
        let leave: (() => void) | null = null
        const opening = lab.consoles.open(board).then(session => {
          tails.set(key, '')
          session.onOutput(data => {
            const text = (tails.get(key) ?? '') + data.toString('utf8')
            const lines = text.split('\n')
            tails.set(key, lines.pop() ?? '')
            for (const raw of lines) {
              const line = raw.replace(/\r$/, '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
              if (!line) continue
              watcher.lastLine[board] = k.now()
              // `absent`: a match is the run saying it is alive, not news; only its silence is.
              if (watcher.mode === 'absent') continue
              const hit = watcher.patterns.find(pattern => pattern.regex.test(line))
              if (!hit) continue
              const say = `${watcher.title}：${hit.label}`
              void fire(watcher, board, `${board}：${say}`, line.slice(0, 500)).catch(() => {})
            }
          })
          session.onClose(() => { sessions.delete(key); tails.delete(key) })
          leave = () => { try { session.close() } catch { /* gone */ } ; sessions.delete(key); tails.delete(key) }
          sessions.set(key, leave)
        }).catch(() => { tails.delete(key) })
        void opening
      }
      const detach = (watcherId: string, board?: string) => {
        for (const [key, leave] of [...sessions]) {
          const [id, name] = key.split('\0')
          if (id !== watcherId || (board && name !== board)) continue
          leave(); sessions.delete(key); tails.delete(key)
        }
      }

      // Keep the attached sessions in step with what the watchers say and which boards exist, and watch for a hung run.
      let ticking = false
      const tick = () => {
        if (ticking) return
        ticking = true
        try {
          for (const watcher of list()) {
            if (!watcher.running) { detach(watcher.id); continue }
            const wanted = new Set(boardsOf(watcher))
            for (const [key] of [...sessions]) { const [id, board] = key.split('\0'); if (id === watcher.id && !wanted.has(board!)) { sessions.get(key)?.(); sessions.delete(key) } }
            for (const board of wanted) attach(watcher, board)
            if (watcher.mode === 'absent') {
              const now = k.now()
              for (const board of wanted) {
                const since = Math.max(watcher.lastLine[board] ?? 0, watcher.startedAt ? Date.parse(watcher.startedAt) : 0)
                if (since && now - since > watcher.silentMs && now - (watcher.lastFired[board] ?? 0) >= SILENT_MS) {
                  void fire(watcher, board, `${board}：${watcher.title}——${Math.round((now - since) / 1000)} 秒没有看到期待的那行`, `最后一次看到任何一行是 ${new Date(since).toISOString()}；期待：${watcher.patterns.map(pattern => pattern.match).join('、')}`).catch(() => {})
                  watcher.lastFired[board] = now
                }
              }
            }
          }
        } catch { /* the database is not readable this tick; the next one tries again */ }
        finally { ticking = false }
      }
      const timer = setInterval(tick, tickMs)
      timer.unref?.()
      lab.addService(() => () => { clearInterval(timer); for (const leave of sessions.values()) leave() })

      lab.addState(() => ({ consoleWatch: list().map(watcher => ({ id: watcher.id, title: watcher.title, running: watcher.running, boards: watcher.boards, mode: watcher.mode, fired: watcher.fired.length })) }) as unknown as Record<string, unknown>)

      lab.api.add('console-watch', [
        {
          method: 'GET', path: '/api/console-watch',
          about: '有哪些串口监控：盯哪些板子、匹配什么、在不在跑、触发过几次',
          handle: () => ({ watchers: list().map(watcher => ({ ...watcher, patterns: watcher.patterns.map(pattern => pattern.match) })) }),
        },
        {
          method: 'POST', path: '/api/console-watch',
          about: '加一个串口监控（body: {id, title, boards: ["板名"]|"*"、"patterns": ["re:panic", "str:login:"], mode: line|absent, silentMs}）',
          handle: ({ body, caller }) => {
            const raw = (body ?? {}) as Record<string, unknown>
            const id = typeof raw.id === 'string' ? raw.id.trim() : ''
            if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) throw new BoardError('invalid', '监控 id 只能用字母、数字、点、下划线和短横线')
            if (list().some(watcher => watcher.id === id)) throw new BoardError('conflict', `已经有监控 ${id}`)
            const boards: BoardSelector = raw.boards === '*' ? '*' : (Array.isArray(raw.boards) ? raw.boards.map(String) : typeof raw.boards === 'string' ? raw.boards.split(',').map(word => word.trim()).filter(Boolean) : [])
            if (boards !== '*' && !boards.length) throw new BoardError('invalid', '要盯哪些板子：板名数组，或 "*"（所有板子）')
            const watcher: Watcher = {
              id, title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : id, boards, patterns: compileAll(raw.patterns),
              mode: raw.mode === 'absent' ? 'absent' : 'line', silentMs: typeof raw.silentMs === 'number' && raw.silentMs > 0 ? raw.silentMs : 600_000,
              running: false, startedAt: null, lastFired: {}, lastLine: {}, fired: [],
            }
            save(watcher)
            k.record((caller as Caller).holder, null, 'console-watch', id, true, null)
            return { watcher: { ...watcher, patterns: watcher.patterns.map(pattern => pattern.match) } }
          },
        },
        {
          method: 'POST', path: '/api/console-watch/:id/start',
          about: '让一个监控开始盯（body: 可以带 {boards, patterns} 改目标）；盯上现在的所有板子',
          handle: ({ params, body, caller }) => {
            const watcher = find(params.id!)
            const raw = (body ?? {}) as Record<string, unknown>
            if (raw.boards !== undefined) watcher.boards = raw.boards === '*' ? '*' : (Array.isArray(raw.boards) ? raw.boards.map(String) : String(raw.boards).split(',').map(word => word.trim()).filter(Boolean))
            if (raw.patterns !== undefined) watcher.patterns = compileAll(raw.patterns)
            watcher.running = true
            watcher.startedAt = new Date(k.now()).toISOString()
            watcher.lastLine = {}; watcher.lastFired = {}
            save(watcher)
            k.record((caller as Caller).holder, null, 'console-watch', `${watcher.id} start`, true, null)
            tick()
            return { watcher: { ...watcher, patterns: watcher.patterns.map(pattern => pattern.match) }, watching: boardsOf(watcher) }
          },
        },
        {
          method: 'POST', path: '/api/console-watch/:id/stop',
          about: '让一个监控停下（已经盯着的串口都放开）',
          handle: ({ params, caller }) => {
            const watcher = find(params.id!)
            watcher.running = false
            save(watcher)
            detach(watcher.id)
            k.record((caller as Caller).holder, null, 'console-watch', `${watcher.id} stop`, true, null)
            return { stopped: watcher.id }
          },
        },
        {
          method: 'POST', path: '/api/console-watch/:id/remove',
          about: '删掉一个监控（body: {yes: true} 确认）；正在跑就先停下',
          handle: ({ params, body, caller }) => {
            if (!isHuman(caller.holder)) throw new BoardError('forbidden', '删监控要人来做')
            const watcher = find(params.id!)
            if ((body as { yes?: unknown } | null)?.yes !== true) throw new BoardError('invalid', `删掉监控 ${watcher.id}？确认请带 yes`)
            detach(watcher.id)
            k.db.prepare('DELETE FROM console_watchers WHERE id=?').run(watcher.id)
            return { removed: watcher.id }
          },
        },
        {
          method: 'POST', path: '/api/console-watch/raise',
          about: '从另一个程序报一条老化告警（body: {watcher, board, title, body}）：通知总线按渠道规则推出去',
          handle: async ({ body, caller }) => {
            const raw = (body ?? {}) as Record<string, unknown>
            await alerts.raise({ topic: 'aging', board: raw.board ? String(raw.board) : null, title: String(raw.title ?? '老化告警'), body: String(raw.body ?? ''), tags: raw.watcher ? [String(raw.watcher)] : [], actor: (caller as Caller).holder })
            return { ok: true }
          },
        },
      ])
      return { watchers: list }
    },
  }
}
