/**
 * The console-watch module's part of the page: the watchers an aging run (or a person watching ten boards at once) set
 * up — which boards, which lines, and whether they are running. A match or a silence goes to the notification bus; this
 * view only sets the watchers up and says what fired.
 */
import { action, call, notice, text, type ModuleUi, type PageState, type View } from 'boardlab/ui'

interface Pattern { match: string, label: string }
interface Watcher { id: string, title: string, boards: string[] | '*', patterns: (string | Pattern)[], mode: string, silentMs: number, running: boolean, fired: Array<{ at: string, board: string, line: string }> }

let known: Watcher[] | null = null
const load = async () => { known = (await call<{ watchers: Watcher[] }>('GET', 'api/console-watch')).watchers; return known }
void load().catch(() => {})
const patternText = (pattern: string | Pattern) => typeof pattern === 'string' ? pattern : pattern.match
const boardsText = (boards: string[] | '*') => boards === '*' ? '所有板子' : boards.join('、')

export const ui: ModuleUi = {
  module: 'console-watch',
  views(state: PageState): View[] {
    const watchers = known ?? ((state as PageState & { consoleWatch?: Watcher[] }).consoleWatch ?? [])
    return [{
      id: 'console-watch', slot: 'page', title: '串口监控', help: 'console-watch/console-watch',
      status: watchers.some(watcher => watcher.running) ? { tone: 'ok', text: `${watchers.filter(watcher => watcher.running).length} 个在盯` } : undefined,
      body: [
        text('老化、长跑时，一个监控可以同时盯住所有板子（或指定几块）的串口：命中某一行，或者期待的那行长时间不出现，就发到「通知」总线。监控只看不发、不拿锁。'),
        ...(watchers.length ? [] : [notice('还没有监控。在下面加一个，或者用命令行：', 'neutral'), text([{ code: 'boardlab watch console add aging-1 --boards "*" re:panic' }])]),
        { kind: 'list', empty: '还没有监控',
          items: watchers.map(watcher => ({
            key: watcher.id,
            title: watcher.title,
            description: `${boardsText(watcher.boards)} · ${watcher.patterns.map(patternText).join('、')} · ${watcher.mode === 'absent' ? `缺行告警（静默 ${Math.round(watcher.silentMs / 1000)} 秒）` : '命中即告警'}${watcher.fired.length ? ` · 触发过 ${watcher.fired.length} 次，最近 ${watcher.fired.at(-1)!.board}` : ''}`,
            tag: watcher.running ? '在盯' : '没跑',
            status: { tone: watcher.running ? 'ok' : 'neutral', text: watcher.running ? '在盯' : '没跑' },
            actions: [
              action(`${watcher.running ? 'stop' : 'start'}-${watcher.id}`, watcher.running ? '停下' : '开始', async () => {
                await call('POST', `api/console-watch/${encodeURIComponent(watcher.id)}/${watcher.running ? 'stop' : 'start'}`, {})
                await load(); return watcher.running ? '已停下' : '开始盯了'
              }, { intent: watcher.running ? 'default' : 'primary' }),
              action(`remove-${watcher.id}`, '删掉', async () => {
                await call('POST', `api/console-watch/${encodeURIComponent(watcher.id)}/remove`, { yes: true })
                await load(); return '删了'
              }, { intent: 'danger', confirm: { title: `删掉监控 ${watcher.title}`, body: '它不再盯这些板子；已经发出去的通知还在。', action: '删掉' } }),
            ],
          })) },
        {
          kind: 'form', submitLabel: '加监控',
          note: '匹配从第一行命中就发；一块板子上同一条噪声五秒内只发一次。缺行告警要的是「健康的运行会打的那一行」，从开始盯、或者从最近看到的任何一行算起，多少秒没动静算挂。',
          fields: [
            { kind: 'text', id: 'id', label: '名字', required: true, placeholder: 'aging-1', help: '也能当标签用：渠道规则里按它筛' },
            { kind: 'text', id: 'boards', label: '盯哪些板子（逗号分开，留空=所有）', placeholder: 'board-1,board-2 或留空' },
            { kind: 'text', id: 'patterns', label: '匹配（逗号分开；re:正则、str:原文，或直接写正则）', required: true, wide: true, placeholder: 're:panic,str:login:' },
            { kind: 'choice', id: 'mode', label: '什么时候告警', initial: 'line', options: [{ value: 'line', label: '匹配到就告警' }, { value: 'absent', label: '期待的那行长时间不出现（缺行告警）' }] },
            { kind: 'number', id: 'silent', label: '缺行多久算挂（秒）', initial: 600, min: 5 },
          ],
          submit: action('add-watch', '加监控', async input => {
            const boards = String(input.boards ?? '').trim()
            await call('POST', 'api/console-watch', {
              id: String(input.id), title: String(input.id), boards: boards ? boards.split(',').map(word => word.trim()).filter(Boolean) : '*',
              patterns: String(input.patterns).split(',').map(word => word.trim()).filter(Boolean), mode: String(input.mode ?? 'line'),
              ...(input.silent ? { silentMs: Number(input.silent) * 1000 } : {}),
            })
            await load(); return '加好了'
          }, { intent: 'primary' }),
        },
      ],
    }]
  },
}
