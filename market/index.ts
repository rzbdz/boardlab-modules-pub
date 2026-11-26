/**
 * The `market` module: the module markets this boardlab reads modules from, as the page sees them, and the one
 * operation a page can do to them — pull a market's newest version. Adding and removing a market change what the next
 * boardd process loads, so those stay with the CLI (`boardlab market add|remove`); updating is a git fetch, and a
 * running boardd keeps loading what it started with, so the page can do it and say "restart to apply".
 *
 * A market is a git repository of module packages (see `boardlab-core/core/module-markets.ts`). boardd clones each
 * under its state directory and imports the modules the configuration selects. What a market offers is its manifest,
 * never code that has run: the page lists ids, titles, tags and what each module needs and offers.
 *
 * The view is in `ui.ts`; the endpoints here are what it reads and the one thing it does.
 */
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { MarketModule, Module } from 'boardlab'
import { BoardError, isHuman, marketsOnDisk, readMarket, readRecords, syncMarket, writeRecords } from 'boardlab'
import { readModulesConfig, selected, writeModuleConfig } from './config.ts'

/** A market as the page lists it: a record, and what its copy says now. */
export interface MarketView {
  id: string
  url: string
  branch: string | null
  commit: string | null
  modules: MarketModule[]
  problems: string[]
}

/** A module from any market, as the page searches them: `market/id` tells two markets' modules apart. */
export interface SearchHit extends MarketModule { ref: string }

