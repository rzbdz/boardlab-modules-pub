/**
 * The market's own tests: a module's behaviour, and its part of the page, run against the core the market was written
 * for. A module imports `boardlab` (core's SDK) and `boardlab/ui`; its own test may also reach the core directly
 * (`boardlab-core/…`), as the distribution's tests do, to build a lab around the module.
 */
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

const boardlab = resolve(import.meta.dirname, '../better-boardlab')

export default defineConfig({
  resolve: {
    alias: [
      { find: /^boardlab-core\/(.*)$/, replacement: `${resolve(boardlab, 'core/src')}/$1` },
      { find: /^boardlab\/ui$/, replacement: resolve(boardlab, 'src/sdk.browser.ts') },
      { find: /^boardlab$/, replacement: resolve(boardlab, 'core/src/sdk.ts') },
    ],
  },
  test: { include: ['market.test.ts', '*/test.ts', '*/ui.test.ts'], environment: 'node' },
})
