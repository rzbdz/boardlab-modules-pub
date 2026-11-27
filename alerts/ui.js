// alerts/ui.ts
import { action, alerts as readBus, call, notice, text, TOPIC_TEXT, TOPICS } from "boardlab/ui";
var TONE = { failed: "error", attention: "warn", aging: "warn", free: "info", granted: "info", stolen: "warn" };
var firstLine = (body) => {
  const lines = body.split("\n").filter((line) => line.trim());
  if (lines.length <= 1) return lines[0]?.trim() ?? "";
  return `${lines[0].trim()}\uFF08\u53E6\u6709 ${lines.length - 1} \u884C\uFF09`;
};
var known = null;
var load = async () => {
  known = await readBus(30);
  return known;
};
void load().catch(() => {
});
var ruleText = (rule) => [rule.topics.length ? rule.topics.map((topic) => TOPIC_TEXT[topic] ?? topic).join("/") : "", rule.tags.length ? `#${rule.tags.join(" #")}` : ""].filter(Boolean).join(" ") || "\u5168\u90E8";
var at = (iso) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
};
var ui = {
  module: "alerts",
  views(state) {
    const data = known;
    const recent = data?.alerts ?? (state.alerts?.recent ?? []);
    const failing = recent.filter((alert) => alert.topic === "failed").length;
    const body = [
      text("\u8981\u4EBA\u77E5\u9053\u7684\u4E8B\u90FD\u8BB0\u5728 boardd \u91CC\uFF1A\u5931\u8D25\u3001\u677F\u5B50\u7B49\u4EBA\u64CD\u4F5C\u3001\u8001\u5316\u76D1\u63A7\u5339\u914D\u3002\u6E20\u9053\u51B3\u5B9A\u8FD9\u4E9B\u4E8B\u63A8\u5230\u54EA\u91CC\u2014\u2014\u63A8\u5230\u4E00\u4E2A\u98DE\u4E66\u7FA4\uFF0C\u4EBA\u4E0D\u5728\u7535\u8111\u524D\u4E5F\u80FD\u6536\u5230\uFF1B\u6D4F\u89C8\u5668\u901A\u77E5\u7531\u9875\u9762\u81EA\u5DF1\u53D1\u3002"),
      ...data ? [] : [text("\u8BFB\u53D6\u4E2D\u2026")],
      ...data?.channels.length ? [] : [
        notice("\u8FD8\u6CA1\u6709\u901A\u77E5\u6E20\u9053\u3002\u52A0\u4E00\u4E2A\u98DE\u4E66\u7FA4\u8981\u5728\u547D\u4EE4\u884C\u91CC\u505A\uFF08webhook \u662F\u51ED\u636E\uFF0C\u53EA\u5728\u52A0\u7684\u65F6\u5019\u5199\u4E00\u6B21\uFF09\uFF1A", "neutral"),
        text([{ code: "boardlab alerts channel add lab <webhook \u5730\u5740> --title \u7FA4\u540D" }])
      ],
      ...(data?.channels ?? []).map((channel) => ({
        kind: "group",
        title: channel.title,
        status: channel.enabled ? channel.last ? { tone: channel.last.ok ? "ok" : "error", text: channel.last.ok ? "\u4E0A\u6B21\u53D1\u9001\u6210\u529F" : "\u4E0A\u6B21\u53D1\u9001\u5931\u8D25" } : { tone: "neutral", text: "\u8FD8\u6CA1\u53D1\u8FC7" } : { tone: "neutral", text: "\u5173\u7740" },
        body: [
          {
            kind: "facts",
            items: [
              { label: "\u7C7B\u578B", value: [{ code: channel.kind }] },
              ...channel.url ? [{ label: "\u5730\u5740", value: [{ code: channel.url }] }] : [],
              { label: "\u89C4\u5219", value: channel.rules.length ? channel.rules.map(ruleText).join("\uFF1B") : "\u5168\u90E8\u901A\u77E5" },
              ...channel.last ? [{ label: "\u4E0A\u6B21", value: `${at(channel.last.at)}${channel.last.ok ? "" : `\uFF0C${channel.last.detail ?? "\u5931\u8D25"}`}`, tone: channel.last.ok ? void 0 : "error" }] : []
            ]
          },
          {
            kind: "form",
            submitLabel: "\u6539\u89C4\u5219",
            note: "\u7C7B\u578B\u548C\u6807\u7B7E\u90FD\u7559\u7A7A\u5C31\u662F\u5168\u90E8\u3002\u586B\u4E86\u7C7B\u578B\u5C31\u53EA\u6536\u8FD9\u4E9B\u7C7B\u578B\uFF1B\u6807\u7B7E\u540C\u4E0A\u3002",
            fields: [
              { kind: "text", id: "topics", label: "\u7C7B\u578B\uFF08\u9017\u53F7\u5206\u5F00\uFF0C\u7559\u7A7A=\u5168\u90E8\uFF09", initial: channel.rules[0]?.topics.join(",") ?? "", placeholder: TOPICS.join(",") },
              { kind: "text", id: "tags", label: "\u6807\u7B7E\uFF08\u9017\u53F7\u5206\u5F00\uFF0C\u7559\u7A7A=\u5168\u90E8\uFF09", initial: channel.rules[0]?.tags.join(",") ?? "", placeholder: "aging-1,board-1" }
            ],
            submit: action(`rules-${channel.id}`, "\u4FDD\u5B58", async (input) => {
              const split = (value) => String(value ?? "").split(",").map((word) => word.trim()).filter(Boolean);
              const topics = split(input.topics), tags = split(input.tags);
              await call("POST", `api/alerts/channels/${encodeURIComponent(channel.id)}`, { rules: topics.length || tags.length ? [{ topics, tags }] : [] });
              await load();
              return "\u89C4\u5219\u5DF2\u4FDD\u5B58";
            }, { intent: "primary" }),
            secondary: [
              ...channel.url ? [action(`test-${channel.id}`, "\u53D1\u6D4B\u8BD5", async () => {
                await call("POST", `api/alerts/channels/${encodeURIComponent(channel.id)}`, { test: true });
                await load();
                return "\u6D4B\u8BD5\u6D88\u606F\u5DF2\u53D1";
              })] : [],
              action(`toggle-${channel.id}`, channel.enabled ? "\u5173\u6389" : "\u6253\u5F00", async () => {
                await call("POST", `api/alerts/channels/${encodeURIComponent(channel.id)}`, { enabled: !channel.enabled });
                await load();
                return channel.enabled ? "\u5DF2\u5173\u6389" : "\u5DF2\u6253\u5F00";
              }),
              action(`remove-${channel.id}`, "\u5220\u6389", async () => {
                await call("POST", `api/alerts/channels/${encodeURIComponent(channel.id)}/remove`, { yes: true });
                await load();
                return "\u5220\u4E86";
              }, { intent: "danger", confirm: { title: `\u5220\u6389\u6E20\u9053 ${channel.title}`, body: "\u4E4B\u540E\u8FD9\u4E9B\u901A\u77E5\u4E0D\u518D\u63A8\u5230\u8FD9\u91CC\uFF0C\u5DF2\u7ECF\u8BB0\u4E0B\u7684\u8FD8\u5728\u3002", action: "\u5220\u6389" } })
            ]
          }
        ]
      })),
      {
        kind: "group",
        title: "\u6700\u8FD1\u7684\u901A\u77E5",
        status: failing ? { tone: "warn", text: `${failing} \u6761\u5931\u8D25` } : void 0,
        body: [{
          kind: "list",
          empty: "\u8FD8\u6CA1\u6709\u901A\u77E5",
          items: recent.map((alert) => ({
            key: String(alert.id),
            title: alert.title,
            description: [firstLine(alert.body), alert.board, `${at(alert.at)} \xB7 ${alert.actor}`, `\u53D1\u5230\uFF1A${alert.delivered.map((item) => `${item.channel}${item.ok ? "" : "\uFF08\u5931\u8D25\uFF09"}`).join("\u3001") || "\u6CA1\u6709\u6E20\u9053"}`].filter(Boolean).join(" \xB7 "),
            tag: TOPIC_TEXT[alert.topic] ?? alert.topic,
            status: { tone: TONE[alert.topic] ?? "info", text: TOPIC_TEXT[alert.topic] ?? alert.topic }
          }))
        }]
      }
    ];
    return [{
      id: "alerts",
      slot: "page",
      title: "\u901A\u77E5",
      help: "alerts/alerts",
      status: data ? { tone: failing ? "warn" : "ok", text: `${data.channels.length} \u4E2A\u6E20\u9053` } : void 0,
      body
    }];
  }
};
export {
  TOPICS,
  TOPIC_TEXT,
  ui
};
