/**
 * The `login-disable` module: a debug image of Bianbu, Ubuntu or Debian asks for a login on its serial console, and
 * whoever works on the board — an agent debugging a kernel, a person at the bench — has to type an account and a
 * password before it can do anything. This module does that once, by itself: it signs in with the debug image's own
 * accounts (configurable; the vendor images' convention is `root:bianbu`, then `bianbu:bianbu`), reads what system is
 * on the console from `/etc/os-release`, and makes the getty of that serial port sign in automatically. From then on
 * the console is a shell prompt.
 *
 * What it touches is narrow, and it says so: only a Debian-family system running systemd, only the getty of the port
 * the console is on, and only through one drop-in (`/etc/systemd/system/<getty>.service.d/autologin.conf`). The
 * vendor's unit file is never edited, and undoing it removes the drop-in and restarts the getty — the board asks for a
 * password again.
 *
 * Turning a password login into no login is a change to the board's security, so the run holds the board's lock (it
 * types, like any agent), is written to the action log with who ran it and when, and the page shows it on the board.
 */
import { BoardError, EventStream, required, stripAnsi, type BoardLab, type ConsoleSession, type Module } from 'boardlab'

/** One account a debug image may ship, tried in order. */
export interface Account { user: string, password: string }

/** What the console showed: the system, the port, the getty, and whether it asks for a password. */
export interface Probe {
  board: string
  at: string
  /** `/etc/os-release`'s id, its name, and its `ID_LIKE`; null when the console showed none. */
  os: { id: string, name: string, like: string[] } | null
  /** The port the console is on (`ttyS0`), and the getty unit serving it (`serial-getty@ttyS0.service`). */
  device: string | null
  unit: string | null
  /** That unit's `ExecStart=`. */
  exec: string | null
  /** Whether it signs in without a password, and as whom. */
  autologin: boolean
  account: string | null
  /** The account the console was signed in with (null: it was already at a shell). */
  loggedInAs: string | null
  /** Whether commands can reach root (signed in as root, or sudo without a password). */
  root: boolean
  systemd: boolean
}

/** What boardd remembers about a board: the last time it opened the console's login, and whether that is still on. */
export interface Entry {
  board: string
  at: string
  actor: string
  os: string
  osId: string
  device: string
  unit: string
  account: string
  /** The drop-in it wrote. */
  file: string
  state: 'on' | 'off'
  endedAt: string | null
}

export type Action = 'check' | 'apply' | 'undo'

/** What a run answers: its own word on the result, the console as it was found, and the record it left. */
export interface Result { ok: boolean, message: string, probe?: Probe, entry?: Entry }

export interface LoginDisableApi {
  /** What boardd remembers, one row per board it has touched. */
  known(): Entry[]
  /** Look at, change, or restore a board's console login. `caller` carries the board's lock token. */
  run(board: string, caller: { holder: string, token: string | null }, action: Action, say: (line: string) => void): Promise<Result>
}

/** How the module is configured. */
export interface Settings {
  /** The accounts to try, in order. */
  accounts: Account[]
  /** The account the console signs in as once it is open (root, so a debug session needs no sudo). */
  user: string
  /** The systems it will touch, by `/etc/os-release` id or `ID_LIKE` (what a derivative says). */
  allow: string[]
}

const USERS = /^[A-Za-z_][A-Za-z0-9_.-]*$/

/** The module's settings, checked, with the vendor debug images' own convention as the default. */
export function settingsOf(raw: Record<string, unknown>): Settings {
  const words = (value: unknown) => (Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(',') : []).map(word => word.trim()).filter(Boolean)
  const accounts = words(raw.accounts).flatMap(word => {
    const at = word.indexOf(':')
    if (at < 1) return []
    const user = word.slice(0, at).trim()
    return USERS.test(user) ? [{ user, password: word.slice(at + 1) }] : []
  })
  const user = typeof raw.user === 'string' && raw.user.trim() ? raw.user.trim() : 'root'
  const allow = words(raw.allow).map(word => word.toLowerCase())
  return {
    // A vendor debug image ships root with a known password and, on some, a second account: the two everyone tries.
    accounts: accounts.length ? accounts : [{ user: 'root', password: 'bianbu' }, { user: 'bianbu', password: 'bianbu' }],
    user: USERS.test(user) ? user : 'root',
    allow: allow.length ? allow : ['bianbu', 'ubuntu', 'debian'],
  }
}

