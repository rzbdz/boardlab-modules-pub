import { describe, expect, it } from 'vitest'
import { ui as boardctrlUi } from './boardctrl/ui.ts'
import type { View } from '../better-boardlab/src/ui/contract.ts'

describe('the boardctrl views link their help', () => {
  it('links the existing operational help from the corresponding views', () => {
    const state = { boards: [], labs: [], modules: [] } as never
    expect(boardctrlUi.views(state, {}).map((view: View) => [view.id, view.help])).toContainEqual(['boardctrl-hosts', 'board-hosts'])
  })
})

describe('guidance', () => {
  it('the site view carries the guidance help page', () => {
    const state = { boards: [], labs: [], modules: [] } as never
    const site = boardctrlUi.views(state, {}).find((view: View) => view.id === 'boardctrl-site')
    expect(site?.extra).toEqual({ 'boardctrl.guidanceHelp': 'guidance' })
  })
})
