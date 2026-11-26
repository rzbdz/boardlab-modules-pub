/**
 * The `boardctrl` module, as the market offers it: boardctrl board hosts and the SDK, through the boardctrl CLI.
 *
 * A module from a market has no catalog entry, so what an entry was made with comes from its own context: the release
 * it runs in (where the boardctrl CLI and its tree ship), boardd's state directory, and its settings.
 */
import { instances, text, type Module, type PluginContext } from 'boardlab'
import { boardctrl } from './index.ts'

export const boardctrlModule: Module = {
  id: 'boardctrl',
  title: 'boardctrl 板卡主机',
  about: 'boardctrl 板卡主机和 SDK（instances；bin：boardctrl 命令行）',
  tags: ['lab', 'boards', 'boardctrl', 'sdk'],
  // The ids this module had before: a lab someone added as `bsp` keeps working.
  was: ['bsp'],
  setup(lab, ctx: PluginContext) {
    const settings = ctx.config
    return boardctrl({
      bin: text(settings, 'bin') ?? process.env.BOARDS_BOARDCTRL ?? ctx.shipped('externals/boardctrl/bin/boardctrl')
        ?? ctx.shipped('externals/boardctrl/bin/bsp') ?? undefined,
      stateDir: ctx.stateDir, instances: settings.instances === undefined ? [] : instances(settings, 'boardctrl'),
      tree: ctx.shipped('externals/boardctrl/deploy/install.sh')?.replace(/\/deploy\/install\.sh$/, '') ?? null,
    }).setup(lab, ctx)
  },
}