/** `/etc/os-release` as a system: its id, what its vendor calls it, and the family it says it belongs to. */
export function osRelease(text: string): { id: string, name: string, like: string[] } | null {
  const field = (key: string) => {
    const found = text.match(new RegExp(`^${key}=(.*)$`, 'm'))
    return found ? found[1]!.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1') : ''
  }
  const id = field('ID').toLowerCase()
  if (!id) return null
  return { id, name: field('PRETTY_NAME') || field('NAME') || id, like: field('ID_LIKE').toLowerCase().split(/\s+/).filter(Boolean) }
}

/** Whether the system is a family this module signs in (a derivative says so in `ID_LIKE`). */
export const accepted = (os: { id: string, like: string[] }, allow: string[]): boolean =>
  allow.includes(os.id) || os.like.some(item => allow.includes(item))

/** The getty's `ExecStart=` with `--autologin <user>` after the agetty it runs, the rest of the line as the vendor wrote it. */
export function autologinExec(exec: string, user: string): string {
  if (/--autologin(?:[=\s])/.test(exec)) return exec
  const at = exec.search(/\S*agetty\s/)
  if (at < 0) throw new BoardError('invalid', `串口 getty 的启动命令不是 agetty，不知道怎么免密：${exec}`)
  const end = at + exec.slice(at).search(/\s/)
  return `${exec.slice(0, end)} --autologin ${user}${exec.slice(end)}`
}

/** A shell word in double quotes: `$`, a backtick and a backslash inside it are taken literally. */
export const dq = (text: string) => `"${text.replace(/[\\"`$]/g, char => `\\${char}`)}"`

/** The drop-in's first line: what makes this file the module's to remove. */
export const FILE_MARK = '# boardlab login-disable'

