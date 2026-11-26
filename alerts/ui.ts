/**
 * The alerts module's page: what was raised, and where it went.
 *
 * The bus is boardd's, not a browser's: an alert is recorded whether anyone has the page open, and a channel (a Feishu
 * group) is posted to by boardd. So this page shows the record and the channels' state, and edits the rules that decide
 * which alerts go where. Adding a channel with its webhook is the CLI's job (`boardlab alerts channel add`): the URL is
 * a credential a person pastes once, and the API never gives it back.
 */
import { action, alerts as readBus, call, notice, text, TOPIC_TEXT, TOPICS, type Alert, type AlertsAnswer, type AlertChannel as Channel, type Element, type ModuleUi, type PageState, type View } from 'boardlab/ui'

/** The topics the bus has, and where each goes in a list: the page lists them so a rule can be typed without the CLI. */
export { TOPICS, TOPIC_TEXT }
const TONE: Record<string, 'error' | 'warn' | 'info'> = { failed: 'error', attention: 'warn', aging: 'warn', free: 'info', granted: 'info', stolen: 'warn' }

let known: AlertsAnswer | null = null
/** Read the bus, and keep it for the page to draw while the next read is on its way. */
const load = async () => { known = await readBus(30); return known }
void load().catch(() => {})

const ruleText = (rule: { topics: string[], tags: string[] }) => [rule.topics.length ? rule.topics.map(topic => TOPIC_TEXT[topic as keyof typeof TOPIC_TEXT] ?? topic).join('/') : '', rule.tags.length ? `#${rule.tags.join(' #')}` : ''].filter(Boolean).join(' ') || '全部'
const at = (iso: string) => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? iso : date.toLocaleString() }

export const ui: ModuleUi = {
  module: 'alerts',
  views(state: PageState): View[] {
    const data = known
    const recent = data?.alerts ?? ((state as PageState & { alerts?: { recent: Alert[] } }).alerts?.recent ?? [])
    const failing = recent.filter(alert => alert.topic === 'failed').length
    const body: Element[] = [
      text('要人知道的事都记在 boardd 里：失败、板子等人操作、老化监控匹配。渠道决定这些事推到哪里——推到一个飞书群，人不在电脑前也能收到；浏览器通知由页面自己发。'),
      ...(data ? [] : [text('读取中…')]),
      ...(data?.channels.length ? [] : [notice('还没有通知渠道。加一个飞书群要在命令行里做（webhook 是凭据，只在加的时候写一次）：', 'neutral'),
        text([{ code: 'boardlab alerts channel add lab <webhook 地址> --title 群名' }])]),
      ...(data?.channels ?? []).map(channel => ({
        kind: 'group' as const,
        title: channel.title,
        status: channel.enabled
          ? channel.last ? { tone: channel.last.ok ? 'ok' as const : 'error' as const, text: channel.last.ok ? '上次发送成功' : '上次发送失败' } : { tone: 'neutral' as const, text: '还没发过' }
          : { tone: 'neutral' as const, text: '关着' },
        body: [
          {
            kind: 'facts' as const,
            items: [
              { label: '类型', value: [{ code: channel.kind }] },
              ...(channel.url ? [{ label: '地址', value: [{ code: channel.url }] }] : []),
              { label: '规则', value: channel.rules.length ? channel.rules.map(ruleText).join('；') : '全部通知' },
              ...(channel.last ? [{ label: '上次', value: `${at(channel.last.at)}${channel.last.ok ? '' : `，${channel.last.detail ?? '失败'}`}`, tone: channel.last.ok ? undefined : 'error' as const }] : []),
            ],
          },
          {
            kind: 'form' as const, submitLabel: '改规则',
            note: '类型和标签都留空就是全部。填了类型就只收这些类型；标签同上。',
            fields: [
              { kind: 'text' as const, id: 'topics', label: '类型（逗号分开，留空=全部）', initial: channel.rules[0]?.topics.join(',') ?? '', placeholder: TOPICS.join(',') },
              { kind: 'text' as const, id: 'tags', label: '标签（逗号分开，留空=全部）', initial: channel.rules[0]?.tags.join(',') ?? '', placeholder: 'aging-1,board-1' },
            ],
            submit: action(`rules-${channel.id}`, '保存', async input => {
              const split = (value: unknown) => String(value ?? '').split(',').map(word => word.trim()).filter(Boolean)
              const topics = split(input.topics), tags = split(input.tags)
              await call('POST', `api/alerts/channels/${encodeURIComponent(channel.id)}`, { rules: topics.length || tags.length ? [{ topics, tags }] : [] })
              await load(); return '规则已保存'
            }, { intent: 'primary' }),
            secondary: [
              ...(channel.url ? [action(`test-${channel.id}`, '发测试', async () => { await call('POST', `api/alerts/channels/${encodeURIComponent(channel.id)}`, { test: true }); await load(); return '测试消息已发' })] : []),
              action(`toggle-${channel.id}`, channel.enabled ? '关掉' : '打开', async () => { await call('POST', `api/alerts/channels/${encodeURIComponent(channel.id)}`, { enabled: !channel.enabled }); await load(); return channel.enabled ? '已关掉' : '已打开' }),
              action(`remove-${channel.id}`, '删掉', async () => { await call('POST', `api/alerts/channels/${encodeURIComponent(channel.id)}/remove`, { yes: true }); await load(); return '删了' }, { intent: 'danger', confirm: { title: `删掉渠道 ${channel.title}`, body: '之后这些通知不再推到这里，已经记下的还在。', action: '删掉' } }),
            ],
          },
        ],
      })),
      {
        kind: 'group' as const,
        title: '最近的通知',
        status: failing ? { tone: 'warn' as const, text: `${failing} 条失败` } : undefined,
        body: [{
          kind: 'list' as const, empty: '还没有通知',
          items: recent.map(alert => ({
            key: String(alert.id),
            title: alert.title,
            description: [alert.body, alert.board, `${at(alert.at)} · ${alert.actor}`, `发到：${alert.delivered.map(item => `${item.channel}${item.ok ? '' : '（失败）'}`).join('、') || '没有渠道'}`].filter(Boolean).join(' · '),
            tag: TOPIC_TEXT[alert.topic as keyof typeof TOPIC_TEXT] ?? alert.topic,
            status: { tone: TONE[alert.topic] ?? 'info', text: TOPIC_TEXT[alert.topic as keyof typeof TOPIC_TEXT] ?? alert.topic },
          })),
        }],
      },
    ]
    return [{
      id: 'alerts', slot: 'page', title: '通知', help: 'alerts/alerts',
      status: data ? { tone: failing ? 'warn' : 'ok', text: `${data.channels.length} 个渠道` } : undefined,
      body,
    }]
  },
}
