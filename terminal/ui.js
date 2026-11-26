// terminal/ui.ts
import { custom, text } from "boardlab/ui";
var ui = {
  module: "terminal",
  views: () => [{
    id: "terminals",
    slot: "page",
    title: "\u7EC8\u7AEF",
    body: [custom("terminal.page", { api: "api/terminals" }, [text("\u8FD9\u4E2A\u9875\u9762\u98CE\u683C\u4E0D\u652F\u6301\u7F51\u9875\u7EC8\u7AEF\uFF0C\u6362 Modern \u98CE\u683C\u3002")])]
  }]
};
export {
  ui
};