const sleep = (ms: number) => new Promise<void>(resolve => { const timer = setTimeout(resolve, ms); timer.unref?.() })
const visible = (text: string) => stripAnsi(text).replace(/\r\n/g, '\n')
/** A shell prompt (`root@board:~# `, `# `) at the end of what is visible. */
const SHELL_PROMPT = /(?:^|\n)(?:[\w.-]+@[\w.:-]+:[^\r\n]*?[#$]|[$#])\s*$/
const LOGIN_PROMPT = /(?:^|\n)[^\r\n]*(?:login|用户名)\s*[:：]\s*$/i
const PASSWORD_PROMPT = /(?:password|密码)\s*[:：]\s*$/i
/** The line a login that was refused leaves, and the prompt after it. */

/**
 * The console as one conversation: what it printed since the run began, the board's text typed into it under the lock,
 * and waiting for something to appear. A password is typed but never recorded: `consoles.input` logs that bytes went
 * out, never which.
 */
class Talk {
  private text: string
  private readonly leave: () => void
  // Fields written out, not constructor parameter properties: boardd loads a module with Node's strip-only TypeScript,
  // which erases types but refuses parameter properties, and the module then does not load at all.
  private readonly lab: BoardLab
  private readonly board: string
  private readonly caller: { holder: string, token: string | null }
  constructor(lab: BoardLab, board: string, caller: { holder: string, token: string | null }, session: ConsoleSession) {
    this.lab = lab
    this.board = board
    this.caller = caller
    this.text = (session.history ?? []).join('\n')
    this.leave = session.onOutput(data => { this.text += data.toString('utf8') })
  }
  close() { this.leave() }
  /** Where the text is now: what a wait looks at is only what comes after this. */
  get now(): number { return this.text.length }
  /** The last lines on the console, for a failure that has to say what the board was doing. */
  tail(lines = 10) { return visible(this.text).split(/\r?\n/).filter(Boolean).slice(-lines).join('\n') }
  /** What came after `from`, as a person would have read it. */
  after(from: number) { return visible(this.text.slice(from)) }

  async type(text: string) {
    for (let at = 0; at < text.length; at += 256) {
      await this.lab.consoles.input(this.board, this.caller, { data: text.slice(at, at + 256) })
      if (text.length > 256) await sleep(20)
    }
  }

  /**
   * What came after `from`, without the blank lines at its end: a prompt is the last thing on a console, and what is
   * after it is only the newline the console prints on its own.
   */
  private ends(from: number) { return this.after(from).replace(/\s+$/, '') }

  async wait(pattern: RegExp, timeoutMs: number, from: number): Promise<boolean> {
    const until = Date.now() + timeoutMs
    for (;;) {
      if (pattern.test(this.ends(from))) return true
      if (Date.now() >= until) return false
      await sleep(120)
    }
  }

  /** Wait for the first of several patterns, and say which one matched (null: none in time). */
  async waitAny(patterns: RegExp[], timeoutMs: number, from: number): Promise<number | null> {
    const until = Date.now() + timeoutMs
    for (;;) {
      const seen = this.ends(from)
      for (const [index, pattern] of patterns.entries()) if (pattern.test(seen)) return index
      if (Date.now() >= until) return null
      await sleep(120)
    }
  }

  /**
   * Run one shell line and answer what it printed: the line is bracketed by two markers, and the markers are found by
   * their last occurrence, since the console echoes the whole line it was given before the shell answers. The end
   * marker is built by the shell (`$(echo e)`) so the echo of the line does not contain it: only the answer does. Null
   * when the answer never came (the line ended the shell it ran in).
   */
  async command(command: string, timeoutMs = 20_000): Promise<string | null> {
    const token = `__bl_${Math.random().toString(36).slice(2, 10)}`
    const start = `${token}_s`, end = `${token}_e`
    const from = this.now
    await this.type(`echo ${start}; ${command}; echo ${token}_$(echo e)\r`)
    if (!(await this.wait(new RegExp(`${end}(?!\\w)`), timeoutMs, from))) return null
    const text = visible(this.text)
    const at = text.lastIndexOf(start)
    const until = text.indexOf(end, at + start.length)
    return at < 0 || until < 0 ? '' : text.slice(at + start.length, until).replace(/^[\r\n]+/, '').trimEnd()
  }
}

type Say = (line: string) => void

/** `settings` is the same raw configuration a site writes for the module (boardd hands its own through `ctx.config`). */
export function loginDisable(options: { settings?: Record<string, unknown> } = {}): Module<LoginDisableApi> {
  return {
    id: 'login-disable',
    title: '串口免密登录',
    about: '识别串口上的 Bianbu/Ubuntu/Debian，自己登录一次，把串口 getty 改成免密自动登录，可以还原；带 boardlab login-disable 命令',
    tags: ['console', 'login', 'serial'],
    setup(lab, ctx) {
      const config = settingsOf({ ...ctx.config, ...(options.settings ?? {}) })
      lab.kernel.schema(`CREATE TABLE IF NOT EXISTS login_disable (
        board TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, os TEXT NOT NULL, os_id TEXT NOT NULL,
        device TEXT NOT NULL, unit TEXT NOT NULL, account TEXT NOT NULL, file TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'on', ended_at TEXT)`)

      const known = (): Entry[] => (lab.kernel.db.prepare('SELECT * FROM login_disable ORDER BY at DESC').all() as Array<Record<string, unknown>>).map(row => ({
        board: String(row.board), at: String(row.at), actor: String(row.actor), os: String(row.os), osId: String(row.os_id),
        device: String(row.device), unit: String(row.unit), account: String(row.account), file: String(row.file),
        state: row.state === 'off' ? 'off' : 'on', endedAt: row.ended_at === null || row.ended_at === undefined ? null : String(row.ended_at),
      }))
      const remember = (entry: Entry) => lab.kernel.db.prepare(
        'INSERT INTO login_disable(board, at, actor, os, os_id, device, unit, account, file, state, ended_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(board) DO UPDATE SET at=excluded.at, actor=excluded.actor, os=excluded.os, os_id=excluded.os_id, device=excluded.device, unit=excluded.unit, account=excluded.account, file=excluded.file, state=excluded.state, ended_at=excluded.ended_at',
      ).run(entry.board, entry.at, entry.actor, entry.os, entry.osId, entry.device, entry.unit, entry.account, entry.file, entry.state, entry.endedAt)

      const probeOf = (board: string, os: Probe['os'], device: string | null = null, unit: string | null = null, systemd = false, exec: string | null = null, autologin = false, account: string | null = null, loggedInAs: string | null = null, root = false): Probe =>
        ({ board, at: new Date().toISOString(), os, device, unit, exec, autologin, account, loggedInAs, root, systemd })

      /**
       * Sign in with the configured accounts in order, and say whose shell it is. A system that asks for no password
       * after the name is the same as one that accepts it: the prompt that follows is the answer either way. A refusal
       * may come instead of a prompt (a login that fails at once), so the two are what is waited for together.
       */
      async function signIn(talk: Talk, say: Say): Promise<string | null> {
        for (const account of config.accounts) {
          say(`用 ${account.user} 登录…`)
          const from = talk.now
          await talk.type(`${account.user}\r`)
          const first = await talk.waitAny([LOGIN_PROMPT, PASSWORD_PROMPT, SHELL_PROMPT], 12_000, from)
          if (first === 2) return account.user
          if (first === null) continue
          if (first === 0) {
            // The name was refused (the login is back), or a prompt came without a password: one more moment tells.
            if (await talk.waitAny([PASSWORD_PROMPT, SHELL_PROMPT], 2_000, from) !== 1) continue
            return account.user
          }
          const asked = talk.now
          await talk.type(`${account.password}\r`)
          // A shell, or the login again (refused without a word): the prompt says which.
          if (await talk.waitAny([SHELL_PROMPT, LOGIN_PROMPT], 25_000, asked) === 0) return account.user
        }
        return null
      }

      /**
       * Restart the getty and see whether the console came back as a shell. Restarting it ends the shell that asked for
       * it, so a shell that answers afterwards is the new getty's (the drop-in worked); a login prompt is the password
       * still being asked for. `expect`: what the drop-in should have made it do, which is what is judged — the other
       * sign is the shell being replaced printing one last prompt (`shell`, while the drop-in was removed).
       */
      async function restart(talk: Talk, unit: string, shell: (command: string, timeoutMs?: number) => Promise<string | null>, asRoot: boolean, stillSameShell: boolean, expect: 'login' | 'shell', say: Say): Promise<{ ok: boolean, message: string }> {
        const before = stillSameShell ? (await shell('echo $$', 8_000))?.trim() ?? null : null
        say(`重启 ${unit}…`)
        const from = talk.now
        await talk.type(`${asRoot ? '' : 'sudo -n '}systemctl restart ${unit}\r`)
        // The echo of the command line is not evidence; a prompt or a login after it is. A getty takes a moment to
        // start, so the console is given one before anything it printed counts.
        await sleep(3_000)
        const saw = await talk.waitAny([SHELL_PROMPT, LOGIN_PROMPT], 37_000, from)
        if (saw === null) return { ok: false, message: `重启 ${unit} 后串口上 40 秒没有反应\n${talk.tail(6)}` }
        // The command was typed at a shell the restart ended, so that shell's line may have been cut off: a prompt is
        // sent again, and what the console shows after it is what it ended up at.
        const again = talk.now
        await talk.type('\r')
        const ending = await talk.waitAny([SHELL_PROMPT, LOGIN_PROMPT], 5_000, again)
        if (ending === null) return { ok: false, message: `重启 ${unit} 后串口上没有提示符，也没有登录\n${talk.tail(6)}` }
        if (ending !== (expect === 'shell' ? 0 : 1)) {
          return { ok: false, message: expect === 'shell'
            ? `重启 ${unit} 后串口在要密码：免密没有生效，这一版的串口登录可能不在这个单元里\n${talk.tail(6)}`
            : `重启 ${unit} 后串口直接进了 shell：自动登录还在\n${talk.tail(6)}` }
        }
        // A shell from before the restart (a getty that was not restarted at all) answers with its old pid.
        if (expect === 'shell') {
          const pid = (await talk.command('echo $$', 8_000))?.trim()
          if (pid === null || pid === '') return { ok: false, message: `重启 ${unit} 后串口上有提示符，但命令没有回应：那个 shell 可能还在死掉的过程中\n${talk.tail(6)}` }
          if (before && pid === before) return { ok: false, message: `${unit} 没有重启（原来的 shell 还在，pid ${before}）：串口还是原来的登录` }
        }
        return { ok: true, message: expect === 'shell' ? '免密生效了' : '登录又要密码了' }
      }

      /** Take the drop-in away and restart the getty: the console asks for a password again. */
      async function undo(talk: Talk, board: string, caller: { holder: string, token: string | null }, probe: Probe, shell: (command: string, timeoutMs?: number) => Promise<string | null>, asRoot: boolean, say: Say): Promise<Result> {
        if (!probe.autologin) return { ok: true, message: `${board}：串口本来就是密码登录，没有要还原的`, probe }
        const row = known().find(item => item.board === board && item.state === 'on')
        const unit = row?.unit ?? probe.unit
        const file = row?.file ?? (unit ? `/etc/systemd/system/${unit}.d/autologin.conf` : null)
        if (!unit || !file) return { ok: false, message: `${board}：串口是自动登录，但说不清是哪个单元、哪个文件开的，不敢动`, probe }
        const marked = (await shell(`grep -c '${FILE_MARK}' '${file}' 2>/dev/null || true`))?.trim()
        if (!row && marked !== '1') {
          // A vendor image that ships autologin itself: not this module's to undo.
          return { ok: false, message: `${board}：串口的自动登录不是 boardlab 打开的（${unit} 自带 --autologin，或者配置在别的文件里），不动它`, probe }
        }
        say(`删掉 ${file}，把 ${unit} 恢复成要密码…`)
        const removed = await shell(`rm -f '${file}' && rmdir '${file.replace(/\/[^/]+$/, '')}' 2>/dev/null; systemctl daemon-reload && echo removed`)
        if (removed === null || !removed.includes('removed')) return { ok: false, message: `${board}：删 ${file} 没成功：\n${removed ?? talk.tail()}`, probe }
        const restarted = await restart(talk, unit, shell, asRoot, asRoot, 'login', say)
        if (!restarted.ok) return { ok: false, message: `${board}：配置删掉了，但${restarted.message}`, probe }
        if (row) remember({ ...row, state: 'off', endedAt: new Date().toISOString() })
        lab.kernel.record(caller.holder, board, 'login-disable', `${probe.device} ${unit} 恢复密码登录`, true)
        say('串口又要在登录处输密码了')
        return { ok: true, message: `${board}：串口的自动登录已经去掉，${unit} 恢复密码登录`, probe: { ...probe, autologin: false, account: null } }
      }

      async function run(board: string, caller: { holder: string; token: string | null }, action: Action, say: Say, user = config.user): Promise<Result> {
        // Typing is what a lock is for: the run holds the board's, and says so rather than assuming it. `check` only
        // looks — it signs in and reads — so a site can let it run while someone else holds the board.
        if (action !== 'check') lab.locks.authorize(board, caller)
        const session = await lab.consoles.open(board)
        const talk = new Talk(lab, board, caller, session)
        try {
          // 1. A shell, signing in only if the console asks for one.
          say('看串口上的登录提示…')
          await talk.type('\r')
          const seen = talk.now
          const atShell = await talk.wait(SHELL_PROMPT, 2_500, seen)
          let loggedInAs: string | null = null
          if (!atShell) {
            if (!(await talk.wait(LOGIN_PROMPT, 20_000, seen))) {
              return { ok: false, message: `${board}：串口上没有出现登录提示，也还没有 shell。板子可能还没启动到 Linux（等它启动完再试），或者这一版在串口上不登录`, probe: probeOf(board, null) }
            }
            loggedInAs = await signIn(talk, say)
            if (loggedInAs === null) {
              return { ok: false, message: `${board}：登录没成功——试了 ${config.accounts.map(account => account.user).join('、')} 这些账号，都不对。看串口确认账号密码，或者在这个模块的设置里改 accounts`, probe: probeOf(board, null) }
            }
          }
          // 2. What runs there: the system, the port, the getty serving it, and how it is started.
          const release = await talk.command('cat /etc/os-release 2>/dev/null')
          if (release === null) return { ok: false, message: `${board}：登录后串口上没有回应（那个 shell 可能被关掉了）`, probe: probeOf(board, null) }
          const os = osRelease(release)
          if (!os) return { ok: false, message: `${board}：读不出 /etc/os-release，不知道串口上是什么系统：\n${release.slice(0, 300)}`, probe: probeOf(board, null) }
          if (!accepted(os, config.allow)) {
            return { ok: false, message: `${board} 上是 ${os.name}（ID=${os.id}${os.like.length ? `，ID_LIKE=${os.like.join(' ')}` : ''}），不是 ${config.allow.join('、')} 一类的系统：不改它`, probe: probeOf(board, os) }
          }
          say(`串口上是 ${os.name}`)
          const systemd = (await talk.command('[ -d /run/systemd/system ] && echo yes || echo no'))?.trim() === 'yes'
          if (!systemd) return { ok: false, message: `${board} 上是 ${os.name}，但不是 systemd 管着的：不知道怎么让串口登录免密`, probe: probeOf(board, os) }
          const uid = (await talk.command('id -u'))?.trim() ?? ''
          const asRoot = uid === '0'
          const sudo = asRoot ? true : (await talk.command('sudo -n true 2>/dev/null && echo yes || echo no'))?.trim() === 'yes'
          if (!sudo) return { ok: false, message: `${board}：登录的账号（${loggedInAs ?? '一个普通账号'}）不是 root，也没有免密 sudo：用 root 登录，或者先给它配好 sudo`, probe: probeOf(board, os) }
          // One way to run a command as root: directly as root, or through sudo's shell.
          const shell = (command: string, timeoutMs?: number) => talk.command(asRoot ? command : `sudo -n sh -c ${dq(command)}`, timeoutMs)
          const tty = (await shell('tty 2>/dev/null || cat /sys/class/tty/console/active'))?.trim().split(/\s+/)[0] ?? ''
          const device = tty.replace(/^\/dev\//, '').trim()
          if (!device) return { ok: false, message: `${board}：说不清串口是哪个 tty（tty 和 console/active 都没给）`, probe: probeOf(board, os, null, null, true) }
          const units = await shell("systemctl list-units --type=service --all --no-legend --plain 'serial-getty@*' 'getty@*' 2>/dev/null | awk '{print $1}' | sort -u") ?? ''
          const unit = units.split('\n').map(line => line.trim()).find(name => name.includes(`@${device}.`)) ?? null
          if (!unit) return { ok: false, message: `${board}：${device} 上没有 serial-getty/getty 单元（这一版的串口 shell 是不是放在别处？）`, probe: probeOf(board, os, device, null, true) }
          // The last `ExecStart=` is the one that runs: a drop-in resets it with an empty line first.
          const execLine = (await shell(`systemctl cat '${unit}' 2>/dev/null | grep '^ExecStart=' | tail -1`))?.trim() ?? ''
          if (!execLine.startsWith('ExecStart=')) return { ok: false, message: `${board}：读不出 ${unit} 的 ExecStart（得到的：${execLine.slice(0, 120)}）`, probe: probeOf(board, os, device, unit, true) }
          const exec = execLine.slice('ExecStart='.length)
          const on = /--autologin(?:[=\s])/.test(exec)
          const account = exec.match(/--autologin[=\s]+(\S+)/)?.[1] ?? null
          const probe = probeOf(board, os, device, unit, true, exec, on, account, loggedInAs, asRoot)
          if (action === 'check') return { ok: true, message: `${os.name}，串口在 ${device}${on ? `，已经免密（${account}）` : `，登录要密码（${unit}）`}`, probe }
          if (action === 'undo') return await undo(talk, board, caller, probe, shell, asRoot, say)
          if (on && account === user) return { ok: true, message: `${board}：串口已经免密了（${unit} 以 ${account} 自动登录），没有改`, probe }

          // 3. The drop-in: the vendor's ExecStart with autologin added, then the getty restarted.
          const next = autologinExec(exec, user)
          const dir = `/etc/systemd/system/${unit}.d`
          const file = `${dir}/autologin.conf`
          say(`写 ${file}，把 ${unit} 改成以 ${user} 自动登录…`)
          const content = [FILE_MARK, '[Service]', 'ExecStart=', `ExecStart=${next}`].map(dq).join(' ')
          const written = await shell(`mkdir -p '${dir}' && printf '%s\\n' ${content} > '${file}' && systemctl daemon-reload && echo written`)
          if (written === null || !written.includes('written')) return { ok: false, message: `${board}：写 ${file} 没成功：\n${written ?? talk.tail()}`, probe }
          const restarted = await restart(talk, unit, shell, asRoot, false, 'shell', say)
          if (!restarted.ok) return { ok: false, message: `${board}：${restarted.message}`, probe }
          const entry: Entry = { board, at: new Date().toISOString(), actor: caller.holder, os: os.name, osId: os.id, device, unit, account: user, file, state: 'on', endedAt: null }
          remember(entry)
          lab.kernel.record(caller.holder, board, 'login-disable', `${device} ${unit} 以 ${user} 自动登录`, true)
          say('串口现在直接是 shell 了')
          return { ok: true, message: `${board}：${os.name}，串口 ${device} 现在免密（${unit} 以 ${user} 自动登录）。要还原：boardlab login-disable ${board} --undo`, probe: { ...probe, exec: next, autologin: true, account: user }, entry }
        } finally { talk.close(); session.close() }
      }

      const streaming = (action: Action) => (request: { body: any, caller: { holder: string } }) => {
        const board = lab.boards.resolve(required(request.body?.board, 'board'))
        const caller = { holder: request.caller.holder, token: typeof request.body?.token === 'string' ? request.body.token : null }
        // `user`: an account the run was asked for, one shell word's worth (as the CLI checks it).
        const asked = typeof request.body?.user === 'string' ? request.body.user.trim() : ''
        const user = asked && /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(asked) ? asked : config.user
        return new EventStream(async (emit, end) => {
          let result: Result
          try {
            result = await run(board, caller, action, line => emit('out', { text: `${line}\n` }), user)
          } catch (error) {
            result = { ok: false, message: error instanceof BoardError ? error.message : `没有做成：${(error as Error).message}` }
            lab.kernel.record(caller.holder, board, 'login-disable', `${action} 没有做成`, false, result.message.slice(0, 300))
          }
          emit('exit', result)
          end()
        })
      }

      lab.addState(() => ({ loginDisable: known() }) as unknown as Record<string, unknown>)
      lab.api.add('login-disable', [
        {
          method: 'GET', path: '/api/login-disable',
          about: '串口免密登录：boardd 记得的每块板子（识别到的系统、串口、getty，是谁什么时候开的，还在不在）',
          handle: () => ({ boards: known() }),
        },
        {
          method: 'POST', path: '/api/login-disable/check',
          about: '只看不改：登录串口（body: board、要拿锁的 token），报告系统、串口 tty、getty 单元和它现在要不要密码；事件流 out，最后 exit {ok, message, probe}',
          handle: streaming('check'),
        },
        {
          method: 'POST', path: '/api/login-disable/apply',
          about: '让串口免密：登录后写一个 getty drop-in（以 settings 里的账号自动登录）并重启它；事件流 out，最后 exit {ok, message, probe, entry}',
          handle: streaming('apply'),
        },
        {
          method: 'POST', path: '/api/login-disable/undo',
          about: '还原：删掉 boardlab 写的那个 drop-in 并重启 getty，串口重新要密码；事件流 out，最后 exit {ok, message, probe}',
          handle: streaming('undo'),
        },
      ])
      return { known, run: (board, caller, action, say) => run(lab.boards.resolve(board), caller, action, say) }
    },
  }
}

export default loginDisable
