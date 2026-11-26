/**
 * The human page: what it read once it is drawn from a later state, so a refresh (every event makes one) does not go
 * back to "reading" and read again.
 */
import { describe, expect, it, vi } from 'vitest'
import type { View } from 'boardlab/ui'

describe('the human page keeps its history while the page refreshes', () => {
  const historyOf = (view: View | undefined) => view?.body.find(element => element.kind === 'group' && element.title === '历史')
  it('shows the history it already read on the next state, and reads it once', async () => {
    const asked: string[] = []
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      asked.push(String(url))
      return Response.json({ open: 0, items: [{ id: 7, at: '2026-11-25T10:00:00Z', actor: 'claude:a', kind: 'plug', title: '拔线', body: '', status: 'done', resolution: '拔好了', resolvedAt: '2026-11-25T10:05:00Z', resolvedBy: 'user:dana', subject: null, source: 'ask' }] })
    }))
    vi.resetModules()
    const { ui } = await import('./ui.ts')
    const page = () => ({ boards: [], labs: [], modules: [], human: { open: 0, items: [] } } as never)
    const view = () => historyOf(ui.views(page(), {}).find((item: View) => item.id === 'human'))
    expect(view()).toMatchObject({ body: [{ kind: 'text', text: '正在读历史…' }] })
    await new Promise(done => setTimeout(done, 20))
    expect(view()).toMatchObject({ body: [{ kind: 'timeline', items: [{ tag: '做好了' }] }] })
    // A later state draws the same list from what was read, and does not ask again.
    expect(view()).toMatchObject({ body: [{ kind: 'timeline' }] })
    expect(asked.filter(url => url.includes('api/human/requests')).length).toBe(1)
    vi.unstubAllGlobals()
  })
})
