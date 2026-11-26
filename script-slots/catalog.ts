/**
 * The `script-slots` module, as the market offers it: slots driven by scripts. A module from a market has no catalog
 * entry, so its settings — how long a script may run — come from its own context (`ctx.config`).
 */
import { number, type Module, type PluginContext } from 'boardlab'
import { scriptRunner } from '../local/hardware.ts'
import { scriptSlots as scriptSlotsFactory } from './index.ts'

/** The module boardd loads: `script-slots`, with this machine's script runner and the `timeoutMs` its entry is given. */
export const scriptSlots: Module = {
  id: 'script-slots',
  title: '脚本槽位',
  about: '脚本驱动的槽位（需要 local；timeoutMs：一次脚本最多跑多久）',
  requires: ['local'],
  setup(lab, ctx: PluginContext) {
    return scriptSlotsFactory({ runner: scriptRunner, timeoutMs: number(ctx.config, 'timeoutMs') }).setup(lab, ctx)
  },
}
