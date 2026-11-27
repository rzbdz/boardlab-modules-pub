/**
 * The login-disable module against a console that behaves like a debug board's: a login prompt, two accounts, a shell
 * that answers a few commands, and a getty whose restart ends that shell and starts the next one — signed in or asking
 * for a password, depending on the drop-in the run wrote.
 *
 * The board is a fake (the test drives the console's bytes); nothing here reaches hardware.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from 'boardlab-core/core/db.ts'
import { BoardLab } from 'boardlab-core/core/lab.ts'
import type { ConsoleSession } from 'boardlab-core/core/console.ts'
import { autologinExec, dq, FILE_MARK, loginDisable, osRelease, settingsOf } from './index.ts'

const dirs: string[] = []
function dir(): string {
  const made = mkdtempSync(join(tmpdir(), 'boardlab-login-'))
  dirs.push(made)
  return made
}
process.on('exit', () => { for (const made of dirs) rmSync(made, { recursive: true, force: true }) })

async function call(lab: BoardLab, method: 'GET' | 'POST', path: string, body: Record<string, unknown> = {}, holder = 'claude:task-1'): Promise<any> {
  const url = new URL(path, 'http://boardd')
  const found = lab.api.match(method, url.pathname)
  if (!found) throw new Error(`no ${method} ${url.pathname}`)
  return found.endpoint.handle({ query: url.searchParams, params: found.params, body, caller: { holder, local: true } } as never)
}

/** A streaming endpoint's answer: what it emitted, and its `exit`. */
async function streamed(reply: { start: (emit: (event: string, data: unknown) => void, end: () => void, signal: AbortSignal) => Promise<void> }): Promise<{ lines: string[], exit: any }> {
  const lines: string[] = []
  let exit: unknown = null
  const controller = new AbortController()
  await reply.start((_event, data) => {
    const value = data as { text?: string, ok?: boolean, message?: string }
    if (typeof value.text === 'string') lines.push(value.text.trimEnd())
    else exit = value
  }, () => {}, controller.signal)
  return { lines, exit }
}

