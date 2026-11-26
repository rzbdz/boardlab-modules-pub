// local/ui.ts
import { api, call } from "boardlab/ui";
import { action, job, notice, text } from "boardlab/ui";
import { events } from "boardlab/ui";
var scanApi = {
  start: (slots) => call("POST", "api/scan", { slots, confirmed: true }),
  cancel: (id) => call("POST", "api/scan/cancel", { id }),
  evidence: (id) => call("GET", `api/scan/evidence?id=${encodeURIComponent(id)}`)
};
var STATUS = { running: "\u8FDB\u884C\u4E2D", done: "\u5B8C\u6210", failed: "\u5931\u8D25", cancelled: "\u5DF2\u53D6\u6D88" };
var TONE = { running: "mine", done: "ok", failed: "error", cancelled: "warn" };
var shortLink = (link) => {
  const port = link.match(/-usb-\d+:([\d.]+):/)?.[1];
  return port ? `USB ${port}` : link.split("/").at(-1);
};
var shortenLinks = (value) => value.replace(/\/dev\/serial\/by-path\/\S+/g, (link) => shortLink(link));
var who = (holder) => holder.startsWith("user:") ? holder.slice(5) : holder;
function result(rows) {
  if (!rows.length) return [];
  return [{
    kind: "table",
    columns: [{ key: "slot", title: "\u69FD\u4F4D", width: "narrow" }, { key: "product", title: "\u578B\u53F7" }, { key: "serial", title: "\u4E32\u53E3" }, { key: "usb", title: "\u4E0B\u8F7D\u53E3" }, { key: "note", title: "\u8BF4\u660E", width: "wide" }],
    rows: rows.flatMap((row) => (row.chips.length ? row.chips : [null]).map((chip, index) => ({
      key: `${row.slot}-${chip?.die ?? index}`,
      tone: row.flags.length ? "warn" : void 0,
      cells: {
        slot: index ? "" : String(row.slot),
        product: chip?.product ?? (chip ? "\u578B\u53F7\u672A\u77E5" : "\u6CA1\u6709\u53D1\u73B0\u677F\u5B50"),
        serial: chip?.serialPath ? { code: shortLink(chip.serialPath) } : "\u2014",
        usb: chip?.downloadUsbPath ? { code: chip.downloadUsbPath } : "\u2014",
        note: index ? "" : [row.board ? `\u5DF2\u767B\u8BB0\u4E3A ${row.board}` : "", ...row.flags.map((flag) => ` ${flag}`)].join("").trim() || ""
      }
    })))
  }];
}
function follow(id, scope, sink, signal) {
  return new Promise((resolve, reject) => {
    let seen = 0, ended = false, reading = false;
    const check = async () => {
      if (ended || reading) return;
      reading = true;
      try {
        const scan = (await api.state()).scan;
        if (!scan || scan.id !== id) return;
        for (const step of scan.steps.slice(seen)) sink.line(`${step.slot !== null ? `\u69FD\u4F4D ${step.slot} \xB7 ` : ""}${shortenLinks(step.summary)}`);
        seen = scan.steps.length;
        const ran = new Set(scan.steps.map((step) => step.slot).filter((slot) => slot !== null)).size;
        sink.progress(Math.min(0.99, ran / Math.max(1, scope.length)));
        if (scan.status !== "running") {
          ending();
          resolve(scan);
        }
      } catch (error) {
        ending();
        reject(error);
      } finally {
        reading = false;
      }
    };
    const stop = events().listen({ names: ["scan", "changed"], event: (name) => {
      if (name === "scan" || name === "changed") void check();
    }, back: () => void check() });
    const tick = window.setInterval(() => void check(), 5e3);
    const ending = () => {
      if (ended) return;
      ended = true;
      stop();
      window.clearInterval(tick);
    };
    signal.addEventListener("abort", () => {
      ending();
      scanApi.cancel(id).then(() => reject(new Error("\u5DF2\u53D6\u6D88\u626B\u63CF\uFF1A\u6B63\u5728\u505A\u7684\u90A3\u4E2A\u69FD\u4F4D\u505A\u5B8C\u5C31\u505C")), reject);
    }, { once: true });
    void check();
  });
}
var ui = {
  module: "local",
  views(state) {
    const views = [];
    const scan = state.scan;
    const running = scan?.status === "running";
    const boardIn = (slot) => state.boards.find((board) => board.slot === slot);
    const held = state.boards.filter((board) => !!board.lease);
    const minor = state.firmware.find((item) => item.soc === "k3" && item.purpose === "minor-board-info");
    if (state.slots.length) {
      views.push({
        id: "scan",
        slot: "scan",
        title: "\u626B\u63CF\u672C\u673A\u69FD\u4F4D",
        body: [
          text("\u9010\u4E2A\u69FD\u4F4D\u6309 fastboot\uFF0C\u8BB0\u5F55\u54CD\u5E94\u7684\u4E32\u53E3\u548C\u65B0\u51FA\u73B0\u7684\u4E0B\u8F7D\u53E3\uFF1BK3 \u677F\u5B50\u5F80\u5185\u5B58\u52A0\u8F7D minor-board-info \u8BFB\u578B\u53F7\uFF0C\u6700\u540E\u590D\u4F4D\u6062\u590D\u6B63\u5E38\u542F\u52A8\u3002\u53EA\u80FD\u590D\u4F4D\u7684\u69FD\u4F4D\u6539\u6309\u590D\u4F4D\uFF0C\u9760\u542F\u52A8\u8F93\u51FA\u8BA4\u4E32\u53E3\u3002\u4E0D\u70E7\u5F55\u3001\u4E0D\u64E6\u9664\u3001\u4E0D\u6539\u677F\u4E0A\u914D\u7F6E\u3002"),
          ...!minor ? [notice("boardd \u6CA1\u6709\u81EA\u5E26 K3 \u7684 minor-board-info \u56FA\u4EF6\uFF0C\u53EA\u80FD\u5BF9\u5E94\u4E32\u53E3\u548C\u4E0B\u8F7D\u53E3\uFF0C\u8BFB\u4E0D\u5230\u578B\u53F7\u3002")] : [],
          ...held.length ? [notice(`${held.map((board) => `${board.name} \u6B63\u88AB ${who(board.lease.holder)} \u4F7F\u7528`).join("\uFF1B")}\u3002\u6709\u677F\u5B50\u88AB\u62FF\u7740\u9501\u65F6\u4E0D\u80FD\u626B\u63CF\u3002`)] : [],
          {
            kind: "select-many",
            id: "slots",
            label: "\u626B\u63CF\u8303\u56F4",
            disabled: running,
            initial: state.slots.map((slot) => String(slot.slot)),
            options: state.slots.map((slot) => ({ value: String(slot.slot), label: `\u69FD\u4F4D ${slot.slot}`, note: `${boardIn(slot.slot)?.name ?? "\u7A7A"}${slot.canFastboot ? "" : " \xB7 \u53EA\u80FD\u590D\u4F4D"}` }))
          },
          {
            kind: "actions",
            actions: running ? [
              action("cancel", "\u53D6\u6D88\u626B\u63CF", async () => {
                await scanApi.cancel(scan.id);
                return "\u5DF2\u8BF7\u6C42\u53D6\u6D88";
              }, { intent: "danger" })
            ] : [
              job("scan", "\u5F00\u59CB\u626B\u63CF", async (input, sink, signal) => {
                const slots = (input.slots ?? []).map(Number);
                if (!slots.length) throw new Error("\u5148\u9009\u8981\u626B\u63CF\u7684\u69FD\u4F4D");
                const started = await scanApi.start(slots);
                sink.line(`\u9501\u4F4F\u69FD\u4F4D ${slots.join("\u3001")}\uFF0C\u5F00\u59CB\u626B\u63CF`);
                const end = await follow(started.id, slots, sink, signal);
                const found = end.result.filter((row) => row.chips.length).length;
                if (end.status !== "done") throw new Error(end.message ?? `\u626B\u63CF${STATUS[end.status]}`);
                return { message: `\u626B\u63CF\u5B8C\u6210\uFF1A${found} \u4E2A\u69FD\u4F4D\u6709\u677F\u5B50\uFF0C\u6539\u52A8\u5EFA\u8BAE\u89C1\u4E0B\u65B9`, data: end };
              }, {
                intent: "primary",
                using: ["slots"],
                blocked: held.length ? "\u6709\u677F\u5B50\u88AB\u62FF\u7740\u9501" : void 0,
                cancellable: true,
                confirm: { title: "\u5F00\u59CB\u626B\u63CF", action: "\u5F00\u59CB\u626B\u63CF", body: "\u4F1A\u9501\u4F4F\u9009\u4E2D\u7684\u69FD\u4F4D\uFF0C\u505C\u6389\u6240\u6709 serial-mux \u5B88\u62A4\u8FDB\u7A0B\uFF0C\u9010\u4E2A\u5207\u6362\u5230 fastboot\u3001\u52A0\u8F7D\u8BCA\u65AD\u955C\u50CF\uFF0C\u7ED3\u675F\u540E\u590D\u4F4D\u3002\u626B\u63CF\u671F\u95F4\u522B\u4EBA\u4E0D\u80FD\u4F7F\u7528\u8FD9\u4E9B\u677F\u5B50\u3002" }
              })
            ]
          }
        ]
      });
    }
    views.push({
      id: "scan-result",
      slot: "scan-result",
      title: scan ? "\u6700\u8FD1\u4E00\u6B21\u626B\u63CF" : "\u626B\u63CF\u7ED3\u679C",
      status: scan ? { tone: TONE[scan.status], text: STATUS[scan.status] } : void 0,
      body: scan ? [
        ...scan.message ? [notice(scan.message)] : [],
        { kind: "timeline", items: scan.steps.map((step) => ({ key: String(step.seq), at: step.at, tag: step.slot !== null ? String(step.slot) : void 0, text: shortenLinks(step.summary) })) },
        ...result(scan.result),
        ...!running ? [{
          kind: "details",
          summary: "\u539F\u59CB\u8BC1\u636E",
          load: async () => (await scanApi.evidence(scan.id)).map((item) => ({
            kind: "group",
            title: `${item.slot !== null ? `\u69FD\u4F4D ${item.slot} \xB7 ` : ""}${shortenLinks(item.label)}`,
            body: [text({ code: item.body || "\uFF08\u7A7A\uFF09" })]
          }))
        }] : []
      ] : [text("\u8FD8\u6CA1\u6709\u626B\u63CF\u8FC7\u3002", "neutral")]
    });
    const scans = state.history?.scans ?? [];
    if (state.history) {
      views.push({
        id: "scans",
        slot: "history",
        title: "\u626B\u63CF\u8BB0\u5F55",
        body: [{
          kind: "list",
          empty: "\u8FD8\u6CA1\u6709\u626B\u63CF\u8FC7\u3002",
          items: scans.map((item) => ({
            key: item.id,
            title: `\u69FD\u4F4D ${item.scope.join("\u3001")}`,
            description: [{ time: item.startedAt }, ` \xB7 ${who(item.holder)}`],
            status: { tone: TONE[item.status], text: STATUS[item.status] }
          }))
        }]
      });
    }
    return views;
  }
};
export {
  ui
};
