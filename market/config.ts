/**
 * boardd's configuration file, as the market's page changes it: which modules boardd loads, and with what settings.
 *
 * The file is boardd's, and hand-written settings live in it (a module's instances, its binary, its timings). So every
 * change here reads the file as it is, touches only `modules`, and writes it back with the rest as it was; a file that
 * is not a JSON object with an object `modules` is left alone and the change refused, rather than overwritten.
 *
 * A change is what the *next* boardd loads: the page asks for a new worker (see `lab.reloader`) after one that needs it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BoardError } from 'boardlab'

export interface ModulesConfig { path: string, modules: Record<string, Record<string, unknown>>, rest: Record<string, unknown> }

/** The configuration file boardd was started with, or the default one in its state directory. */
const configPath = (stateDir: string, config?: string | null) => config ?? process.env.BOARDLAB_CONFIG ?? join(stateDir, 'boardd.json')

/** The file as it is: its `modules` (empty when it has none) and everything else it holds. */
export function readModulesConfig(stateDir: string, config?: string | null): ModulesConfig {
  const path = configPath(stateDir, config)
  if (!existsSync(path)) return { path, modules: {}, rest: {} }
  let raw: unknown
  try { raw = JSON.parse(readFileSync(path, 'utf8')) }
  catch (error) { throw new BoardError('invalid', `boardd 的配置 ${path} 读不了：${(error as Error).message}`) }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BoardError('invalid', `boardd 的配置 ${path} 不像是 boardd 的配置（要是一个 JSON 对象）`)
  const { modules, ...rest } = raw as Record<string, unknown>
  if (modules === undefined) return { path, modules: {}, rest }
  if (!modules || typeof modules !== 'object' || Array.isArray(modules)
    || Object.values(modules).some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new BoardError('invalid', `boardd 的配置 ${path} 的 modules 要是 {模块名: 设置}`)
  }
  return { path, modules: modules as Record<string, Record<string, unknown>>, rest }
}

/** Write one module's settings (or take it out, with null), keeping every other key of the file as it was. */
export function writeModuleConfig(stateDir: string, config: string | null | undefined, id: string, settings: Record<string, unknown> | null): ModulesConfig {
  const current = readModulesConfig(stateDir, config)
  const modules = { ...current.modules }
  if (settings === null) delete modules[id]
  else modules[id] = settings
  const text = `${JSON.stringify({ ...current.rest, modules }, null, 2)}\n`
  writeFileSync(current.path, text, { mode: existsSync(current.path) ? undefined : 0o600 })
  return { ...current, modules }
}

/** Which modules the file selects. */
export const selected = (config: ModulesConfig): string[] => Object.keys(config.modules)