const SHELL = /(?:^|\n)(?:[\w.-]+@[\w.:-]+:[^\r\n]*?[#$]|[$#])\s*$/

/**
 * A board's serial console, as far as this module can tell. What is typed reaches `take` one line at a time; the shell
 * answers the bracketed form (`echo start; <command>; echo end`) the way a board would, echoing the line and then the
 * answer. Restarting the getty ends the shell and starts the next one: signed in when its drop-in has `--autologin`.
 */
class Console {
  listeners = new Set<(data: Buffer) => void>()
  /** Everything typed, in order: the test checks where a password went (and that it never reaches the action log). */
  typed: string[] = []
  /** Each login attempt: the account, and the password given at its prompt. */
  attempts: Array<{ user: string, password: string }> = []
  /** The bytes of the line being typed at the shell, not yet ended: the console echoes them as they come. */
  private typing = ''
  files = new Map<string, string>()
  accounts = new Map([['root', 'bianbu'], ['bianbu', 'bianbu']])
  shellUser: string | null = null
  /** What the console is waiting for: the login, the password of `pendingUser`, or a shell. */
  at: 'login' | 'password' | 'shell' | 'other' = 'login'
  pendingUser: string | null = null
  release = 'PRETTY_NAME="Bianbu 2.1"\nID=bianbu\nID_LIKE=debian\n'
  exec = '/sbin/agetty -o -p -- \\u --keep-baud 115200,57600,38400,9600 - ${TERM}'
  sudo = true
  /** The pid of the shell: a new getty's shell has another one. */
  pid = 4242
  history = ['U-Boot SPL 2022.10', 'Starting kernel ...']

  emit(text: string) { for (const listener of [...this.listeners]) listener(Buffer.from(text)) }
  prompt() { return this.at === 'shell' ? `${this.shellUser}@board:~# ` : this.at === 'password' ? 'Password: ' : '\r\nboard login: \r\n' }
  session(): ConsoleSession {
    // Arriving at the console prints what it is waiting for, one line below where the module is reading.
    const opening = setTimeout(() => this.emit(this.prompt()), 1)
    opening.unref?.()
    return {
      hello: { alias: 'fake', device: null, baud: 115200, transport: 'fake' }, history: this.history,
      send: () => { throw new Error('看串口的连接不能输入') },
      onOutput: fn => { this.listeners.add(fn); return () => this.listeners.delete(fn) },
      onClose: () => {}, close: () => {},
    }
  }

  /** Bytes arrive at the console. A line ends at `\r` (the module sends `\r` for Enter; a board echoes it as one newline). */
  type(data: string) {
    this.typed.push(data)
    for (const char of data) {
      if (char === '\r' || char === '\n') {
        const line = this.typing; this.typing = ''
        this.emit('\r\n')
        this.line(line)
        continue
      }
      this.typing += char
      this.emit(char)
    }
  }

  private line(line: string): void {
    // The prompt sent after a refused login puts the console back at its login, as the board's getty does.
    if (this.at === 'other') { this.at = 'login'; return this.line(line) }
    if (this.at === 'login') return this.login(line)
    if (this.at === 'password') return this.password(line)
    return this.command(line)
  }
  private login(name: string) {
    if (!name) return void this.emit(this.prompt())
    if (!this.accounts.has(name)) return void setTimeout(() => this.emit('Login incorrect' + this.prompt()), 1)
    this.pendingUser = name
    this.at = 'password'
    setTimeout(() => this.emit('\r\nPassword: '), 1)
  }
  private password(value: string) {
    const user = this.pendingUser!
    this.attempts.push({ user, password: value })
    this.pendingUser = null
    if (this.accounts.get(user) !== value) {
      // A refused login: the prompt after the one the module types (to see what the console ended up at) is the login.
      this.at = 'other'
      return void setTimeout(() => this.emit('\r\nLogin incorrect' + this.prompt()), 1)
    }
    this.shellUser = user
    this.at = 'shell'
    setTimeout(() => this.emit(`${user}@board:~# `), 1)
  }
  private command(line: string) {
    // The module types one line: `echo <start>; <command>; echo <token>_$(echo e)` (or the restart, plain). The console
    // echoes it, as a board does, then runs it: the start marker, the answer, the end marker.
    const start = line.match(/(?:^|;\s*)echo (__bl_\w+_s);/)?.[1] ?? null
    if (start) {
      const token = start.slice(0, -2)
      const end = `${token}_e`
      const command = line.replace(/^.*?echo __bl_\w+_s; /, '').replace(/; echo __bl_\w+_\$\(echo e\)$/, '').trim()
      // The shell is asked the same things `run` knows, and the same suffix forms the module uses (`|| true`,
      // `2>/dev/null`, an emptiness fallback): a command it does not know answers nothing.
      const out = this.run(command)
      return void setTimeout(() => this.emit(`${start}\r\n${out ? `${out}\r\n` : ''}${end}\r\n${this.prompt()}`), 2)
    }
    const restart = line.match(/^(?:sudo -n )?systemctl restart (\S+)$/)
    if (restart) {
      const file = `/etc/systemd/system/${restart[1]}.d/autologin.conf`
      const autologin = this.files.get(file)?.match(/--autologin (\S+)/)?.[1] ?? null
      this.at = autologin ? 'shell' : 'login'
      this.shellUser = autologin
      this.pid++
      // The old shell's getty ends; the new one prints its prompt a moment later.
      return void setTimeout(() => this.emit(this.prompt()), 30)
    }
    setTimeout(() => this.emit(this.prompt()), 2)
  }
  private run(command: string): string {
    // A board where the login is not root runs each command through sudo's shell: unwrap it, as sudo would.
    const sudo = command.match(/^sudo -n sh -c "((?:[^"\\]|\\.)*)"$/)
    if (sudo) return this.run(sudo[1]!.replace(/\\(.)/g, '$1'))
    if (command === 'cat /etc/os-release 2>/dev/null') return this.release.trimEnd()
    if (command === '[ -d /run/systemd/system ] && echo yes || echo no') return 'yes'
    if (command === 'id -u') return this.shellUser === 'root' ? '0' : '1000'
    if (command === 'sudo -n true 2>/dev/null && echo yes || echo no') return this.sudo ? 'yes' : 'no'
    if (command === 'tty 2>/dev/null || cat /sys/class/tty/console/active') return '/dev/ttyS0'
    if (command.startsWith('systemctl list-units')) return 'serial-getty@ttyS0.service'
    if (command.startsWith("systemctl cat 'serial-getty@ttyS0.service'")) {
      const drop = this.files.get('/etc/systemd/system/serial-getty@ttyS0.service.d/autologin.conf')
      // The last ExecStart wins: a drop-in resets the vendor's with an empty one.
      const lines = (drop ?? '').split('\n').filter(line => line.startsWith('ExecStart='))
      return `ExecStart=${lines.at(-1)?.slice('ExecStart='.length) || this.exec}`
    }
    if (command.startsWith('mkdir -p ')) {
      const file = command.match(/> '([^']+)'/)![1]!
      const words = [...command.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(match => match[1]!.replace(/\\(.)/g, '$1'))
      this.files.set(file, words.join('\n') + '\n')
      return 'written'
    }
    if (command.startsWith('grep -c ')) {
      const file = command.match(/grep -c '[^']*' '([^']+)'/)![1]!
      return this.files.get(file)?.includes(FILE_MARK) ? '1' : '0'
    }
    if (command.startsWith('rm -f ')) {
      this.files.delete(command.match(/rm -f '([^']+)'/)![1]!)
      return 'removed'
    }
    if (command === 'echo $$') return String(this.pid)
    return ''
  }
}

/** A lab with one board whose console is `console`; the board's lock is taken by the test as `claude:task-1`. */
function bench(name: string, console = new Console(), settings?: Record<string, unknown>) {
  const lab = new BoardLab({ db: openDatabase(join(dir(), `${name}.sqlite`)), now: () => Date.parse('2026-11-27T10:00:00Z'), modules: [] })
  lab.boards.add('user:dana', { name: 'board-1', chips: [{ serialPath: '/dev/ttyUSB0', alias: 'board-1' }] })
  ;(lab.consoles as unknown as { open: () => Promise<ConsoleSession> }).open = async () => console.session() as ConsoleSession
  ;(lab.consoles as unknown as { input: (_board: string, _caller: unknown, input: { data: string }) => Promise<void> }).input = async (_board, _caller, input) => { console.type(input.data) }
  lab.use(loginDisable(settings ? { settings } : {}))
  return { lab, console }
}

const tokenOf = async (lab: BoardLab) => (await lab.locks.lock('board-1', 'claude:task-1', '串口免密')).token

/** Let the module's waits run: its sleeps are real, so the test waits on the result the way a caller does. */
const settle = async <T>(promise: Promise<T>, ms = 40_000): Promise<T> => Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('超时')), ms))])

