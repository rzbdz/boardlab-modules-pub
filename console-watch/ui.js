// console-watch/ui.ts
import { action, call, notice, text } from "boardlab/ui";
var known = null;
var load = async () => {
  known = (await call("GET", "api/console-watch")).watchers;
  return known;
};
void load().catch(() => {
});
var patternText = (pattern) => typeof pattern === "string" ? pattern : pattern.match;
var boardsText = (boards) => boards === "*" ? "\u6240\u6709\u677F\u5B50" : boards.join("\u3001");
var ui = {
  module: "console-watch",
  views(state) {
    const watchers = known ?? (state.consoleWatch ?? []);
    return [{
      id: "console-watch",
      slot: "page",
      title: "\u4E32\u53E3\u76D1\u63A7",
      help: "console-watch/console-watch",
      status: watchers.some((watcher) => watcher.running) ? { tone: "ok", text: `${watchers.filter((watcher) => watcher.running).length} \u4E2A\u5728\u76EF` } : void 0,
      body: [
        text("\u8001\u5316\u3001\u957F\u8DD1\u65F6\uFF0C\u4E00\u4E2A\u76D1\u63A7\u53EF\u4EE5\u540C\u65F6\u76EF\u4F4F\u6240\u6709\u677F\u5B50\uFF08\u6216\u6307\u5B9A\u51E0\u5757\uFF09\u7684\u4E32\u53E3\uFF1A\u547D\u4E2D\u67D0\u4E00\u884C\uFF0C\u6216\u8005\u671F\u5F85\u7684\u90A3\u884C\u957F\u65F6\u95F4\u4E0D\u51FA\u73B0\uFF0C\u5C31\u53D1\u5230\u300C\u901A\u77E5\u300D\u603B\u7EBF\u3002\u76D1\u63A7\u53EA\u770B\u4E0D\u53D1\u3001\u4E0D\u62FF\u9501\u3002"),
        ...watchers.length ? [] : [notice("\u8FD8\u6CA1\u6709\u76D1\u63A7\u3002\u5728\u4E0B\u9762\u52A0\u4E00\u4E2A\uFF0C\u6216\u8005\u7528\u547D\u4EE4\u884C\uFF1A", "neutral"), text([{ code: 'boardlab watch console add aging-1 --boards "*" re:panic' }])],
        {
          kind: "list",
          empty: "\u8FD8\u6CA1\u6709\u76D1\u63A7",
          items: watchers.map((watcher) => ({
            key: watcher.id,
            title: watcher.title,
            description: `${boardsText(watcher.boards)} \xB7 ${watcher.patterns.map(patternText).join("\u3001")} \xB7 ${watcher.mode === "absent" ? `\u7F3A\u884C\u544A\u8B66\uFF08\u9759\u9ED8 ${Math.round(watcher.silentMs / 1e3)} \u79D2\uFF09` : "\u547D\u4E2D\u5373\u544A\u8B66"}${watcher.fired.length ? ` \xB7 \u89E6\u53D1\u8FC7 ${watcher.fired.length} \u6B21\uFF0C\u6700\u8FD1 ${watcher.fired.at(-1).board}` : ""}`,
            tag: watcher.running ? "\u5728\u76EF" : "\u6CA1\u8DD1",
            status: { tone: watcher.running ? "ok" : "neutral", text: watcher.running ? "\u5728\u76EF" : "\u6CA1\u8DD1" },
            actions: [
              action(`${watcher.running ? "stop" : "start"}-${watcher.id}`, watcher.running ? "\u505C\u4E0B" : "\u5F00\u59CB", async () => {
                await call("POST", `api/console-watch/${encodeURIComponent(watcher.id)}/${watcher.running ? "stop" : "start"}`, {});
                await load();
                return watcher.running ? "\u5DF2\u505C\u4E0B" : "\u5F00\u59CB\u76EF\u4E86";
              }, { intent: watcher.running ? "default" : "primary" }),
              action(`remove-${watcher.id}`, "\u5220\u6389", async () => {
                await call("POST", `api/console-watch/${encodeURIComponent(watcher.id)}/remove`, { yes: true });
                await load();
                return "\u5220\u4E86";
              }, { intent: "danger", confirm: { title: `\u5220\u6389\u76D1\u63A7 ${watcher.title}`, body: "\u5B83\u4E0D\u518D\u76EF\u8FD9\u4E9B\u677F\u5B50\uFF1B\u5DF2\u7ECF\u53D1\u51FA\u53BB\u7684\u901A\u77E5\u8FD8\u5728\u3002", action: "\u5220\u6389" } })
            ]
          }))
        },
        {
          kind: "form",
          submitLabel: "\u52A0\u76D1\u63A7",
          note: "\u5339\u914D\u4ECE\u7B2C\u4E00\u884C\u547D\u4E2D\u5C31\u53D1\uFF1B\u4E00\u5757\u677F\u5B50\u4E0A\u540C\u4E00\u6761\u566A\u58F0\u4E94\u79D2\u5185\u53EA\u53D1\u4E00\u6B21\u3002\u7F3A\u884C\u544A\u8B66\u8981\u7684\u662F\u300C\u5065\u5EB7\u7684\u8FD0\u884C\u4F1A\u6253\u7684\u90A3\u4E00\u884C\u300D\uFF0C\u4ECE\u5F00\u59CB\u76EF\u3001\u6216\u8005\u4ECE\u6700\u8FD1\u770B\u5230\u7684\u4EFB\u4F55\u4E00\u884C\u7B97\u8D77\uFF0C\u591A\u5C11\u79D2\u6CA1\u52A8\u9759\u7B97\u6302\u3002",
          fields: [
            { kind: "text", id: "id", label: "\u540D\u5B57", required: true, placeholder: "aging-1", help: "\u4E5F\u80FD\u5F53\u6807\u7B7E\u7528\uFF1A\u6E20\u9053\u89C4\u5219\u91CC\u6309\u5B83\u7B5B" },
            { kind: "text", id: "boards", label: "\u76EF\u54EA\u4E9B\u677F\u5B50\uFF08\u9017\u53F7\u5206\u5F00\uFF0C\u7559\u7A7A=\u6240\u6709\uFF09", placeholder: "board-1,board-2 \u6216\u7559\u7A7A" },
            { kind: "text", id: "patterns", label: "\u5339\u914D\uFF08\u9017\u53F7\u5206\u5F00\uFF1Bre:\u6B63\u5219\u3001str:\u539F\u6587\uFF0C\u6216\u76F4\u63A5\u5199\u6B63\u5219\uFF09", required: true, wide: true, placeholder: "re:panic,str:login:" },
            { kind: "choice", id: "mode", label: "\u4EC0\u4E48\u65F6\u5019\u544A\u8B66", initial: "line", options: [{ value: "line", label: "\u5339\u914D\u5230\u5C31\u544A\u8B66" }, { value: "absent", label: "\u671F\u5F85\u7684\u90A3\u884C\u957F\u65F6\u95F4\u4E0D\u51FA\u73B0\uFF08\u7F3A\u884C\u544A\u8B66\uFF09" }] },
            { kind: "number", id: "silent", label: "\u7F3A\u884C\u591A\u4E45\u7B97\u6302\uFF08\u79D2\uFF09", initial: 600, min: 5 }
          ],
          submit: action("add-watch", "\u52A0\u76D1\u63A7", async (input) => {
            const boards = String(input.boards ?? "").trim();
            await call("POST", "api/console-watch", {
              id: String(input.id),
              title: String(input.id),
              boards: boards ? boards.split(",").map((word) => word.trim()).filter(Boolean) : "*",
              patterns: String(input.patterns).split(",").map((word) => word.trim()).filter(Boolean),
              mode: String(input.mode ?? "line"),
              ...input.silent ? { silentMs: Number(input.silent) * 1e3 } : {}
            });
            await load();
            return "\u52A0\u597D\u4E86";
          }, { intent: "primary" })
        }
      ]
    }];
  }
};
export {
  ui
};
