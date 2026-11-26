// script-slots/ui.ts
import { call } from "boardlab/ui";
import { action, open, text } from "boardlab/ui";
var slotApi = {
  save: (input) => call("POST", "api/slots/script", input),
  remove: (slot) => call("POST", "api/slots/script/remove", { slot })
};
var RESET_EXAMPLE = '#!/bin/bash\n# \u65AD\u7535 3 \u79D2\u518D\u4E0A\u7535\nmiiocli plug --ip 192.168.1.50 --token "$TOKEN" off\nsleep 3\nmiiocli plug --ip 192.168.1.50 --token "$TOKEN" on';
function slotForm(slot, taken) {
  return {
    kind: "form",
    fields: [
      { kind: "number", id: "slot", label: "\u69FD\u4F4D\u53F7", initial: slot?.slot, min: 0, max: 9999, required: true, disabled: !!slot },
      { kind: "text", id: "label", label: "\u540D\u79F0", initial: slot?.label ?? "", placeholder: "\u7C73\u5BB6\u63D2\u5EA7 \xB7 \u5DE5\u4F4D 3" },
      { kind: "code", id: "resetScript", label: "\u590D\u4F4D\u811A\u672C", initial: slot?.resetScript ?? "", placeholder: RESET_EXAMPLE, required: true, rows: 6 },
      { kind: "code", id: "fastbootScript", label: "fastboot \u811A\u672C", initial: slot?.fastbootScript ?? "", placeholder: "\u7559\u7A7A\u8868\u793A\u8FD9\u4E2A\u69FD\u4F4D\u53EA\u80FD\u590D\u4F4D", rows: 3 }
    ],
    submitLabel: slot ? `\u4FDD\u5B58\u69FD\u4F4D ${slot.slot}` : "\u6DFB\u52A0\u69FD\u4F4D",
    submit: action("save", slot ? "\u4FDD\u5B58" : "\u6DFB\u52A0\u69FD\u4F4D", async (input) => {
      const number = slot?.slot ?? Number(input.slot);
      if (!slot && taken.has(number)) throw new Error(`\u69FD\u4F4D ${number} \u5DF2\u5B58\u5728`);
      await slotApi.save({ slot: number, label: String(input.label ?? ""), resetScript: String(input.resetScript ?? ""), fastbootScript: String(input.fastbootScript ?? "") });
      return slot ? "\u5DF2\u4FDD\u5B58" : `\u5DF2\u6DFB\u52A0\u69FD\u4F4D ${number}`;
    }, { intent: "primary" })
  };
}
var ui = {
  module: "script-slots",
  views(state) {
    const scripted = state.slots.filter((slot) => slot.kind === "script");
    const boardIn = (slot) => state.boards.find((board) => board.slot === slot);
    const taken = new Set(state.slots.map((slot) => slot.slot));
    return [{
      id: "script-slots",
      slot: "settings",
      title: "\u81EA\u5B9A\u4E49\u69FD\u4F4D",
      body: [
        text([
          "\u63A7\u5236\u5668\u4EE5\u5916\u7684\u677F\u5B50\u7528\u811A\u672C\u590D\u4F4D\uFF0C\u4F8B\u5982\u8BA9\u7C73\u5BB6\u63D2\u5EA7\u65AD\u7535\u518D\u4E0A\u7535\u3002\u811A\u672C\u5728 boardd \u6240\u5728\u673A\u5668\u4E0A\u4EE5\u5B83\u7684\u7528\u6237\u8EAB\u4EFD\u8FD0\u884C\uFF1A\u9996\u884C\u6709 ",
          { code: "#!" },
          " \u5C31\u7528\u6307\u5B9A\u7684\u89E3\u91CA\u5668\uFF0C\u5426\u5219\u7528 bash\uFF1B\u8D85\u8FC7 2 \u5206\u949F\u4F1A\u88AB\u7EC8\u6B62\uFF0C\u9000\u51FA\u7801\u4E0D\u662F 0 \u7B97\u5931\u8D25\u3002\u811A\u672C\u80FD\u8BFB\u5230 ",
          { code: "BOARDS_SLOT" },
          "\u3001",
          { code: "BOARDS_ACTION" },
          "\uFF08reset \u6216 fastboot\uFF09\u548C ",
          { code: "BOARDS_BOARD" },
          "\u3002fastboot \u811A\u672C\u7559\u7A7A\uFF0C\u8FD9\u4E2A\u69FD\u4F4D\u5C31\u53EA\u80FD\u590D\u4F4D\u3002"
        ]),
        {
          kind: "list",
          empty: "\u8FD8\u6CA1\u6709\u81EA\u5B9A\u4E49\u69FD\u4F4D\u3002",
          items: scripted.map((slot) => ({
            key: String(slot.slot),
            tag: `\u69FD\u4F4D ${slot.slot}`,
            title: slot.label ?? "\u81EA\u5B9A\u4E49\u69FD\u4F4D",
            description: `${slot.canFastboot ? "\u590D\u4F4D \xB7 fastboot" : "\u53EA\u80FD\u590D\u4F4D"}${boardIn(slot.slot) ? ` \xB7 ${boardIn(slot.slot).name}` : ""}`,
            actions: [
              open("edit", "\u7F16\u8F91", `\u7F16\u8F91\u69FD\u4F4D ${slot.slot}`, () => [slotForm(slot, taken)]),
              action("remove", "\u5220\u9664", async () => {
                await slotApi.remove(slot.slot);
                return `\u5DF2\u5220\u9664\u69FD\u4F4D ${slot.slot}`;
              }, {
                intent: "danger",
                blocked: boardIn(slot.slot) ? "\u69FD\u4F4D\u4E0A\u8FD8\u6709\u677F\u5B50" : void 0,
                confirm: { title: `\u5220\u9664\u69FD\u4F4D ${slot.slot}`, body: "\u811A\u672C\u4F1A\u4E00\u8D77\u5220\u9664\u3002", action: "\u5220\u9664" }
              })
            ]
          }))
        },
        { kind: "group", title: "\u6DFB\u52A0\u69FD\u4F4D", body: [slotForm(null, taken)] }
      ]
    }];
  }
};
export {
  ui
};