describe('the login-disable module', () => {
  it('signs in with the debug image\'s second account, finds the serial getty, and writes it a drop-in that signs in', async () => {
    const console = new Console()
    // The module's first account is wrong for this board (as a site's own image may be), so its second is what gets in.
    console.accounts.set('root', 'a-wrong-password')
    const { lab } = bench('apply', console, { accounts: 'root:not-this-one,bianbu:bianbu' })
    const token = await tokenOf(lab)
    const reply = await call(lab, 'POST', '/api/login-disable/apply', { board: 'board-1', token })
    const { lines, exit } = await settle(streamed(reply))
    expect(exit.ok, exit.message).toBe(true)
    expect(exit.message).toContain('Bianbu 2.1')
    expect(exit.message).toContain('ttyS0')
    expect(exit.entry).toMatchObject({ board: 'board-1', osId: 'bianbu', device: 'ttyS0', unit: 'serial-getty@ttyS0.service', account: 'root', state: 'on' })
    // The drop-in is the vendor's ExecStart with autologin after agetty, marked as this module's, and nothing else.
    const drop = console.files.get('/etc/systemd/system/serial-getty@ttyS0.service.d/autologin.conf')!
    expect(drop).toContain(FILE_MARK)
    expect(drop).toContain('ExecStart=/sbin/agetty --autologin root -o -p -- \\u')
    expect(console.at).toBe('shell')
    // The first account was refused and the second taken; every password sent went to a Password: prompt.
    expect(lines.join('\n')).toContain('用 root 登录')
    expect(lines.join('\n')).toContain('用 bianbu 登录')
    // Both accounts were tried, each password given at its own `Password:` prompt: root's was refused, bianbu's taken.
    expect(console.attempts).toEqual([{ user: 'root', password: 'not-this-one' }, { user: 'bianbu', password: 'bianbu' }])
    // What was typed at the login, then the restart (run as root's own uid, a plain command); the run's commands go
    // through the bracketed form and are checked by the console having answered them.
    expect(console.typed.filter(text => !/^echo __bl_/.test(text) && !/systemctl (list-units|cat|daemon-reload)|^(mkdir|rm|grep)/.test(text)))
      .toEqual(['\r', 'root\r', 'not-this-one\r', 'bianbu\r', 'bianbu\r', 'sudo -n systemctl restart serial-getty@ttyS0.service\r', '\r'])
    // What boardd records is who did it, and never the password.
    const actions = lab.kernel.db.prepare("SELECT detail, message FROM actions WHERE kind='login-disable'").all() as Array<{ detail: string, message: string | null }>
    expect(actions).toMatchObject([{ detail: 'ttyS0 serial-getty@ttyS0.service 以 root 自动登录' }])
    expect(JSON.stringify(actions)).not.toContain('not-this-one')
    const known = await call(lab, 'GET', '/api/login-disable')
    expect(known.boards).toMatchObject([{ board: 'board-1', state: 'on', unit: 'serial-getty@ttyS0.service' }])
  }, 90_000)

  it('says what it found without changing anything, and does nothing to a system it was not told to touch', async () => {
    const console = new Console()
    const { lab } = bench('check', console)
    const token = await tokenOf(lab)
    const seen = await settle(streamed(await call(lab, 'POST', '/api/login-disable/check', { board: 'board-1', token })))
    expect(seen.exit).toMatchObject({ ok: true, probe: { device: 'ttyS0', unit: 'serial-getty@ttyS0.service', autologin: false, systemd: true, os: { id: 'bianbu' } } })
    expect(console.files.size).toBe(0)

    // A system outside the list (a Buildroot without os-release is refused earlier; a Fedora says ID=fedora).
    const other = new Console()
    other.release = 'PRETTY_NAME="Fedora Linux 42"\nID=fedora\n'
    const second = bench('check-other', other)
    const token2 = await tokenOf(second.lab)
    const refused = await settle(streamed(await call(second.lab, 'POST', '/api/login-disable/apply', { board: 'board-1', token: token2 })))
    expect(refused.exit.ok).toBe(false)
    expect(refused.exit.message).toContain('不是 bianbu、ubuntu、debian 一类的系统')
    expect(other.files.size).toBe(0)
  }, 90_000)

  it('removes its own drop-in and puts the password back, and leaves an autologin it did not open alone', async () => {
    const console = new Console()
    const { lab } = bench('undo', console)
    const token = await tokenOf(lab)
    expect((await settle(streamed(await call(lab, 'POST', '/api/login-disable/apply', { board: 'board-1', token })))).exit.ok).toBe(true)
    expect(console.at).toBe('shell')
    const undone = await settle(streamed(await call(lab, 'POST', '/api/login-disable/undo', { board: 'board-1', token })))
    expect(undone.exit.ok, undone.exit.message).toBe(true)
    expect(console.files.size).toBe(0)
    expect(console.at).toBe('login')
    expect((await call(lab, 'GET', '/api/login-disable')).boards).toMatchObject([{ board: 'board-1', state: 'off' }])

    // A vendor image that ships autologin itself: not boardlab's file, and `undo` says so rather than deleting it.
    const vendor = new Console()
    vendor.files.set('/etc/systemd/system/serial-getty@ttyS0.service.d/autologin.conf', '[Service]\nExecStart=/sbin/agetty --autologin root -o -p -- \\u\n')
    vendor.at = 'shell'; vendor.shellUser = 'root'
    const third = bench('vendor', vendor)
    const token3 = await tokenOf(third.lab)
    const answer = await settle(streamed(await call(third.lab, 'POST', '/api/login-disable/undo', { board: 'board-1', token: token3 })))
    expect(answer.exit.ok).toBe(false)
    expect(answer.exit.message).toContain('不是 boardlab 打开的')
    expect(vendor.files.size).toBe(1)
  }, 90_000)

  it('refuses without the board\'s lock: typing on a console is what a lock is for', async () => {
    const { lab } = bench('unlocked')
    const { exit } = await settle(streamed(await call(lab, 'POST', '/api/login-disable/apply', { board: 'board-1' })))
    expect(exit.ok).toBe(false)
    expect(exit.message).toContain('请先拿 board-1 的锁')
  }, 30_000)

  it('reads a system from /etc/os-release, adds --autologin after agetty once, and refuses a line it cannot read', () => {
    expect(osRelease('PRETTY_NAME="Bianbu 2.1"\nID=bianbu\nID_LIKE=debian\n')).toEqual({ id: 'bianbu', name: 'Bianbu 2.1', like: ['debian'] })
    expect(osRelease('NAME=Buildroot')).toBeNull()
    expect(osRelease('ID=ubuntu\nID_LIKE=debian\n')?.like).toEqual(['debian'])
    const exec = '/sbin/agetty -o -p -- \\u --keep-baud 115200,57600,38400,9600 - ${TERM}'
    expect(autologinExec(exec, 'root')).toBe('/sbin/agetty --autologin root -o -p -- \\u --keep-baud 115200,57600,38400,9600 - ${TERM}')
    expect(autologinExec(autologinExec(exec, 'root'), 'bianbu')).toContain('--autologin root')
    expect(() => autologinExec('/usr/bin/sulogin', 'root')).toThrow(/不是 agetty/)
    expect(dq('a "b" $c')).toBe('"a \\"b\\" \\$c"')
  })

  it('has the vendor debug images\' accounts by default, and a site\'s own when it names them', () => {
    expect(settingsOf({})).toMatchObject({ user: 'root', allow: ['bianbu', 'ubuntu', 'debian'], accounts: [{ user: 'root', password: 'bianbu' }, { user: 'bianbu', password: 'bianbu' }] })
    expect(settingsOf({ accounts: 'root:secret,bianbu:bianbu, bad', user: 'bianbu', allow: 'kylin' })).toMatchObject({ user: 'bianbu', allow: ['kylin'], accounts: [{ user: 'root', password: 'secret' }, { user: 'bianbu', password: 'bianbu' }] })
    expect(settingsOf({ accounts: ['root:it:has:colons'] }).accounts).toEqual([{ user: 'root', password: 'it:has:colons' }])
  })
})
