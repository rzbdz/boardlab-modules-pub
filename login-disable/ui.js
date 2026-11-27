// login-disable/ui.ts
import { job, notice, stream, text } from "boardlab/ui";
var when = (iso) => new Date(iso).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
var ui = {
  module: "login-disable",
  views(state, context) {
    const board = context.board ? state.boards.find((item) => item.name === context.board) : void 0;
    if (!board) return [];
    const entries = (state.loginDisable ?? []).filter((entry) => entry.board === board.name);
    const last = entries[0];
    const run = (path, label) => job(`login-${path}`, label, async (_input, sink, signal) => {
      const answer = await stream(path, { board: board.name }, sink, signal);
      return answer.message;
    });
    const body = [
      last ? text(last.state === "on" ? `${last.os}\uFF1A\u4E32\u53E3 ${last.device} \u7531 ${last.unit} \u4EE5 ${last.account} \u81EA\u52A8\u767B\u5F55\uFF08${when(last.at)} \u7531 ${last.actor} \u6253\u5F00\uFF09` : `${last.os}\uFF1A\u4E32\u53E3 ${last.device} \u7684\u81EA\u52A8\u767B\u5F55\u5DF2\u7ECF\u8FD8\u539F\uFF08${when(last.endedAt ?? last.at)} \u7531 ${last.actor}\uFF09`) : notice("\u8FD8\u6CA1\u5728\u8FD9\u5757\u677F\u5B50\u4E0A\u770B\u8FC7\u4E32\u53E3\u767B\u5F55\u3002\u70B9\u300C\u68C0\u67E5\u300D\u4F1A\u767B\u5F55\u4E00\u6B21\uFF0C\u770B\u662F\u4EC0\u4E48\u7CFB\u7EDF\u3001\u54EA\u4E2A getty \u5728\u7BA1\u4E32\u53E3\u3002", "neutral"),
      {
        kind: "actions",
        actions: [
          run("api/login-disable/check", "\u68C0\u67E5"),
          run("api/login-disable/apply", last?.state === "on" ? "\u91CD\u5F00" : "\u6539\u6210\u514D\u5BC6"),
          ...last?.state === "on" ? [run("api/login-disable/undo", "\u8FD8\u539F\u6210\u8981\u5BC6\u7801")] : []
        ]
      }
    ];
    return [{ id: "login-disable-board", slot: "board", title: "\u4E32\u53E3\u767B\u5F55", body }];
  }
};
export {
  ui
};