export interface MarketState { markets: MarketView[], problems: string[], selected: string[], canReload: boolean }

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** Git's own environment for a market fetch: no prompt (a private market's key is in this machine's configuration), a C locale. */
const GIT_ENV = { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' }

/** The markets on disk, each with what its copy says now (the CLI's own read, so the page and the CLI agree). */
function list(stateDir: string, configFile?: string | null, canReload = false): MarketState {
  const { markets, problems } = marketsOnDisk(stateDir)
  let chosen: string[] = []
  try { chosen = selected(readModulesConfig(stateDir, configFile)) } catch { chosen = [] }
  return { markets: markets.map(({ modules, problems: readProblems, ...record }): MarketView => ({ ...record, modules, problems: readProblems })), problems, selected: chosen, canReload }
}

export const market: Module<{ list: typeof list }> = {
  id: 'market',
  title: '模块市场',
  about: '从 git 仓库装的模块市场：看它们提供什么，拉取新版本（boardlab market add 加一个）',
  tags: ['module', 'market', 'own'],
  setup(lab, ctx) {
    const stateDir = ctx.stateDir
    // A module's API is offered under its own id, and `provide` adds names of its own: either answers a name an `inject`
    // asks for, so a market module that needs another market module is satisfied by one this configuration selected.
    const providers = () => {
      const names = new Set<string>()
      const config = readModulesConfig(stateDir, ctx.configFile)
      for (const id of selected(config)) {
        if (lab.has(id)) names.add(id)
        const offered = marketsOnDisk(stateDir).markets.flatMap(market => market.modules).find(module => module.id === id)
        for (const name of offered?.provide ?? []) names.add(name)
      }
      return names
    }
    lab.api.add('market', [
      {
        method: 'GET', path: '/api/market',
        about: '装了哪些模块市场，各自提供什么模块（id、说明、标签、要什么给什么），以及复制品有什么问题',
        handle: () => list(stateDir, ctx.configFile, !!lab.reloader),
      },
      {
        method: 'GET', path: '/api/market/search',
        about: '在装了的模块市场里按名字、说明和标签找模块（?text=）',
        handle: ({ query }) => {
          const text = (query.get('text') ?? '').trim().toLowerCase()
          const hits: SearchHit[] = []
          if (text) for (const market of list(stateDir).markets) {
            for (const module of market.modules) {
              if (`${module.id} ${module.title} ${module.about} ${module.tags.join(' ')}`.toLowerCase().includes(text)) hits.push({ ...module, ref: `${market.id}/${module.id}` })
            }
          }
          return { hits }
        },
      },
      {
        method: 'POST', path: '/api/market/add',
        about: '加一个模块市场（body: {id, url, branch}）：克隆到 boardd 的状态目录，下次加载就能装它的模块',
        handle: async ({ body, caller }) => {
          if (!isHuman(caller.holder)) throw new BoardError('forbidden', '加模块市场要人来做：它决定这台机器以后运行哪些代码')
          const raw = (body ?? {}) as { id?: unknown, url?: unknown, branch?: unknown }
          const id = typeof raw.id === 'string' ? raw.id.trim() : ''
          const url = typeof raw.url === 'string' ? raw.url.trim() : ''
          if (!ID.test(id)) throw new BoardError('invalid', `市场名 ${id || '（没写）'} 不对：只能用字母、数字、点、下划线和短横线`)
          if (!/^(https?:\/\/|ssh:\/\/|git@|file:\/\/|\/)[^\s]+$/.test(url)) throw new BoardError('invalid', '市场的地址要是一个 git 地址：https://…、ssh://…、git@host:组/仓库.git，或本机的路径')
          const { records } = readRecords(stateDir)
          if (records.some(record => record.id === id)) throw new BoardError('conflict', `已经有模块市场 ${id}：拉取它的新版本就好`)
          const branch = typeof raw.branch === 'string' && raw.branch.trim() ? raw.branch.trim() : null
          let synced: { dir: string, commit: string }
          try { synced = await syncMarket(stateDir, id, { url, branch, env: GIT_ENV }) }
          catch (error) { throw new BoardError('invalid', `克隆不了 ${url}：${(error as Error).message}`) }
          const { modules, problems: readProblems } = readMarket(id, synced.dir)
          writeRecords(stateDir, [...records, { id, url, branch, commit: synced.commit }])
          return { id, url, branch, commit: synced.commit, modules: modules.map(module => module.id), problems: readProblems, message: `加了模块市场 ${id}（${synced.commit.slice(0, 12)}）：${modules.length} 个模块` }
        },
      },
      {
        method: 'POST', path: '/api/market/install',
        about: '装一个市场里的模块（body: {id, settings?}）：写进 boardd 的配置并让它重新加载；它的依赖（inject 的服务）也要在配置里',
        handle: ({ body, caller }) => {
          if (!isHuman(caller.holder)) throw new BoardError('forbidden', '装模块要人来做：装上的代码在 boardd 里运行')
          const raw = (body ?? {}) as { id?: unknown, settings?: unknown }
          const id = typeof raw.id === 'string' ? raw.id.trim() : ''
          if (!ID.test(id)) throw new BoardError('invalid', `模块名 ${id || '（没写）'} 不对`)
          const market = marketsOnDisk(stateDir).markets.find(item => item.modules.some(module => module.id === id))
          if (!market) throw new BoardError('not-found', `没有模块市场提供 ${id}：boardlab module search ${id} 找找`)
          const offered = market.modules.find(module => module.id === id)!
          // What it needs has to be loaded too: the module says which services it takes, and whose ids those are is the
          // configuration's to answer — so this checks that something already selected provides each of them.
          const provided = providers()
          const missing = offered.inject.filter(name => !provided.has(name))
          const settings = raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings) ? raw.settings as Record<string, unknown> : {}
          writeModuleConfig(stateDir, ctx.configFile, id, settings)
          const note = missing.length ? `；它要的 ${missing.join('、')} 还没有模块提供，加载时会等着或起不来` : ''
          return { installed: id, market: market.id, needs: offered.inject, missing, message: `装了 ${id}（来自 ${market.id}）${note}` }
        },
      },
      {
        method: 'POST', path: '/api/market/uninstall',
        about: '卸掉一个装了的模块（body: {id}）：从 boardd 的配置里拿掉，代码留在市场里',
        handle: ({ body, caller }) => {
          if (!isHuman(caller.holder)) throw new BoardError('forbidden', '卸模块要人来做')
          const raw = (body ?? {}) as { id?: unknown }
          const id = typeof raw.id === 'string' ? raw.id.trim() : ''
          const config = readModulesConfig(stateDir, ctx.configFile)
          if (!(id in config.modules)) throw new BoardError('not-found', `${id} 没有装在 boardd 的配置里`)
          writeModuleConfig(stateDir, ctx.configFile, id, null)
          return { removed: id, message: `卸了 ${id}：它的设置和代码都还在，要再装回来就再装一次` }
        },
      },
      {
        method: 'POST', path: '/api/market/reload',
        about: '让 boardd 按现在的配置重新加载（body: {}）：有 supervisor 时新进程接手新连接，旧进程跑完手上的任务再退',
        handle: ({ caller }) => {
          if (!isHuman(caller.holder)) throw new BoardError('forbidden', '让 boardd 重新加载要人来做')
          if (!lab.reloader) throw new BoardError('invalid', '这个 boardd 不在 supervisor 下跑（比如从源码直接 serve）：手动重启它才能加载新的配置')
          lab.reloader('配置里的模块变了')
          return { reloading: true, message: '正在换一个按新配置加载的 boardd：新连接去新的，旧的跑完手上的任务再退' }
        },
      },
      {
        method: 'POST', path: '/api/market/update',
        about: '拉取一些模块市场的新版本（body: {id} 一个，或省略为全部）；改了什么会列出来，重启 boardd 后生效',
        handle: async ({ body, caller }) => {
          if (!isHuman(caller.holder)) throw new BoardError('forbidden', '拉取模块市场要人来做：换掉的是所有在这台机器上运行的东西')
          const raw = (body ?? {}) as { id?: unknown }
          const id = typeof raw.id === 'string' ? raw.id : null
          const { records } = readRecords(stateDir)
          const chosen = id ? records.filter(record => record.id === id) : records
          if (!chosen.length) throw new BoardError('invalid', id ? `没有模块市场 ${id}` : '还没有模块市场：boardlab market add <市场> <git 地址>')
          const changed: Array<{ id: string, from: string | null, to: string, added: string[], updated: string[], removed: string[], problems: string[] }> = []
          let next = [...records]
          for (const record of chosen) {
            const copy = join(stateDir, 'markets', record.id)
            const before = existsSync(join(copy, 'market.json')) ? readMarket(record.id, copy) : { modules: [], problems: [] }
            const synced = await syncMarket(stateDir, record.id, { url: record.url, branch: record.branch, env: GIT_ENV })
            const after = readMarket(record.id, synced.dir)
            const known = new Map(before.modules.map(module => [module.id, module.digest]))
            const now = new Map(after.modules.map(module => [module.id, module.digest]))
            changed.push({
              id: record.id, from: record.commit, to: synced.commit,
              added: [...now.keys()].filter(key => !known.has(key)),
              updated: [...now.keys()].filter(key => known.has(key) && known.get(key) !== now.get(key)),
              removed: [...known.keys()].filter(key => !now.has(key)),
              problems: after.problems,
            })
            next = next.map(item => item.id === record.id ? { ...item, commit: synced.commit } : item)
            writeRecords(stateDir, next)
          }
          const differs = changed.some(item => item.from !== item.to)
          return { changed, restart: differs, message: differs ? '拉到了新版本：重启 boardd 后生效' : '已经是最新的' }
        },
      },
      {
        method: 'POST', path: '/api/market/remove',
        about: '删掉一个模块市场（body: {id, yes}）：它在本机的复制品一起删掉，配置里从它装的模块下次启动就没有了',
        handle: async ({ body, caller }) => {
          if (!isHuman(caller.holder)) throw new BoardError('forbidden', '删模块市场要人来做')
          const raw = (body ?? {}) as { id?: unknown, yes?: unknown }
          const id = typeof raw.id === 'string' ? raw.id : ''
          if (!ID.test(id)) throw new BoardError('invalid', `市场名不对：${id}`)
          if (raw.yes !== true) throw new BoardError('invalid', `删掉市场 ${id} 和它在本机的复制品？这会让配置里从它装的模块下次启动就没了。确认请带上 yes`)
          const { records } = readRecords(stateDir)
          if (!records.some(record => record.id === id)) throw new BoardError('invalid', `没有模块市场 ${id}`)
          writeRecords(stateDir, records.filter(record => record.id !== id))
          rmSync(join(stateDir, 'markets', id), { recursive: true, force: true })
          return { removed: id, message: `删了模块市场 ${id}：重启 boardd 后生效` }
        },
      },
    ])
    return { list: () => list(stateDir, ctx.configFile, !!lab.reloader) }
  },
}
