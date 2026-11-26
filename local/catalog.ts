/**
 * The `local` module, as the market offers it: boards wired to the machine boardd runs on, through serial-mux and this
 * machine's USB and fastboot. A module from a market has no catalog entry, so it reads its settings, its state
 * directory and boardd's timing from its own context.
 */
import { number, type Module, type PluginContext } from 'boardlab'
import { SerialMux, startAlias, stopAlias, stopAll } from '../serial-mux/client.ts'
import { fastbootTool, listSerialAdapters, listUsb } from './hardware.ts'
import { local, type Mux } from './index.ts'
import { DEFAULT_TIMING, type ScanTiming } from './scan.ts'

/** serial-mux on this machine, as the local module uses it. */
function serialMux(): Mux {
  const mux = new SerialMux()
  return {
    open: (alias, token) => mux.open(alias, { token }), gate: (alias, gate) => mux.gate(alias, gate),
    online: alias => mux.daemons().some(daemon => daemon.alias === alias && !!daemon.device),
    stopAll: () => stopAll(mux), start: (adapter, alias) => startAlias(mux, adapter, alias), stop: alias => stopAlias(mux, alias),
    records: () => mux.records().map(record => ({ alias: record.alias, device: record.device })),
  }
}

export const localModule: Module = {
  id: 'local',
  title: '本机板子（槽位、串口、fastboot、扫描）',
  about: '接在本机上的板子：槽位、serial-mux 串口、本机 fastboot、扫描',
  tags: ['lab', 'boards', 'serial'],
  setup(lab, ctx: PluginContext) {
    return local({
      mux: serialMux(),
      hardware: { usb: () => listUsb(), serialAdapters: () => listSerialAdapters(), fastboot: fastbootTool },
      scanTiming: { ...DEFAULT_TIMING, ...(ctx.timing.scan as Partial<ScanTiming> | undefined) },
    }).setup(lab, ctx)
  },
}

/** The id, exported beside it as the market names it. */
export { localModule as local }
