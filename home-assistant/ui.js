// home-assistant/ui.ts
import { call } from "boardlab/ui";
import { action, notice, plain, text } from "boardlab/ui";
var haApi = {
  configure: (url, token) => call("POST", "api/ha", { url, token: token || void 0 }),
  setEnabled: (enabled) => call("POST", "api/ha/enabled", { enabled }),
  test: () => call("POST", "api/ha/test")
};
var verdict = (ha) => `${ha.verifyOk ? "\u8FDE\u63A5\u6B63\u5E38" : "\u8FDE\u63A5\u5931\u8D25"}\uFF1A${ha.verifyMessage ?? ""}`;
var ui = {
  module: "home-assistant",
  views(state) {
    const ha = state.ha;
    if (!ha) return [];
    const slots = state.slots.filter((slot) => slot.kind === "ha").length;
    return [{
      id: "ha",
      slot: "settings",
      title: "Home Assistant",
      status: !ha.enabled ? { tone: "warn", text: "\u672A\u5F00\u542F" } : ha.verifiedAt ? { tone: ha.verifyOk ? "ok" : "error", text: ha.verifyOk ? "\u8FDE\u63A5\u6B63\u5E38" : "\u8FDE\u63A5\u5931\u8D25" } : void 0,
      body: [
        text("\u672C\u673A Home Assistant \u63A7\u5236\u5668\u4E0A\u7684\u590D\u4F4D\u5F00\u5173\u548C fastboot \u6309\u94AE\uFF0C\u5C31\u662F\u672C\u673A\u7684\u69FD\u4F4D\u3002"),
        {
          kind: "actions",
          actions: [
            ha.enabled ? action(
              "disable",
              "\u5173\u95ED",
              async () => {
                await haApi.setEnabled(false);
                return "\u5DF2\u5173\u95ED Home Assistant";
              },
              { confirm: { title: "\u5173\u95ED Home Assistant", body: "\u5173\u95ED\u540E boardd \u4E0D\u518D\u8BFB\u4E5F\u4E0D\u518D\u6309 HA \u63A7\u5236\u5668\uFF0C\u5B83\u7684\u69FD\u4F4D\u4E0D\u663E\u793A\uFF1B\u767B\u8BB0\u5728\u8FD9\u4E9B\u69FD\u4F4D\u4E0A\u7684\u677F\u5B50\u8FD8\u5728\uFF0C\u4F46\u4E0D\u80FD\u590D\u4F4D\u3002", action: "\u5173\u95ED" } }
            ) : action("enable", "\u5F00\u542F", async () => {
              await haApi.setEnabled(true);
              return "\u5DF2\u5F00\u542F Home Assistant";
            }, { intent: "primary" })
          ]
        },
        ...ha.enabled ? [{
          kind: "form",
          fields: [
            { kind: "text", id: "url", label: "\u5730\u5740", initial: ha.url ?? "", placeholder: "http://homeassistant.local:8123", required: true },
            { kind: "secret", id: "token", label: "\u957F\u671F\u8BBF\u95EE\u4EE4\u724C", stored: ha.hasToken, placeholder: ha.hasToken ? "\u5DF2\u4FDD\u5B58\uFF08\u4E0D\u663E\u793A\uFF0C\u7559\u7A7A\u5219\u4E0D\u4FEE\u6539\uFF09" : "\u7C98\u8D34\u4EE4\u724C" }
          ],
          submitLabel: "\u4FDD\u5B58\u5E76\u9A8C\u8BC1",
          submit: action("save", "\u4FDD\u5B58\u5E76\u9A8C\u8BC1", async (input) => {
            const next = await haApi.configure(String(input.url), String(input.token ?? ""));
            return plain(verdict(next));
          }, { intent: "primary" }),
          secondary: [action("test", "\u91CD\u65B0\u9A8C\u8BC1", async () => plain(verdict(await haApi.test())), { blocked: ha.hasToken ? void 0 : "\u8FD8\u6CA1\u6709\u4EE4\u724C" })],
          note: ha.verifiedAt ? [verdict(ha), " \xB7 ", { time: ha.verifiedAt }, ha.verifyOk ? ` \xB7 \u63A7\u5236\u5668 ${slots} \u4E2A\u69FD\u4F4D` : ""] : void 0
        }] : [notice("\u5173\u95ED\u65F6 boardd \u4E0D\u8BFB\u4E5F\u4E0D\u6309 HA \u63A7\u5236\u5668\u3002\u53EA\u7528\u5B9E\u9A8C\u5BA4\uFF08\u4F8B\u5982 boardctrl\uFF09\u65F6\u5173\u6389\u3002", "neutral")]
      ]
    }];
  }
};
export {
  ui
};
