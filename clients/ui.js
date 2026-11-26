// clients/ui.ts
import { call, stream } from "boardlab/ui";
import { action, job, notice, open, text } from "boardlab/ui";
var here = () => typeof location === "undefined" ? "" : location.hostname;
function badge(machine, clients) {
  const s = machine.status;
  if (machine.busy) return { tone: "info", text: "\u6B63\u5728\u88C5" };
  if (s.reachable === null && !s.error) return { tone: "neutral", text: "\u6CA1\u67E5\u8FC7" };
  if (s.reachable === false) return { tone: "error", text: "\u8FDE\u4E0D\u4E0A" };
  if (!s.version) return { tone: "warn", text: "\u6CA1\u88C5" };
  if (s.error) return { tone: "warn", text: "\u6CA1\u8FDE\u4E0A boardd" };
  if (clients.hub.url && s.remote !== clients.hub.url) return { tone: "warn", text: "\u8FDE\u7684\u4E0D\u662F\u8FD9\u53F0" };
  if (clients.release && s.revision !== clients.release.revision) return { tone: "warn", text: `\u65E7\u7248 ${s.version}` };
  return { tone: "ok", text: s.version };
}
function describe(machine) {
  const s = machine.status;
  return [
    `${machine.user}@${machine.address}${machine.sshPort ? `:${machine.sshPort}` : ""}${machine.jump ? `\uFF08\u7ECF ${machine.jump}\uFF09` : ""}`,
    s.version ? `boardlab ${s.version}\uFF08${s.revision}\uFF09` : "",
    s.checkedAt ? `${new Date(s.checkedAt).toLocaleString()} \u67E5\u8FC7` : "",
    s.error ?? ""
  ].filter(Boolean).join(" \xB7 ");
}
function install(clients, machine) {
  const fields = [
    ...machine ? [] : [{ kind: "text", id: "id", label: "\u540D\u5B57\uFF08\u53EF\u9009\uFF09", placeholder: "\u4E0D\u586B\u5C31\u7528\u5730\u5740", pattern: "[A-Za-z0-9][A-Za-z0-9_.\\-]{0,62}" }],
    { kind: "text", id: "address", label: "\u673A\u5668\u5730\u5740", placeholder: "IP\u3001\u57DF\u540D\uFF0C\u6216\u8005 ssh \u914D\u7F6E\u91CC\u7684\u540D\u5B57", required: true, initial: machine?.address },
    { kind: "text", id: "user", label: "\u767B\u5F55\u7528\u6237", placeholder: "\u5728\u90A3\u53F0\u673A\u5668\u4E0A\u7528\u547D\u4EE4\u884C\u7684\u666E\u901A\u7528\u6237\uFF08\u4E0D\u80FD\u662F root\uFF09", required: true, initial: machine?.user },
    { kind: "secret", id: "password", label: "\u5BC6\u7801\uFF08\u53EF\u9009\uFF09", placeholder: "\u4E0D\u586B\uFF1A\u5148\u8BD5 boardd \u81EA\u5DF1\u7684\u5BC6\u94A5\uFF0C\u518D\u8BD5\u8FD9\u53F0\u673A\u5668\u7684 ssh \u8BBE\u7F6E\uFF1B\u586B\u4E86\u53EA\u7528\u4E00\u6B21\uFF0C\u4E4B\u540E\u7528\u5BC6\u94A5" },
    { kind: "text", id: "jump", label: "\u8DF3\u677F\u673A\uFF08\u53EF\u9009\uFF09", placeholder: "user@jumphost", initial: machine?.jump },
    { kind: "text", id: "hub", label: "boardd \u5730\u5740", initial: clients.hub.address ?? here(), required: true, help: `\u90A3\u53F0\u673A\u5668 ssh \u5230\u8FD9\u53F0 boardd \u7528\u7684\u5730\u5740\uFF1B\u5B83\u4EE5 ${clients.hub.tunnel} \u767B\u5F55\uFF0C\u53EA\u80FD\u8F6C\u53D1\u5230 boardd \u7684\u7AEF\u53E3` }
  ];
  return [
    text(machine ? "\u7528\u8FD9\u53F0 boardd \u7684\u7248\u672C\u91CD\u65B0\u88C5\u4E00\u904D\uFF08\u5347\u7EA7\u3001\u4FEE\u597D\uFF09\uFF0C\u518D\u8FDE\u4E00\u6B21\u3002" : "\u65B0\u7684\u5BA2\u6237\u7AEF\uFF1Aboardd \u7528 ssh \u8FC7\u53BB\uFF0C\u7528\u8FD9\u53F0 boardd \u7684\u7248\u672C\u88C5\u597D boardlab \u547D\u4EE4\u884C\uFF08\u88C5\u5728\u90A3\u4E2A\u7528\u6237\u7684 ~/.local \u4E0B\uFF09\uFF0C\u8BBE\u6210\u7ECF ssh \u96A7\u9053\u8FDE\u5230\u8FD9\u53F0 boardd\uFF0C\u6700\u540E\u5728\u90A3\u8FB9\u8DD1\u4E00\u6B21 boardlab status\u3002"),
    {
      kind: "form",
      fields,
      submitLabel: machine ? "\u66F4\u65B0" : "\u6DFB\u52A0\u5E76\u5B89\u88C5",
      submit: job("install", machine ? "\u66F4\u65B0" : "\u6DFB\u52A0\u5E76\u5B89\u88C5", async (input, sink, signal) => (await stream("api/clients/install", {
        id: machine?.id ?? input.id,
        address: input.address,
        user: input.user,
        password: input.password,
        jump: input.jump ?? "",
        hub: input.hub
      }, sink, signal)).message, { intent: "primary" })
    }
  ];
}
function remove(machine) {
  return [
    text(`\u90A3\u53F0\u673A\u5668\u4E0A\u7684\u547D\u4EE4\u884C\u4E0D\u518D\u8FDE\u8FD9\u53F0 boardd\uFF0C\u6536\u56DE\u5B83\u7684\u96A7\u9053\u6388\u6743\uFF0Cboardd \u4E5F\u62FF\u6389\u81EA\u5DF1\u653E\u5728\u90A3\u8FB9\u7684\u5BC6\u94A5\u3002\u8FDE\u4E0D\u4E0A\u90A3\u53F0\u673A\u5668\u65F6\uFF0C\u53EA\u4ECE\u8FD9\u91CC\u5220\u6389\u3002`),
    {
      kind: "form",
      fields: [{ kind: "switch", id: "uninstall", label: "\u4E5F\u5378\u6389\u547D\u4EE4\u884C", initial: false }],
      submitLabel: "\u5220\u9664",
      submit: action("remove", "\u5220\u9664", async (input) => (await call("POST", "api/clients/remove", { id: machine.id, uninstall: input.uninstall === true })).message, { intent: "danger" })
    }
  ];
}
function hubForm(clients) {
  return [
    text("\u5BA2\u6237\u7AEF\u7ECF ssh \u8FDE\u5230\u8FD9\u53F0 boardd\uFF1A\u4EE5\u96A7\u9053\u7528\u6237\u767B\u5F55\u8FD9\u53F0\u673A\u5668\uFF0C\u53EA\u80FD\u8F6C\u53D1\u5230 boardd \u7684\u7AEF\u53E3\u3002\u6539\u4E86\u4EE5\u540E\uFF0C\u66F4\u65B0\u4E00\u4E0B\u5404\u53F0\u673A\u5668\u3002"),
    {
      kind: "form",
      submitLabel: "\u4FDD\u5B58",
      fields: [
        { kind: "text", id: "address", label: "boardd \u5730\u5740", initial: clients.hub.address ?? here(), required: true, help: "\u90A3\u4E9B\u673A\u5668 ssh \u5230\u8FD9\u91CC\u7528\u7684\u5730\u5740\uFF1AIP\u3001\u57DF\u540D" },
        { kind: "text", id: "tunnel", label: "\u96A7\u9053\u7528\u6237", initial: clients.hub.tunnel, required: true, help: "boardd \u4EE5 root \u8FD0\u884C\u65F6\uFF0C\u6CA1\u6709\u8FD9\u4E2A\u7528\u6237\u5C31\u5EFA\u4E00\u4E2A\u53EA\u80FD\u5F00\u96A7\u9053\u7684" },
        { kind: "number", id: "sshPort", label: "ssh \u7AEF\u53E3", initial: clients.hub.sshPort ?? 22, min: 1, max: 65535 }
      ],
      submit: action("save", "\u4FDD\u5B58", async (input) => {
        await call("POST", "api/clients/settings", input);
        return "\u4FDD\u5B58\u4E86";
      }, { intent: "primary" })
    }
  ];
}
var hubUrl = (clients) => clients.hub.url ?? `ssh://${clients.hub.tunnel}@${clients.hub.address ?? (here() || "<\u5730\u5740>")}`;
function clientsContext(clients) {
  return [
    `\u8FD9\u53F0 boardd\uFF1A${clients.release ? `boardlab ${clients.release.version}\uFF08${clients.release.revision}\uFF09` : "\u4ECE\u6E90\u7801\u8DD1\u7684\uFF08\u4E0D\u80FD\u4ECE\u9875\u9762\u7ED9\u522B\u7684\u673A\u5668\u88C5\u547D\u4EE4\u884C\uFF09"}`,
    `\u5BA2\u6237\u7AEF\u8FDE\u8FC7\u6765\u7528\uFF1A${hubUrl(clients)}\uFF08\u96A7\u9053\u7528\u6237 ${clients.hub.tunnel}\uFF0Cssh \u7AEF\u53E3 ${clients.hub.sshPort ?? 22}\uFF09`,
    "\u5DF2\u7ECF\u52A0\u7684\u673A\u5668\uFF1A",
    ...clients.machines.length ? clients.machines.map((machine) => `- ${machine.id}\uFF1A${describe(machine)}\uFF1B${badge(machine, clients).text}`) : ["\uFF08\u8FD8\u6CA1\u6709\uFF09"]
  ].join("\n");
}
var ui = {
  module: "clients",
  views(state) {
    const clients = state.clients;
    if (!clients) return [];
    const noRelease = clients.release ? void 0 : "\u8FD9\u4E2A boardd \u662F\u4ECE\u6E90\u7801\u8DD1\u7684";
    const behind = clients.machines.filter((machine) => badge(machine, clients).tone !== "ok");
    return [{
      id: "cli-machines",
      slot: "settings",
      title: "\u5BA2\u6237\u7AEF\u914D\u7F6E",
      help: "clients",
      order: 15,
      summary: "\u7F16\u8BD1\u670D\u52A1\u5668\u548C\u7B14\u8BB0\u672C\u88C5\u4E0A boardlab \u547D\u4EE4\u884C\uFF0C\u8FDE\u5230\u8FD9\u91CC\u3002",
      hint: {
        commands: [`boardlab remote set ${hubUrl(clients)}`, "boardlab remote show", "boardlab status", "boardlab install"],
        context: () => clientsContext(clients),
        produce: "\u5728\u90A3\u53F0\u673A\u5668\u4E0A\u8981\u8DD1\u7684\u547D\u4EE4\uFF08\u88C5\u547D\u4EE4\u884C\u3001\u8FDE\u5230\u8FD9\u53F0 boardd\u3001\u7ED9 agent \u88C5 skill\uFF09\uFF0C\u6216\u8005\u5728\u9875\u9762\u4E0A\u300C\u6DFB\u52A0\u673A\u5668\u300D\u8981\u586B\u7684\u5185\u5BB9"
      },
      status: clients.machines.length ? { tone: behind.length ? "warn" : "ok", text: `${clients.machines.length} \u53F0` } : void 0,
      body: [
        text("\u7528 boardlab \u547D\u4EE4\u884C\u7684\u673A\u5668\uFF08\u7F16\u8BD1\u670D\u52A1\u5668\u3001\u7B14\u8BB0\u672C\uFF09\u3002boardd \u7528 ssh \u8FC7\u53BB\u88C5\u597D\u547D\u4EE4\u884C\uFF0C\u8BA9\u5B83\u7ECF ssh \u96A7\u9053\u8FDE\u5230\u8FD9\u53F0 boardd\uFF0C\u4EBA\u548C agent \u5C31\u5728\u90A3\u8FB9\u62FF\u677F\u5B50\u3002"),
        {
          kind: "facts",
          items: [
            { label: "\u8FD9\u53F0 boardd", value: clients.release ? `boardlab ${clients.release.version}\uFF08${clients.release.revision}\uFF09` : "\u4ECE\u6E90\u7801\u8DD1\u7684" },
            { label: "\u8FDE\u8FC7\u6765\u7528", value: { code: hubUrl(clients) } }
          ]
        },
        ...clients.release ? [] : [notice("\u8FD9\u4E2A boardd \u662F\u4ECE\u6E90\u7801\u8DD1\u7684\uFF0C\u6CA1\u6709\u53D1\u5E03\u5305\u53EF\u88C5\u3002\u7528 install.sh \u88C5\u7684 boardd \u624D\u80FD\u7ED9\u522B\u7684\u673A\u5668\u88C5\u547D\u4EE4\u884C\uFF1B\u4E5F\u53EF\u4EE5\u5728\u90A3\u53F0\u673A\u5668\u4E0A\u81EA\u5DF1\u8DD1 install.sh\uFF0C\u518D boardlab remote set\u3002")],
        ...clients.machines.length ? [{
          kind: "list",
          items: clients.machines.map((machine) => ({
            key: machine.id,
            title: machine.id,
            description: describe(machine),
            status: badge(machine, clients),
            actions: [
              open("update", "\u66F4\u65B0", `\u66F4\u65B0 ${machine.id}`, () => install(clients, machine), { blocked: noRelease ?? (machine.busy ? "\u6B63\u5728\u88C5" : void 0) }),
              action("check", "\u68C0\u67E5", async () => {
                const now = await call("POST", "api/clients/check", { id: machine.id });
                const found = now.machines.find((item) => item.id === machine.id);
                return found ? `${machine.id}\uFF1A${badge(found, now).text}` : void 0;
              }, { blocked: machine.busy ? "\u6B63\u5728\u88C5" : void 0 }),
              open("remove", "\u5220\u9664", `\u5220\u9664 ${machine.id}`, () => remove(machine), { intent: "danger", blocked: machine.busy ? "\u6B63\u5728\u88C5" : void 0 })
            ]
          }))
        }] : [notice("\u8FD8\u6CA1\u6709\u5BA2\u6237\u7AEF\u3002\u6DFB\u52A0\u4E00\u53F0\uFF1A\u7ED9\u51FA\u5730\u5740\u548C\u90A3\u8FB9\u7684\u7528\u6237\uFF0Cboardd \u4F1A\u88C5\u597D\u547D\u4EE4\u884C\u5E76\u8FDE\u8FC7\u6765\u3002", "neutral")],
        {
          kind: "actions",
          actions: [
            open("add", "\u6DFB\u52A0\u673A\u5668", "\u6DFB\u52A0\u5BA2\u6237\u7AEF", () => install(clients, null), { intent: "primary", blocked: noRelease }),
            open("hub", "\u8FDE\u63A5\u8BBE\u7F6E", "\u5BA2\u6237\u7AEF\u600E\u4E48\u8FDE\u8FC7\u6765", () => hubForm(clients)),
            action("check-all", "\u5168\u90E8\u68C0\u67E5", async () => {
              const now = await call("POST", "api/clients/check", {});
              const ok = now.machines.filter((machine) => badge(machine, now).tone === "ok").length;
              return `\u67E5\u4E86 ${now.machines.length} \u53F0\uFF1A${ok} \u53F0\u662F\u6700\u65B0\u7684`;
            }, { blocked: clients.machines.length ? void 0 : "\u8FD8\u6CA1\u6709\u673A\u5668" })
          ]
        }
      ]
    }];
  }
};
export {
  ui
};
