// feedback/ui.ts
import { action, call, text } from "boardlab/ui";
var KIND = { bug: "\u7F3A\u9677", api: "\u63A5\u53E3", design: "\u8BBE\u8BA1", feature: "\u529F\u80FD", other: "\u5176\u4ED6" };
var resolve = (id, status) => call("POST", "api/feedback/resolve", { id, status });
var ui = {
  module: "feedback",
  views(state) {
    const inbox = state.feedback;
    const items = inbox?.items ?? [];
    return [{
      id: "feedback",
      slot: "page",
      title: "\u53CD\u9988",
      status: inbox ? { tone: inbox.open ? "info" : "ok", text: inbox.open ? `${inbox.open} \u6761\u5F85\u5904\u7406` : "\u6CA1\u6709\u5F85\u5904\u7406" } : void 0,
      body: [
        text("\u4F7F\u7528\u8FD9\u4E2A boardlab \u7684 AI \u53D1\u73B0\u67B6\u6784\u3001\u63A5\u53E3\u6216\u8BBE\u8BA1\u4E0D\u591F\u7528\u65F6\uFF0C\u53EF\u4EE5\u63D0\u5728\u8FD9\u91CC\uFF08\u547D\u4EE4\u884C boardlab feedback\uFF09\uFF1B\u7EF4\u62A4\u7684\u4EBA\u770B\u5230\u540E\u4FEE\u590D\u6216\u8BF4\u660E\u4E0D\u91C7\u7EB3\uFF0C\u5173\u6389\u5C31\u4E0D\u518D\u5F85\u5904\u7406\u3002"),
        {
          kind: "form",
          submitLabel: "\u63D0\u610F\u89C1",
          fields: [
            { kind: "text", id: "subject", label: "\u6807\u9898", placeholder: "\u4E00\u53E5\u8BDD\u8BF4\u6E05\uFF08\u4E0D\u586B\u5C31\u7528\u7B2C\u4E00\u884C\uFF09" },
            { kind: "choice", id: "kind", label: "\u7C7B\u522B", initial: "api", options: [
              { value: "api", label: "\u63A5\u53E3" },
              { value: "design", label: "\u8BBE\u8BA1" },
              { value: "bug", label: "\u7F3A\u9677" },
              { value: "feature", label: "\u529F\u80FD" },
              { value: "other", label: "\u5176\u4ED6" }
            ] },
            { kind: "code", id: "body", label: "\u54EA\u91CC\u4E0D\u591F\u7528\u3001\u4F60\u9700\u8981\u4EC0\u4E48", required: true, rows: 5, placeholder: "\u6B63\u5728\u505A\u4EC0\u4E48\u3001\u73B0\u5728\u53EA\u80FD\u600E\u4E48\u7ED5\u5F00\u3001\u5E0C\u671B boardlab \u63D0\u4F9B\u4EC0\u4E48" }
          ],
          submit: action("submit", "\u63D0\u610F\u89C1", async (input) => {
            const item = await call("POST", "api/feedback", {
              subject: String(input.subject ?? ""),
              kind: String(input.kind ?? "other"),
              body: String(input.body ?? "")
            });
            return `\u5DF2\u8BB0\u5F55 #${item.id}\uFF1A${item.subject}`;
          }, { intent: "primary" })
        },
        {
          kind: "list",
          empty: "\u6CA1\u6709\u5F85\u5904\u7406\u7684\u610F\u89C1",
          items: items.map((item) => ({
            key: String(item.id),
            title: `#${item.id} ${item.subject}`,
            description: `${KIND[item.kind] ?? item.kind} \xB7 ${item.actor} \xB7 ${new Date(item.at).toLocaleString()}
${item.body}`,
            actions: [
              action(`fixed-${item.id}`, "\u5DF2\u4FEE\u590D", async () => (await resolve(item.id, "fixed")).message, { intent: "primary" }),
              action(`declined-${item.id}`, "\u4E0D\u91C7\u7EB3", async () => (await resolve(item.id, "declined")).message)
            ]
          }))
        }
      ]
    }];
  }
};
export {
  ui
};
