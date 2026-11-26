/**
 * `boardlab watch console`: console watchers for long runs. One watcher binds a set of patterns to a set of boards (or
 * every board) and, while it runs, every matching line — or, in `absent` mode, the silence of a line a healthy run
 * prints — goes to the notification bus, where the channel rules decide whether it reaches a Feishu group, the page,
 * or both. Ten boards are watched by one watcher; watching is read-only and takes no lock.
 *
 *   boardlab watch console add aging-1 --boards board-1,board-2 '*panic*' 'str:login:'
 *   boardlab watch console start aging-1
 *   boardlab watch console list
 *   boardlab watch console stop aging-1
 */
import type { RemoteCommand, RemoteCommandGroup } from 'boardlab'

interface Pattern { match: string, label: string }
interface Watcher { id: string, title: string, boards: string[] | '*', patterns: (string | Pattern)[], mode: string, silentMs: number, running: boolean, fired: Array<{ at: string, board: string, line: string }> }

const patternText = (pattern: string | Pattern) => typeof pattern === 'string' ? pattern : pattern.match
const boardsText = (boards: string[] | '*') => boards === '*' ? '所有板子' : boards.join('、')

const watch: RemoteCommand = {
  name: 'watch', noBoard: true,
  usage: [
    'watch console [list]\t有哪些串口监控，在不在跑',
    'watch console add <id> [--boards a,b|*] [--title 名字] [--mode line|absent] [--silent 秒] <匹配…>\t加一个监控：匹配写成 re:<正则>、str:<原文>，或直接写正则',
    'watch console start <id> [--boards a,b|*] [--patterns …]\t开始盯（盯上现在的所有板子）',
    'watch console stop <id>\t停下',
    'watch console remove <id> --yes\t删掉',
  ],
  async run({ args, client, flag, flags, out }) {
    const [what, sub, ...rest] = args
    if (what !== 'console') throw new Error('用法：boardlab watch console …（boardlab help watch）')
    const call = <T>(method: 'GET' | 'POST', path: string, body?: unknown) => client.call<T>(method, path, body)
    if (!sub || sub === 'list') {
      const { watchers } = await call<{ watchers: Watcher[] }>('GET', '/api/console-watch')
      out(watchers, () => {
        if (!watchers.length) return console.log('还没有串口监控：boardlab watch console add <id> --boards "*" re:<正则>')
        for (const watcher of watchers) {
          console.log(`${watcher.id}  ${watcher.running ? '在盯' : '没跑'}  ${watcher.title}  [${watcher.mode === 'absent' ? `缺行告警，静默 ${Math.round(watcher.silentMs / 1000)}s` : '命中即告警'}]`)
          console.log(`  板子：${boardsText(watcher.boards)}`)
          console.log(`  匹配：${watcher.patterns.map(patternText).join('、')}`)
          if (watcher.fired.length) console.log(`  触发过 ${watcher.fired.length} 次，最近：${watcher.fired.at(-1)!.board} ${watcher.fired.at(-1)!.line}`)
        }
      })
      return
    }
    if (sub === 'add' || sub === 'start') {
      const id = rest[0]
      if (!id) throw new Error(`用法：boardlab watch console ${sub} <id> …`)
      const boardsFlag = flag('boards')
      const boards = boardsFlag === undefined ? undefined : boardsFlag === '*' ? '*' : boardsFlag.split(',').map(word => word.trim()).filter(Boolean)
      const patterns = rest.slice(1).length ? rest.slice(1) : flag('patterns') ? flag('patterns')!.split('|') : undefined
      if (sub === 'add') {
        if (!patterns?.length) throw new Error('add 要给至少一条匹配，例如 re:panic 或 str:login:')
        const result = await call<{ watcher: Watcher }>('POST', '/api/console-watch', {
          id, title: flag('title') ?? id, boards: boards ?? '*', patterns, mode: flag('mode') ?? 'line',
          ...(flag('silent') ? { silentMs: Number(flag('silent')) * 1000 } : {}),
        })
        out(result, () => console.log(`加了串口监控 ${result.watcher.id}：${boardsText(result.watcher.boards)}，${result.watcher.patterns.map(patternText).join('、')}`))
        return
      }
      const result = await call<{ watcher: Watcher, watching: string[] }>('POST', `/api/console-watch/${encodeURIComponent(id)}/start`, {
        ...(boards === undefined ? {} : { boards }), ...(patterns?.length ? { patterns } : {}),
      })
      out(result, () => console.log(`${id} 开始盯 ${result.watching.length} 块板子${result.watching.length ? `：${result.watching.join('、')}` : '（现在没有板子，有板子后自动盯上）'}`))
      return
    }
    if (sub === 'stop') {
      const id = rest[0]
      if (!id) throw new Error('用法：boardlab watch console stop <id>')
      const result = await call<{ stopped: string }>('POST', `/api/console-watch/${encodeURIComponent(id)}/stop`)
      out(result, () => console.log(`${id} 停了`))
      return
    }
    if (sub === 'remove') {
      const id = rest[0]
      if (!id) throw new Error('用法：boardlab watch console remove <id> --yes')
      if (!flags.has('yes')) throw new Error(`删掉监控 ${id}？确认请加 --yes`)
      const result = await call<{ removed: string }>('POST', `/api/console-watch/${encodeURIComponent(id)}/remove`, { yes: true })
      out(result, () => console.log(`删了 ${result.removed}`))
      return
    }
    throw new Error(`不认识的用法：boardlab watch console ${[sub, ...rest].join(' ')}（boardlab help watch）`)
  },
}

export const commands: RemoteCommandGroup = { id: 'watch', summary: '串口监控：老化/长跑时盯多块板的串口，命中或缺行发到通知总线', title: '监控', commands: [watch] }
