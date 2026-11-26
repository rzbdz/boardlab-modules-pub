// human/ui.ts
import { call } from "boardlab/ui";
import { action, text } from "boardlab/ui";
var resolve = (id, status, note) => call("POST", "api/human/resolve", { id, status, ...note ? { note } : {} });
var STATUS_WORD = { open: "\u7B49\u4EBA\u5904\u7406", done: "\u505A\u597D\u4E86", canceled: "\u505A\u4E0D\u4E86" };
var SOURCE_WORD = { ask: "boardlab ask", relay: "\u677F\u5B50\u7B49\u4EBA\u64CD\u4F5C" };
var when = (iso) => new Date(iso).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
var source = (item) => SOURCE_WORD[item.source] ?? item.source;
var past = null;
var readAt = 0;
var reading = false;
function history() {
  if (!reading && Date.now() - readAt > 1e4) {
    reading = true;
    void call("GET", "api/human/requests?status=all&limit=200").then((out) => {
      past = out.items.filter((item) => item.status !== "open");
    }, () => void 0).then(() => {
      reading = false;
      readAt = Date.now();
    });
  }
  return past;
}
var ui = {
  module: "human",
  views(state) {
    const inbox = state.human;
    const items = inbox?.items ?? [];
    const history_now = history();
    return [{
      id: "human",
      slot: "page",
      title: "\u4EBA\u5DE5\u8BF7\u6C42",
      help: "human/human",
      status: inbox ? { tone: inbox.open ? "warn" : "ok", text: inbox.open ? `${inbox.open} \u4EF6\u5728\u7B49\u4EBA` : "\u6CA1\u6709\u7B49\u4EBA" } : void 0,
      body: [
        text("\u9700\u8981\u73B0\u573A\u64CD\u4F5C\u7684\u8BF7\u6C42\uFF08\u63D2\u62D4\u7EBF\u3001\u63A5\u677F\u5B50\u3001\u6309\u6309\u94AE\u3001\u6309\u4F4F BOOT \u518D\u6309 RESET\uFF09\u7531 boardlab ask \u521B\u5EFA\uFF0C\u8BF4\u660E\u64CD\u4F5C\u6B65\u9AA4\u548C\u53EF\u9A8C\u8BC1\u7684\u5B8C\u6210\u6761\u4EF6\uFF1B\u677F\u5B50\u81EA\u5DF1\u505C\u4E0B\u7B49\u4EBA\uFF08\u540E\u7AEF\u62A5\u544A\u300C\u8BF7\u6309 RESET\u300D\uFF09\u4E5F\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC\u3002\u5B8C\u6210\u540E\u70B9\u300C\u6211\u505A\u597D\u4E86\u300D\uFF1B\u65E0\u6CD5\u5B8C\u6210\u65F6\u70B9\u300C\u505A\u4E0D\u4E86\u300D\u5E76\u586B\u5199\u539F\u56E0\u3002\u8BF7\u6C42\u7ED3\u679C\u4F1A\u8FD4\u56DE\u7ED9\u53D1\u8D77\u65B9\uFF0C\u7269\u7406\u64CD\u4F5C\u7684\u7ED3\u679C\u4ECD\u9700\u7531\u53D1\u8D77\u65B9\u9A8C\u8BC1\u3002"),
        {
          kind: "list",
          empty: "\u73B0\u5728\u6CA1\u6709\u9700\u8981\u4EBA\u505A\u7684\u4E8B",
          items: items.map((item) => ({
            key: String(item.id),
            title: `#${item.id} ${item.title}`,
            description: `${item.kind} \xB7 ${item.actor} \xB7 ${when(item.at)} \xB7 \u6765\u81EA${source(item)}${item.body ? `
${item.body}` : ""}`,
            actions: [
              action(`done-${item.id}`, "\u6211\u505A\u597D\u4E86", async () => (await resolve(item.id, "done")).message, { intent: "primary" }),
              action(`cancel-${item.id}`, "\u505A\u4E0D\u4E86", async () => (await resolve(item.id, "canceled", "\u73B0\u573A\u6CA1\u505A")).message)
            ]
          }))
        },
        {
          kind: "group",
          title: "\u5386\u53F2",
          layout: "stack",
          body: history_now === null ? [{ kind: "text", text: "\u6B63\u5728\u8BFB\u5386\u53F2\u2026", tone: "neutral" }] : history_now.length ? [{ kind: "timeline", items: history_now.map((item) => ({ key: String(item.id), at: item.resolvedAt ?? item.at, tag: STATUS_WORD[item.status] ?? item.status, text: [`#${item.id} ${item.title} `, { muted: `\xB7 ${item.kind} \xB7 ${item.actor} \xB7 ${source(item)}` }, ...item.resolution ? [` \xB7 ${item.resolution}`] : []], tone: item.status === "done" ? "ok" : "warn" })) }] : [{ kind: "text", text: "\u8FD8\u6CA1\u6709\u5904\u7406\u8FC7\u7684\u4EBA\u5DE5\u8BF7\u6C42\u3002", tone: "neutral" }]
        }
      ]
    }];
  }
};
export {
  ui
};
