/**
 * The `boardlab` module: host boardds as backends. A hub boardd (one that serves many hosts) lists each host boardd's
 * boards and forwards every request to it; each instance is one host (`instances`), reached at its settings' address.
 */
import type { Module } from 'boardlab'
import { hostLab, type HostOptions } from './driver.ts'

/** `instances` as a configuration states it: one host per name (`{ "boardlab": { "instances": ["lab1"] } }`). */
function instances(settings: Record<string, unknown>, fallback: string): string[] {
  const value = settings.instances ?? [fallback]
  if (!Array.isArray(value) || !value.length || value.some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(id))) {
    throw new Error(`instances 要是实例名的数组，例如 ["${fallback}"]`)
  }
  return value as string[]
}

export function boardlab(options: HostOptions & { instances?: string[] } = {}): Module {
  return {
    id: 'boardlab',
    title: 'boardlab 主机',
    about: '其他 boardd（板卡主机上的 boardlab）：一台一个实例（instances），转发到它们',
    tags: ['backend', 'hub'],
    setup(lab, ctx) {
      // A hub names its hosts in boardd.json, e.g. { "boardlab": { "instances": ["lab1", "lab2"] } }; none by default.
      if (ctx.config.instances !== undefined) options = { ...options, instances: instances(ctx.config, 'lab1') }
      for (const id of options.instances ?? []) lab.backends.register(id, hostLab(options))
    },
  }
}
