/**
 * `boardlab login-disable`: open a debug board's serial console once, so it stops asking for a login.
 *
 *   boardlab login-disable <board>            # 看串口上是什么系统、哪个 getty，并把它改成免密自动登录
 *   boardlab login-disable <board> --check    # 只看，不改
 *   boardlab login-disable <board> --undo     # 还原成要密码
 *   boardlab login-disable list               # boardd 记得哪些板子上开过
 *
 * It holds the board's lock while it types (taking it when nobody holds it, giving it back after), because opening a
 * console's login is typing on the console.
 */
import type { RemoteCommand, RemoteCommandGroup } from 'boardlab'

interface Entry { board: string, at: string, actor: string, os: string, osId: string, device: string, unit: string, account: string, file: string, state: 'on' | 'off', endedAt: string | null }
interface Probe { board: string, os: { id: string, name: string, like: string[] } | null, device: string | null, unit: string | null, exec: string | null, autologin: boolean, account: string | null, loggedInAs: string | null, root: boolean, systemd: boolean }
interface Outcome { ok: boolean, message: string, probe?: Probe, entry?: Entry }

/** A probe as a person reads it: what runs there, the port, the getty, and whether it asks for a password. */
const probeText = (probe: Probe) => [
  probe.os ? `${probe.os.name}（ID=${probe.os.id}${probe.os.like.length ? `，ID_LIKE=${probe.os.like.join(' ')}` : ''}）` : '系统不明',
  probe.device ? `串口 ${probe.device}` : '串口不明',
  probe.unit ? `getty ${probe.unit}` : 'getty 不明',
  probe.autologin ? `已经免密（${probe.account}）` : '要密码',
  ...(probe.loggedInAs ? [`登录用 ${probe.loggedInAs}`] : []),
].join('，')

const loginDisable: RemoteCommand = {
  name: 'login-disable',
  usage: [
    'login-disable <board> [--check|--undo] [--user 账号]\t串口免密：识别板子上的 Bianbu/Ubuntu/Debian，自己登录一次，把串口 getty 改成自动登录（要拿锁，会自己拿并放）；--check 只看，--undo 还原成要密码',
    'login-disable list\t哪些板子上开过串口免密，现在还在不在',
  ],
  async run({ args, client, flags, flag, json, out, remote, target, token, keepToken }) {
    if (args[0] === 'list' || args[0] === 'ls') {
      const { boards } = await client.call<{ boards: Entry[] }>('GET', '/api/login-disable')
      out(boards, () => {
        if (!boards.length) return console.log('还没有在板子上开过串口免密：boardlab login-disable <board>')
        for (const entry of boards) console.log(`${entry.board}\t${entry.state === 'on' ? '开着' : '已还原'}\t${entry.os}\t${entry.device}\t${entry.unit}（${entry.account}，${entry.at.slice(0, 16).replace('T', ' ')} ${entry.actor}）`)
      })
      return
    }
    const { board } = target()
    const action = flags.has('undo') ? 'undo' : flags.has('check') ? 'check' : 'apply'
    // Typing on a console needs the lock. Take it when nobody holds it, and give it back after: a person who wants
    // the board keeps it, and this only reads what it needs from it.
    let held = token()
    if (!held && action !== 'check') {
      const result = await client.lock(board, '串口免密登录')
      if (!result.token) throw new Error(remote
        // boardd on another machine cannot ask this one's person; the board is simply someone else's.
        ? `${board} 正被 ${result.lease?.holder ?? '别人'} 使用，没有拿到锁`
        : `${board} 正被 ${result.lease?.holder ?? '别人'} 使用，没有拿到锁。需要的话：boardlab lock ${board} --wait`)
      held = result.token
      keepToken(board, held)
    }
    const mine = !!held && action !== 'check'
    try {
      const result = await client.streamCommand(`/api/login-disable/${action}`, { board, token: held, ...(flag('user') ? { user: flag('user') } : {}) }, (_stream, text) => { if (!json) process.stderr.write(text) }) as unknown as Outcome
      out(result, () => {
        console.log(result.message)
        if (result.probe && action === 'check') console.log(probeText(result.probe))
      })
      if (!result.ok) process.exitCode = 1
    } finally {
      if (mine && token() === held) { await client.unlock(board, held).catch(() => {}); keepToken(board, null) }
    }
  },
}

export const commands: RemoteCommandGroup = {
  id: 'login-disable', summary: '串口免密：识别板子上的系统，把串口 getty 改成自动登录（可还原）', title: '串口登录',
  commands: [loginDisable],
}
