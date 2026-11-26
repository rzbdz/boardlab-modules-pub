/**
 * The market module's page: a tab of its own, because a shop is not a setting.
 *
 * What is here is what a person does with markets: add one (a git URL), see what each offers, install a module into
 * boardd's configuration, take one out again, pull newer versions, and let boardd pick the result up without anyone
 * stopping it. The view reads the same state the CLI does (`GET /api/market`), so "installed" means the same thing to
 * both: the module is in the configuration boardd loads.
 *
 * Adding a market and installing a module change what this machine runs, so boardd refuses them from an agent and the
 * page says so where it matters (the operations fail with boardd's own words).
 */
import { action, call, notice, text, type Element, type ModuleUi, type PageState, type View } from 'boardlab/ui'

interface Offered { id: string, title: string, about: string, tags: string[], inject: string[], provide: string[], version: string | null }
interface Market { id: string, url: string, branch: string | null, commit: string | null, modules: Offered[], problems: string[] }
interface Markets { markets: Market[], problems: string[], selected: string[], canReload: boolean }

/** The last read; the page draws it while a fresh one is on its way. */
let known: Markets | null = null
const load = async () => { known = await call<Markets>('GET', 'api/market'); return known }
void load().catch(() => {})

/** What a module needs and offers, in one line, so a person can see why installing it may bring something else along. */
const edges = (module: Offered) => [module.inject.length ? `要 ${module.inject.join('、')}` : '', module.provide.length ? `给 ${module.provide.join('、')}` : '', module.version ? module.version : ''].filter(Boolean).join(' · ')

export const ui: ModuleUi = {
  module: 'market',
  views(state: PageState): View[] {
    const data = known
    // "Installed" is boardd's own answer: its configuration. A module that is selected but failed to load is still
    // installed (its page part is not drawn, since `state.modules` lists what runs); the list says which is which.
    const running = new Set(state.modules.map(module => module.id))
    const chosen = new Set(data?.selected ?? [])
    const body: Element[] = [
      text('模块市场是放模块的地方：一个 git 仓库，里面每个目录是一个模块包。加了市场不等于装了它里面的模块；装了的模块写进 boardd 的配置，重启后由 boardd 加载。'),
      ...(data ? [] : [text('读取中…')]),
      ...(data?.problems ?? []).map(problem => notice(problem)),
    ]

    for (const market of data?.markets ?? []) {
      body.push({
        kind: 'group',
        title: `${market.id}  ${market.commit ? market.commit.slice(0, 12) : '还没拉取'}`,
        status: market.problems.length ? { tone: 'warn', text: `${market.problems.length} 个问题` } : { tone: 'ok', text: `${market.modules.length} 个模块` },
        body: [
          text([{ code: market.url }, market.branch ? `（${market.branch}）` : '']),
          ...market.problems.map(problem => notice(problem)),
          {
            kind: 'list', empty: '这个市场没有提供模块',
            items: market.modules.map(module => {
              const installed = chosen.has(module.id), live = running.has(module.id)
              return {
                key: module.id,
                title: module.title,
                description: [module.id, module.about, edges(module)].filter(Boolean).join('  ·  '),
                status: installed
                  ? { tone: live ? 'ok' as const : 'warn' as const, text: live ? '在跑' : installed ? '装了，没在跑' : '没装' }
                  : { tone: 'neutral' as const, text: '没装' },
                actions: installed
                  ? [
                    action(`uninstall-${module.id}`, '卸载', async () => {
                      const out = await call<{ message: string }>('POST', 'api/market/uninstall', { id: module.id })
                      await load(); return out.message
                    }, { confirm: { title: `卸载 ${module.title}`, body: '从 boardd 的配置里拿掉它：代码和设置都还在市场里，要装回来再点一次就行。', action: '卸载' } }),
                  ]
                  : [
                    action(`install-${module.id}`, '安装', async () => {
                      const out = await call<{ message: string, missing: string[] }>('POST', 'api/market/install', { id: module.id })
                      await load(); return out.message
                    }, { intent: 'primary' }),
                  ],
              }
            }),
          },
          {
            kind: 'actions',
            actions: [
              action(`update-${market.id}`, '拉取新版本', async () => {
                const out = await call<{ message: string }>('POST', 'api/market/update', { id: market.id })
                await load(); return out.message
              }),
              action(`remove-${market.id}`, '删掉这个市场', async () => {
                const out = await call<{ message: string }>('POST', 'api/market/remove', { id: market.id, yes: true })
                await load(); return out.message
              }, { intent: 'danger', confirm: { title: `删掉市场 ${market.id}`, body: '它在本机的复制品一起删掉；配置里从它装的模块下次启动就没了（现在正在跑的这次不受影响）。', action: '删掉' } }),
            ],
          },
        ],
      })
    }

    body.push({
      kind: 'form',
      fields: [
        { kind: 'text', id: 'id', label: '市场名', required: true, placeholder: 'pub', pattern: '[A-Za-z0-9][A-Za-z0-9._-]{0,63}', help: '本机上的名字：命令行里用它，两个市场的名字不能一样' },
        { kind: 'text', id: 'url', label: 'git 地址', required: true, wide: true, placeholder: 'git@github.com:组/仓库.git 或 https://…' },
        { kind: 'text', id: 'branch', label: '分支（可选）', placeholder: '默认是仓库自己的默认分支' },
      ],
      submitLabel: '加市场',
      note: '市场里的代码在 boardd 进程里跑，权限和 boardd 一样：只加你信得过的市场。私有市场用 ssh 地址，靠这台机器自己的密钥。',
      submit: action('add-market', '加市场', async input => {
        const out = await call<{ message: string }>('POST', 'api/market/add', { id: String(input.id).trim(), url: String(input.url).trim(), branch: String(input.branch ?? '').trim() || undefined })
        await load(); return out.message
      }, { intent: 'primary' }),
    })

    // What the configuration names but no market offers, and that is not running either: a module from a market that
    // was deleted, or one whose file is gone. A module this distribution has built in is running, so it is not here.
    const orphan = [...chosen].filter(id => !(data?.markets ?? []).some(market => market.modules.some(module => module.id === id)) && !running.has(id))
    if (data && orphan.length) body.push(notice(`配置里还有这些模块，可是没有市场提供它们，它们也没在跑：${orphan.join('、')}。装回来，或者从配置里拿掉。`))

    if (data && data.canReload && (data.markets.length || chosen.size)) body.push({
      kind: 'actions',
      actions: [
        action('reload', '让 boardd 按现在的配置重新加载', async () => {
          const out = await call<{ message: string }>('POST', 'api/market/reload', {})
          return out.message
        }, { intent: 'primary', confirm: { title: '重新加载 boardd', body: '会起一个新的 boardd 进程按现在的配置加载，新的连接去它那里；旧进程跑完手上的任务再退，正在刷的机不会被打断。', action: '重新加载' } }),
      ],
    })
    if (data && !data.canReload) body.push(text([{ muted: '这个 boardd 不在 supervisor 下跑（比如从源码直接 serve）：装、卸、加市场都要重启它才生效。' }]))

    return [{
      id: 'market', slot: 'page', title: '模块市场', help: 'market/market',
      status: data ? { tone: data.problems.length ? 'warn' : 'ok', text: data.markets.length ? `${data.markets.length} 个市场 · ${chosen.size} 个装了` : '没有市场' } : undefined,
      body,
    }]
  },
}
