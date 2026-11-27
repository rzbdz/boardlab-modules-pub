/**
 * The login-disable module's part of the page: on a board, whether its serial console asks for a password and the
 * button that makes it stop asking (or asks again). The page itself never types anything: the run goes to boardd,
 * which holds the board's lock, signs in and writes the getty drop-in.
 */
import { job, notice, stream, text, type Element, type ModuleUi, type PageState, type View } from 'boardlab/ui'

interface Entry { board: string, at: string, actor: string, os: string, device: string, unit: string, account: string, file: string, state: 'on' | 'off', endedAt: string | null }
const when = (iso: string) => new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

export const ui: ModuleUi = {
  module: 'login-disable',
  views(state: PageState, context): View[] {
    // A board's card: the console login as boardd last saw it, and the way to change it.
    const board = context.board ? state.boards.find(item => item.name === context.board) : undefined
    if (!board) return []
    const entries = ((state as PageState & { loginDisable?: Entry[] }).loginDisable ?? []).filter(entry => entry.board === board.name)
    const last = entries[0]
    const run = (path: string, label: string) => job(`login-${path}`, label, async (_input, sink, signal) => {
      const answer = await stream(path, { board: board.name }, sink, signal)
      return answer.message
    })
    const body: Element[] = [
      last
        ? text(last.state === 'on'
          ? `${last.os}：串口 ${last.device} 由 ${last.unit} 以 ${last.account} 自动登录（${when(last.at)} 由 ${last.actor} 打开）`
          : `${last.os}：串口 ${last.device} 的自动登录已经还原（${when(last.endedAt ?? last.at)} 由 ${last.actor}）`)
        : notice('还没在这块板子上看过串口登录。点「检查」会登录一次，看是什么系统、哪个 getty 在管串口。', 'neutral'),
      {
        kind: 'actions', actions: [
          run('api/login-disable/check', '检查'),
          run('api/login-disable/apply', last?.state === 'on' ? '重开' : '改成免密'),
          ...(last?.state === 'on' ? [run('api/login-disable/undo', '还原成要密码')] : []),
        ],
      },
    ]
    return [{ id: 'login-disable-board', slot: 'board', title: '串口登录', body }]
  },
}
