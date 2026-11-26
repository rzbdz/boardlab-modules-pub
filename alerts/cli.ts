/**
 * `boardlab alerts`: the notification bus. What boardlab wanted a person to know — a board that failed to reset, a
 * board waiting for someone, a line an aging run was watching for — and where those go: the channels (a Feishu group,
 * the page) with the rules that pick which alerts each takes.
 *
 * The channel a group chat receives is set up once (`alerts channel add feishu … <webhook>`); the webhook is a
 * credential, so it is written once and never printed back. A rule makes a channel selective: `--topic failed` for
 * failures only, `--tag aging-1` for one long run only, neither for everything.
 */
import type { RemoteCommand, RemoteCommandGroup } from 'boardlab'

interface Alert { id: number, at: string, topic: string, board: string | null, title: string, body: string, tags: string[], actor: string, delivered: Array<{ channel: string, ok: boolean, detail: string | null }> }
interface Channel { id: string, kind: string, title: string, enabled: boolean, url: string | null, rules: Array<{ topics: string[], tags: string[] }>, last: { at: string, ok: boolean, detail: string | null } | null }
interface Answer { alerts: Alert[], channels: Channel[] }

/** A rule from the flags: `--topic failed,attention --tag aging-1`; no flags is "everything". */
const ruleOf = (flag: (name: string) => string | undefined) => {
  const list = (value: string | undefined) => value ? value.split(',').map(word => word.trim()).filter(Boolean) : []
  return { topics: list(flag('topic')), tags: list(flag('tag')) }
}
const ruleText = (rule: { topics: string[], tags: string[] }) => [rule.topics.length ? `类型 ${rule.topics.join('、')}` : '', rule.tags.length ? `标签 ${rule.tags.join('、')}` : ''].filter(Boolean).join('，') || '全部'

const alerts: RemoteCommand = {
  name: 'alerts', noBoard: true,
  usage: [
    'alerts [list] [--limit N]\t最近的通知，以及装了哪些渠道（boardlab alerts channel 看渠道）',
    'alerts raise <标题> [--topic failed|attention|aging|free|granted|stolen] [--board 板子] [--body 内容] [--tag a,b]\t主动发一条通知，按渠道规则推出去',
    'alerts channel [list]\t有哪些通知渠道、各自的规则和上次投递的结果',
    'alerts channel add <id> <飞书 webhook 地址> [--title 名字] [--topic a,b] [--tag a,b]\t加一个飞书群渠道（webhook 只写不回）',
    'alerts channel test <id>\t给渠道发一条测试消息',
    'alerts channel enable|disable <id>\t开关一个渠道',
    'alerts channel remove <id> --yes\t删掉一个渠道',
  ],
  async run({ args, client, flag, flags, out }) {
    const [action, ...rest] = args
    if (action === 'raise') {
      const title = rest.join(' ').trim()
      if (!title) throw new Error('用法：boardlab alerts raise <标题> [--topic …] [--board 板子] [--body 内容] [--tag a,b]')
      const result = await client.call<{ alert: Alert }>('POST', '/api/alerts', {
        topic: flag('topic') ?? 'attention', title, body: flag('body') ?? '', board: flag('board') ?? null,
        tags: (flag('tag') ?? '').split(',').map(word => word.trim()).filter(Boolean),
      })
      out(result, () => {
        const where = result.alert.delivered.length ? result.alert.delivered.map(item => `${item.channel}${item.ok ? '' : `（失败：${item.detail ?? '?'}）`}`).join('、') : '没有渠道收这条'
        console.log(`已通知 #${result.alert.id}：${result.alert.title} → ${where}`)
      })
      return
    }
    if (action === 'channel') {
      const [sub, id, url] = rest
      if (!sub || sub === 'list') {
        const { channels } = await client.call<Answer>('GET', '/api/alerts?limit=1')
        out(channels, () => {
          if (!channels.length) return console.log('还没有通知渠道：boardlab alerts channel add feishu <飞书 webhook 地址>')
          for (const channel of channels) {
            console.log(`${channel.id}  ${channel.kind}  ${channel.enabled ? '开着' : '关着'}  ${channel.title}`)
            console.log(`  规则：${channel.rules.length ? channel.rules.map(ruleText).join('；') : '全部'}`)
            if (channel.url) console.log(`  地址：${channel.url}`)
            if (channel.last) console.log(`  上次投递：${new Date(channel.last.at).toLocaleString()} ${channel.last.ok ? '成功' : `失败（${channel.last.detail ?? '?'}）`}`)
          }
        })
        return
      }
      if (sub === 'add') {
        if (!id || !url) throw new Error('用法：boardlab alerts channel add <id> <飞书 webhook 地址> [--title 名字] [--topic a,b] [--tag a,b]')
        const rule = ruleOf(flag)
        const result = await client.call<{ channel: Channel }>('POST', '/api/alerts/channels', {
          id, kind: 'feishu', title: flag('title') ?? id, url, rules: rule.topics.length || rule.tags.length ? [rule] : [],
        })
        out(result, () => console.log(`加了渠道 ${result.channel.id}（${result.channel.title}）：规则 ${result.channel.rules.length ? result.channel.rules.map(ruleText).join('；') : '全部'}`))
        return
      }
      if (sub === 'test') {
        if (!id) throw new Error('用法：boardlab alerts channel test <id>')
        const result = await client.call<{ ok: boolean }>('POST', `/api/alerts/channels/${encodeURIComponent(id)}`, { test: true })
        out(result, () => console.log(`${id} 收到了测试消息`))
        return
      }
      if (sub === 'enable' || sub === 'disable') {
        if (!id) throw new Error(`用法：boardlab alerts channel ${sub} <id>`)
        const result = await client.call<{ channel: Channel }>('POST', `/api/alerts/channels/${encodeURIComponent(id)}`, { enabled: sub === 'enable' })
        out(result, () => console.log(`${id} 已经${result.channel.enabled ? '打开' : '关闭'}`))
        return
      }
      if (sub === 'remove') {
        if (!id) throw new Error('用法：boardlab alerts channel remove <id> --yes')
        if (!flags.has('yes')) throw new Error(`删掉渠道 ${id}？确认请加 --yes`)
        const result = await client.call<{ removed: string }>('POST', `/api/alerts/channels/${encodeURIComponent(id)}/remove`, { yes: true })
        out(result, () => console.log(`删了渠道 ${result.removed}`))
        return
      }
      throw new Error(`不认识的用法：boardlab alerts channel ${rest.join(' ')}（boardlab help alerts）`)
    }
    const answer = await client.call<Answer>('GET', `/api/alerts?limit=${Number(flag('limit') ?? 20) || 20}`)
    out(answer, () => {
      if (!answer.alerts.length) return console.log('还没有通知')
      for (const alert of answer.alerts) {
        const board = alert.board ? ` ${alert.board}` : ''
        console.log(`#${alert.id}  ${alert.topic}${board}  ${alert.title}  （${new Date(alert.at).toLocaleString()}，${alert.actor}）`)
        if (alert.body) console.log(`    ${alert.body.replace(/\n/g, '\n    ')}`)
        if (alert.delivered.length) console.log(`    发到：${alert.delivered.map(item => `${item.channel}${item.ok ? '' : '（失败）'}`).join('、')}`)
      }
    })
  },
}

export const commands: RemoteCommandGroup = { id: 'alerts', summary: '通知总线：什么通知了、发到哪些渠道（飞书群、页面），按类型和标签筛', title: '通知', commands: [alerts] }
