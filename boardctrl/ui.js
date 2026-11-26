// boardctrl/ui.ts
import { call, stream } from "boardlab/ui";
import { action, job, notice, open, text } from "boardlab/ui";
var ACCESS = [
  { kind: "text", id: "address", label: "\u4E3B\u673A\u5730\u5740", placeholder: "IP\u3001\u57DF\u540D\u3001ssh \u914D\u7F6E\u91CC\u7684\u540D\u5B57\uFF0C\u6216 localhost\uFF08\u5C31\u662F\u8FD9\u53F0\uFF09", required: true },
  { kind: "text", id: "user", label: "\u767B\u5F55\u7528\u6237", placeholder: "\u9ED8\u8BA4 root\uFF08\u8981\u80FD\u88C5\u7CFB\u7EDF\u670D\u52A1\uFF09", initial: "root" },
  { kind: "secret", id: "password", label: "\u5BC6\u7801\uFF08\u53EF\u9009\uFF09", placeholder: "\u4E0D\u586B\uFF1A\u5148\u8BD5 boardd \u81EA\u5DF1\u7684\u5BC6\u94A5\uFF0C\u518D\u8BD5\u8FD9\u53F0\u673A\u5668\u7684 ssh \u8BBE\u7F6E\uFF1B\u586B\u4E86\u53EA\u7528\u4E00\u6B21\uFF0C\u4E4B\u540E\u7528\u5BC6\u94A5" },
  { kind: "text", id: "jump", label: "\u8DF3\u677F\u673A\uFF08\u53EF\u9009\uFF09", placeholder: "user@jumphost" },
  { kind: "choice", id: "board", label: "\u4E3B\u673A\u578B\u53F7\uFF08\u51B3\u5B9A GPIO \u6392\u9488\u56FE\u548C\u590D\u4F4D\u7EBF\uFF09", initial: "auto", options: [] }
];
function install(lab) {
  const host = lab?.url?.match(/^(?:boardctrld|bspd)\+http:\/\/127\.0\.0\.1/) ? "root@localhost" : lab?.url?.replace(/^(?:boardctrld|bspd)\+ssh:\/\//, "") ?? "";
  const [user, address] = host.includes("@") ? host.split("@") : ["root", host];
  return [
    text(lab ? `\u91CD\u65B0\u88C5\u4E00\u904D\uFF08\u5347\u7EA7\u3001\u4FEE\u597D\uFF09\uFF0C\u6216\u8005\u6362\u4E00\u53F0\u673A\u5668\u3002` : "\u65B0\u7684\u677F\u5361\u4E3B\u673A\uFF1Aboardd \u7528 ssh \u8FC7\u53BB\uFF0C\u88C5\u597D boardctrld\uFF08Python \u670D\u52A1\uFF0C\u7BA1\u8FD9\u53F0\u673A\u5668\u7684\u590D\u4F4D\u7EBF\u3001\u4E32\u53E3\u548C\u4E0B\u8F7D\u53E3\uFF09\uFF0C\u63A5\u5165\u6210\u4E00\u4E2A\u5B9E\u9A8C\u5BA4\u3002"),
    {
      kind: "form",
      fields: [
        ...lab ? [] : [{ kind: "text", id: "id", label: "\u5B9E\u9A8C\u5BA4\u540D", placeholder: "\u4F8B\u5982 com260\uFF08\u5B57\u6BCD\u3001\u6570\u5B57\u3001\u6A2A\u7EBF\uFF09", required: true, pattern: "[A-Za-z0-9][A-Za-z0-9_-]{0,31}" }],
        ...ACCESS.map((field) => field.id === "address" ? { ...field, initial: address.replace(/:\d+$/, "") } : field.id === "user" ? { ...field, initial: user || "root" } : field.id === "board" ? { ...field, options: modelOptions() } : field),
        // A lab already running without a token keeps running without one when it is installed again.
        { kind: "switch", id: "noToken", label: "\u4E0D\u8981 token\uFF08\u4E3B\u673A\u63A5\u53D7\u6240\u6709\u8BF7\u6C42\uFF0C\u53EA\u5728\u53EF\u4FE1\u7F51\u7EDC\u91CC\u7528\uFF09", initial: lab ? !lab.hasPassword : false },
        // Off by default: the installer waits for the host's running jobs and refuses when they outlast its wait.
        ...lab ? [{ kind: "switch", id: "force", label: "\u4E0D\u7B49\u4E3B\u673A\u4E0A\u6B63\u5728\u8DD1\u7684\u4EFB\u52A1\uFF08\u5237\u673A\u3001\u542F\u52A8\u4F1A\u88AB\u4E2D\u65AD\uFF09", initial: false }] : []
      ],
      submitLabel: lab ? "\u91CD\u65B0\u5B89\u88C5" : "\u6DFB\u52A0\u5E76\u5B89\u88C5",
      submit: job("install", lab ? "\u91CD\u65B0\u5B89\u88C5" : "\u6DFB\u52A0\u5E76\u5B89\u88C5", async (input, sink, signal) => {
        const id = lab?.id ?? String(input.id).trim();
        if (!lab) {
          sink.line(`\u6DFB\u52A0\u5B9E\u9A8C\u5BA4 ${id}\u2026`);
          await call("POST", "api/labs/add", { id, kind: "boardctrl" });
        }
        try {
          const done = await stream("api/boardctrl/install", { id, address: input.address, user: input.user, password: input.password, jump: input.jump, board: input.board, noToken: input.noToken === true, force: input.force === true }, sink, signal);
          return done.message;
        } catch (error) {
          if (!lab && !signal.aborted) await call("POST", "api/labs/remove", { id }).catch(() => {
          });
          throw error;
        }
      }, { intent: "primary" })
    }
  ];
}
function gpioLink(_url, lab) {
  return `api/boardctrl/hosts/${encodeURIComponent(lab)}/panel/`;
}
var boardChoices = /* @__PURE__ */ new Map();
var boardAsking = /* @__PURE__ */ new Map();
function readBoardChoices(board) {
  const asking2 = boardAsking.get(board);
  if (asking2) return asking2;
  const ask = call("GET", `api/boardctrl/board?board=${encodeURIComponent(board)}`);
  boardAsking.set(board, ask);
  return ask.then((current) => {
    boardChoices.set(board, current);
    return current;
  }).finally(() => {
    if (boardAsking.get(board) === ask) boardAsking.delete(board);
  });
}
function boardForm(board, current) {
  boardChoices.set(board, current);
  const option = (value, label) => value ? [{ value, label }] : [];
  const withCurrent = (options, value) => options.some((item) => item.value === value) || !value ? options : [...options, { value, label: `${value}\uFF08\u5F53\u524D\u767B\u8BB0\uFF0C\u672A\u5728\u626B\u63CF\u4E2D\uFF09` }];
  const gpios = withCurrent(current.gpios, current.control.reset?.pin);
  const fdlGpios = withCurrent(gpios, current.control.fdl?.pin);
  const ports = withCurrent(current.ports, current.usb ?? void 0);
  const currentFdl = current.control.fdl?.strategy ?? "unset";
  return [
    text("\u6539\u767B\u8BB0\uFF08\u4FDD\u5B58\u65F6\u68C0\u67E5\u4F60\u6301\u6709\u8FD9\u5757\u677F\u5B50\u7684\u9501\uFF09\u3002GPIO \u548C\u4E0B\u8F7D\u53E3\u6765\u81EA\u4E3B\u673A\u7684\u5B9E\u9645\u5217\u8868\uFF1Bhuman \u8868\u793A\u7531\u4EBA\u5B8C\u6210\u8BE5\u52A8\u4F5C\u3002SoC \u548C SDK \u51B3\u5B9A\u8FD9\u5757\u677F\u5B50\u80FD\u7528\u54EA\u4E9B\u542F\u52A8/\u5237\u673A\u914D\u65B9\u3002"),
    { kind: "select-many", id: "sdks", label: "SDK\uFF08\u4E0D\u9009 = \u8FD9\u4E2A SoC \u7684\u5168\u90E8\uFF09", options: current.sdkOptions, initial: current.sdks },
    {
      kind: "form",
      fields: [
        { kind: "choice", id: "soc", label: "SoC", initial: current.soc ?? "", options: [
          { value: "", label: "\u4E0D\u6539 / \u4E0D\u77E5\u9053" },
          ...current.socs
        ] },
        { kind: "choice", id: "resetPin", label: "reset GPIO", initial: current.control.reset?.pin ?? "", options: [
          { value: "", label: "\u4E0D\u6539 / \u4E0D\u4F7F\u7528" },
          ...gpios
        ] },
        { kind: "choice", id: "fdl", label: "\u600E\u4E48\u8FDB\u4E0B\u8F7D\u6A21\u5F0F", initial: currentFdl, options: [
          { value: "unset", label: "\u8FD8\u4E0D\u77E5\u9053" },
          { value: "button", label: "\u6309 BOOT + RESET" },
          { value: "strapped", label: "\u590D\u4F4D\u5C31\u8FDB\u4E0B\u8F7D\u6A21\u5F0F" }
        ] },
        { kind: "choice", id: "fdlPin", label: "FDL GPIO", initial: current.control.fdl?.pin ?? "", options: [
          { value: "", label: "\u4E0D\u6539 / \u4E0D\u4F7F\u7528" },
          ...fdlGpios
        ] },
        { kind: "choice", id: "usb", label: "\u4E0B\u8F7D\u53E3", initial: current.usb ?? "", options: [
          { value: "", label: "\u4E0D\u6539" },
          ...ports
        ] }
      ],
      submitLabel: "\u4FDD\u5B58",
      submit: action("save", "\u4FDD\u5B58", async (input) => {
        const changed = { board };
        const sdks = input.sdks;
        if (sdks !== void 0 && sdks.join("\0") !== (current.sdks ?? []).join("\0")) changed.sdks = sdks;
        if (typeof input.usb === "string" && input.usb && input.usb !== current.usb) changed.usb = input.usb;
        if (typeof input.soc === "string" && input.soc && input.soc !== current.soc) changed.soc = input.soc;
        if (typeof input.resetPin === "string" && input.resetPin && input.resetPin !== current.control.reset?.pin) changed.resetPin = input.resetPin;
        if (typeof input.fdlPin === "string" && input.fdlPin && input.fdlPin !== current.control.fdl?.pin) changed.fdlPin = input.fdlPin;
        if (typeof input.fdl === "string" && input.fdl && input.fdl !== currentFdl) changed.fdl = input.fdl;
        if (Object.keys(changed).length === 1) return "\u6CA1\u6709\u6539\u52A8";
        return (await call("POST", "api/boardctrl/board", changed)).message;
      }, { intent: "primary", using: ["sdks"] })
    }
  ];
}
function openBoardForm(board) {
  const cached = boardChoices.get(board);
  return open("edit", "\u6539\u767B\u8BB0\u2026", `${board.toUpperCase()} \u7684 boardctrl \u767B\u8BB0`, () => cached ? boardForm(board, cached) : [], {
    load: () => readBoardChoices(board).then((current) => boardForm(board, current))
  });
}
var hostModels = [];
void call("GET", "api/boardctrl/boards").then((got) => {
  if (Array.isArray(got?.boards)) hostModels = got.boards;
}).catch(() => {
});
var modelOptions = () => [
  { value: "auto", label: "\u81EA\u52A8\u8BC6\u522B\uFF08\u4ECE\u8BBE\u5907\u6811\uFF09" },
  ...hostModels.map((item) => ({ value: item.id, label: `${item.name}\uFF08${item.id}\uFF09` })),
  { value: "none", label: "\u6CA1\u6709 GPIO\uFF08\u53EA\u9760\u4EBA\u5DE5\u590D\u4F4D\uFF09" }
];
var site = null;
var siteError = null;
var loadedAt = 0;
var loadSite = async () => {
  loadedAt = Date.now();
  try {
    const got = await call("GET", "api/boardctrl/site");
    if (!got || !Array.isArray(got.docs) || !got.hosts) {
      site = null;
      siteError = "\u8FD9\u4E2A boardd \u4E0D\u7BA1\u7AD9\u70B9";
    } else {
      site = got;
      siteError = null;
    }
  } catch (error) {
    siteError = error.message;
  }
  return site;
};
void loadSite();
var change = async (path, body, say) => {
  try {
    return say(await call("POST", path, body));
  } finally {
    await loadSite();
  }
};
function hostSite(id) {
  const had = site?.hosts[id];
  if (!had) return site?.ready ? " \xB7 \u7AD9\u70B9\uFF1A\u8FD8\u6CA1\u540C\u6B65" : "";
  return ` \xB7 \u7AD9\u70B9 ${had.revision || "\u65E0"}${had.ok ? "" : `\uFF08\u4E0A\u6B21\u540C\u6B65\u5931\u8D25\uFF1A${had.message.slice(0, 60)}\uFF09`}${had.revision && had.revision !== site?.revision ? "\uFF0C\u4E0D\u662F\u6700\u65B0" : ""}`;
}
var KIND_NAME = { instances: "SDK", servers: "\u7F16\u8BD1\u670D\u52A1\u5668", workspaces: "\u6E90\u7801\u6811", families: "\u7F16\u8BD1\u65B9\u5F0F" };
var KIND_CLI = { instances: "sdk", servers: "server", workspaces: "workspace", families: "family" };
var ID_PATTERN = "[A-Za-z0-9][A-Za-z0-9._-]{0,63}";
var docs = (kind) => site?.docs.filter((doc) => doc.kind === kind) ?? [];
var fromPack = (doc) => doc.layer !== "site";
var saved = (doc, id) => (out) => `${doc ? "\u4FDD\u5B58\u4E86" : "\u6DFB\u52A0\u4E86"} ${out.file ?? String(id)}`;
var BOOT_EXAMPLE = `load:                        # \u5185\u5B58\u542F\u52A8\uFF1A\u52A0\u8F7D\u547D\u4EE4\u4E0D\u4E3B\u52A8\u5237\u5199\u5B58\u50A8\u3001saveenv \u6216\u6539\u542F\u52A8\u811A\u672C\uFF1BFSBL \u7684 DDR training \u53EF\u80FD\u5199 SPI NOR\uFF0C\u542F\u52A8\u540E\u7684\u7CFB\u7EDF\u4E5F\u53EF\u80FD\u5199\u5B58\u50A8
  status: todo                 # \u5199\u597D\u6B65\u9AA4\u540E\u6539\u6210 ready
  notes: \u542F\u52A8\u6B65\u9AA4\u8FD8\u6CA1\u5199
  steps: []
  # steps:
  #   - {do: enter-fdl}                     # \u590D\u4F4D\u8FDB\u4E0B\u8F7D\u6A21\u5F0F
  #   - {do: stage, artifact: fsbl}         # \u4EA7\u7269\u7684\u89D2\u8272\u540D\uFF0C\u89C1\u7F16\u8BD1\u65B9\u5F0F\u7684 artifacts.roles
  #   - {do: continue}
  #   - {do: wait, serial: "SPL", fastboot: "Fastboot", timeout: 60}
  #   - {do: stage, artifact: uboot-sbi}
  #   - {do: continue}
  #   - {do: wait, serial: "U-Boot 20", fastboot: "Fastboot", timeout: 60}
  #   - {do: stage, artifact: kernel-fit}
  #   - {do: continue}
  #   - {do: wait, serial: "login:", fail: "Kernel panic", timeout: 120}
download:                      # \u5237\u673A\uFF1A\u5199\u8FDB\u5B58\u50A8\uFF0C\u518D\u51B7\u542F\u52A8
  status: todo
  notes: \u5237\u673A\u6B65\u9AA4\u8FD8\u6CA1\u5199
  steps: []
  # steps:
  #   - {do: enter-fdl}
  #   - {do: stage, artifact: fsbl}
  #   - {do: continue}
  #   - {do: wait, fastboot: "Fastboot", timeout: 60}
  #   - {do: hook, kind: flash, name: my-flash-tool, artifacts: [flash-zip], timeout: 1800}
  #   - {do: reset, when: fdl-not-strapped, why: \u4ECE\u5237\u597D\u7684\u5B58\u50A8\u51B7\u542F\u52A8}
  #   - {do: wait, when: fdl-not-strapped, serial: "login:", timeout: 180}
`;
function sdkForm(doc, preset = {}) {
  const f = doc?.fields ?? {};
  const pick = (kind, none) => [...none ? [{ value: "", label: none }] : [], ...docs(kind).map((item) => ({ value: item.id, label: fromPack(item) ? `${item.id}\uFF08boardctrl \u81EA\u5E26\uFF09` : item.id }))];
  const socs = [.../* @__PURE__ */ new Set([...(site?.socs ?? []).map((item) => item.soc), ...f.soc ? [f.soc] : []])];
  const server = f.server ?? (doc ? "" : preset.server ?? docs("servers")[0]?.id ?? "");
  return [
    text(doc ? `\u6539 ${doc.file}\u3002\u6CA1\u6539\u7684\u5185\u5BB9\u548C\u6CE8\u91CA\u90FD\u4FDD\u7559\u3002` : `\u65B0\u7684 SDK\uFF1A\u4E00\u68F5\u6E90\u7801\u6811${preset.server ? `\uFF0C\u5728 ${preset.server} \u4E0A` : ""}\uFF0C\u600E\u4E48\u7F16\uFF0C\u677F\u5B50\u600E\u4E48\u542F\u52A8\u548C\u5237\u673A\u3002`),
    {
      kind: "form",
      fields: [
        { kind: "text", id: "id", label: "\u540D\u5B57", initial: doc?.id ?? "", required: true, pattern: ID_PATTERN, placeholder: "\u4F8B\u5982 vendor-a" },
        { kind: "choice", id: "family", label: "\u7F16\u8BD1\u65B9\u5F0F", doc: "sdk-families", options: pick("families"), initial: f.family ?? docs("families")[0]?.id ?? "" },
        { kind: "choice", id: "server", label: "\u7F16\u8BD1\u670D\u52A1\u5668", doc: "sdk-servers", options: pick("servers", "\uFF08\u7528\u6E90\u7801\u6811\uFF09"), initial: server },
        { kind: "text", id: "path", label: "\u6E90\u7801\u8DEF\u5F84", initial: f.path ?? "", placeholder: "\u7F16\u8BD1\u670D\u52A1\u5668\u4E0A\u7684\u76EE\u5F55\uFF0C\u4F8B\u5982 /home/dev/work/vendor-a" },
        { kind: "choice", id: "workspace", label: "\u6E90\u7801\u6811\uFF08\u53EF\u9009\uFF09", options: pick("workspaces", "\uFF08\u4E0D\u7528\uFF0C\u6309\u670D\u52A1\u5668\u548C\u8DEF\u5F84\uFF09"), initial: f.workspace ?? "" },
        { kind: "choice", id: "soc", label: "SoC", doc: "soc-profiles", options: [{ value: "", label: "\uFF08\u4E0D\u9650\uFF09" }, ...socs.map((soc) => ({ value: soc, label: soc }))], initial: f.soc ?? "" },
        { kind: "text", id: "description", label: "\u8BF4\u660E", initial: f.description ?? "", wide: true },
        {
          kind: "code",
          id: "boot",
          label: "\u542F\u52A8\u548C\u5237\u673A\u6B65\u9AA4\uFF08YAML\uFF09",
          doc: "sdk-instances",
          initial: doc ? f.boot ?? "" : BOOT_EXAMPLE,
          rows: 14,
          help: "load \u662F\u5185\u5B58\u542F\u52A8\uFF0Cdownload \u662F\u5237\u673A\uFF0C\u4E24\u4E2A\u90FD\u8981\u6709\uFF1B\u8FD8\u6CA1\u5199\u7684\u7528 status: todo\u3002\u6B65\u9AA4\u7684\u5199\u6CD5\u89C1\u300C?\u300D\u3002"
        }
      ],
      submitLabel: doc ? "\u4FDD\u5B58" : "\u6DFB\u52A0",
      submit: action("save-sdk", doc ? "\u4FDD\u5B58" : "\u6DFB\u52A0", (input) => change("api/boardctrl/site/sdk", { ...input, original: doc?.id ?? "" }, saved(doc, input.id)), { intent: "primary" })
    }
  ];
}
function serverForm(doc) {
  const f = doc?.fields ?? {};
  return [
    text(doc ? `\u6539 ${doc.file}\u3002\u8868\u5355\u91CC\u6CA1\u6709\u7684\u952E\uFF08home_aliases\u3001env\uFF09\u548C\u6CE8\u91CA\u90FD\u4FDD\u7559\u3002` : "\u65B0\u7684\u7F16\u8BD1\u670D\u52A1\u5668\uFF1Aboardctrl \u7528 ssh\uFF08user@host\uFF09\u5230\u8FD9\u91CC\u7F16 SDK\u3002boardd \u548C\u677F\u5361\u4E3B\u673A\u90FD\u8981\u80FD\u7528\u5BC6\u94A5\u767B\u5F55\u5B83\u3002"),
    {
      kind: "form",
      fields: [
        { kind: "text", id: "id", label: "\u540D\u5B57", initial: doc?.id ?? "", required: true, pattern: ID_PATTERN, placeholder: "\u4F8B\u5982 build-a" },
        { kind: "text", id: "host", label: "\u5730\u5740", initial: f.host ?? "", required: true, placeholder: "IP\u3001\u57DF\u540D\u6216 ssh \u914D\u7F6E\u91CC\u7684\u540D\u5B57" },
        { kind: "text", id: "user", label: "\u7528\u6237", initial: f.user ?? "", required: true },
        { kind: "text", id: "description", label: "\u8BF4\u660E", initial: f.description ?? "", wide: true }
      ],
      submitLabel: doc ? "\u4FDD\u5B58" : "\u6DFB\u52A0",
      submit: action("save-server", doc ? "\u4FDD\u5B58" : "\u6DFB\u52A0", (input) => change("api/boardctrl/site/server", { ...input, original: doc?.id ?? "" }, saved(doc, input.id)), { intent: "primary" })
    }
  ];
}
function yamlForm(kind, doc) {
  return [
    text(doc ? `\u6539 ${doc.file} \u7684\u539F\u6587\u3002` : `\u65B0\u7684${kind ? KIND_NAME[kind] : "\u6587\u6863"}\uFF0C\u7528 YAML \u5199\uFF08id \u548C\u540D\u5B57\u4E00\u6837\uFF09\u3002`),
    {
      kind: "form",
      fields: [
        ...kind ? [] : [{ kind: "choice", id: "kind", label: "\u79CD\u7C7B", options: Object.keys(KIND_NAME).map((value) => ({ value, label: KIND_NAME[value] })), initial: "instances" }],
        { kind: "text", id: "id", label: "\u540D\u5B57", initial: doc?.id ?? "", required: true, pattern: ID_PATTERN },
        { kind: "code", id: "text", label: "YAML", initial: doc?.text ?? "id: \n", rows: 16, required: true }
      ],
      submitLabel: doc ? "\u4FDD\u5B58" : "\u6DFB\u52A0",
      submit: action("save-doc", doc ? "\u4FDD\u5B58" : "\u6DFB\u52A0", (input) => change("api/boardctrl/site/doc", { kind: kind ?? input.kind, id: input.id, text: input.text, original: doc?.id ?? "" }, saved(doc, input.id)), { intent: "primary" })
    }
  ];
}
function docActions(kind, doc, form) {
  if (fromPack(doc)) return [];
  return [
    // Documents with a form are edited there (their YAML under 高级 → 编辑原文); the rest as YAML.
    form ? open("edit", "\u7F16\u8F91", `\u7F16\u8F91${KIND_NAME[kind]} ${doc.id}`, () => form(doc)) : open("raw", "\u7F16\u8F91", `${KIND_NAME[kind]} ${doc.id} \u7684\u539F\u6587`, () => yamlForm(kind, doc)),
    action(
      "remove",
      "\u5220\u9664",
      () => change("api/boardctrl/site/remove", { kind, id: doc.id }, (out) => out.message ?? `\u5220\u6389\u4E86 ${doc.id}`),
      { intent: "danger", confirm: { title: `\u5220\u9664 ${doc.id}`, body: `\u4ECE\u7AD9\u70B9\u5220\u6389 ${doc.file}\u3002\u540C\u6B65\u540E\u4E3B\u673A\u4E0A\u4E5F\u6CA1\u6709\u4E86\u3002`, action: "\u5220\u9664" } }
    )
  ];
}
function docList(kind, items, describe, form, empty) {
  return {
    kind: "list",
    empty: empty ?? `\u8FD8\u6CA1\u6709${KIND_NAME[kind]}`,
    items: items.map((doc) => ({ key: `${doc.layer}/${doc.id}`, title: doc.id, description: describe(doc), tag: fromPack(doc) ? `boardctrl \u81EA\u5E26\uFF08${doc.layer}\uFF09` : void 0, actions: docActions(kind, doc, form) }))
  };
}
function sourceForm() {
  return [
    text("\u7AD9\u70B9\u53EF\u4EE5\u5C31\u5728\u8FD9\u53F0 boardd \u91CC\u7BA1\uFF0C\u4E5F\u53EF\u4EE5\u8DDF\u7740\u4E00\u4E2A git \u4ED3\u5E93\uFF08\u7528 boardd \u7684\u5BC6\u94A5\u3001\u518D\u7528\u8FD9\u53F0\u673A\u5668\u7684 ssh \u8BBE\u7F6E\u53BB\u53D6\uFF09\u3002\u4ED3\u5E93\u91CC\u53EF\u4EE5\u653E\u6574\u4E2A\u5B9E\u9A8C\u5BA4\u7684\u914D\u7F6E\uFF0C\u53EA\u6709 sdk/\u3001socs/\u3001hooks/ \u53D1\u7ED9\u4E3B\u673A\u3002"),
    {
      kind: "form",
      fields: [
        { kind: "choice", id: "source", label: "\u6765\u6E90", options: [{ value: "managed", label: "\u8FD9\u53F0 boardd \u7BA1\u7406" }, { value: "git", label: "git \u4ED3\u5E93" }], initial: site?.source ?? "managed" },
        { kind: "text", id: "url", label: "git \u5730\u5740", initial: site?.url ?? "", placeholder: "git@git.example.test:lab/boardctrl-site.git" },
        { kind: "text", id: "branch", label: "\u5206\u652F", initial: site?.branch ?? "main" },
        { kind: "switch", id: "discard", label: "\u4E22\u6389\u8FD9\u91CC\u7684\u6539\u52A8", initial: false, help: "\u8FD9\u91CC\u7684\u7AD9\u70B9\u6709\u65B0\u6765\u6E90\u91CC\u6CA1\u6709\u7684\u63D0\u4EA4\u6216\u6539\u52A8\u65F6\uFF0C\u4E0D\u52FE\u5C31\u4E0D\u6362\uFF08\u5B83\u4EEC\u4F1A\u7559\u5728\u4E00\u4E2A\u672C\u5730\u5206\u652F\u91CC\uFF09" }
      ],
      submitLabel: "\u6362\u6765\u6E90",
      submit: action("set-source", "\u6362\u6765\u6E90", (input) => change("api/boardctrl/site/source", input, (out) => out.message ?? "\u6362\u597D\u4E86"), { intent: "primary" })
    }
  ];
}
function siteContext(s) {
  const yaml = (kind) => docs(kind).filter((doc) => !fromPack(doc)).map((doc) => `# ${doc.file}
${doc.text.trim()}`).join("\n---\n");
  const out = [
    `\u6765\u6E90\uFF1A${s.source === "git" ? `git ${s.url} \u5206\u652F ${s.branch}` : "\u8FD9\u53F0 boardd \u7BA1\u7406"}\uFF1B\u7248\u672C ${s.revision ?? "\u8FD8\u6CA1\u6709"}`,
    `\u7F16\u8BD1\u65B9\u5F0F\uFF1A${docs("families").map((doc) => doc.id + (fromPack(doc) ? "\uFF08boardctrl \u81EA\u5E26\uFF09" : "")).join("\u3001") || "\u65E0"}`,
    `\u6E90\u7801\u6811\uFF1A${docs("workspaces").map((doc) => doc.id).join("\u3001") || "\u65E0"}`,
    `SoC \u8D44\u6599\uFF1A${[...new Set(s.socs.map((item) => item.soc))].join("\u3001") || "\u65E0"}`,
    ...s.skills?.length ? [`SDK skill\uFF1A${s.skills.map((skill) => skill.id).join("\u3001")}`] : [],
    ...s.problems.length ? [`\u95EE\u9898\uFF1A${s.problems.join("\uFF1B")}`] : [],
    ...s.images?.missing.length ? [`\u7F3A\u7684\u955C\u50CF\uFF1A${s.images.missing.join("\u3001")}`] : [],
    "",
    "\u7F16\u8BD1\u670D\u52A1\u5668\uFF1A",
    yaml("servers") || "\uFF08\u8FD8\u6CA1\u6709\uFF09",
    "",
    "SDK\uFF1A",
    yaml("instances") || "\uFF08\u8FD8\u6CA1\u6709\uFF09"
  ].join("\n");
  return out.length > 16e3 ? `${out.slice(0, 16e3)}
\u2026\uFF08\u592A\u957F\uFF0C\u540E\u9762\u7701\u7565\u4E86\uFF09` : out;
}
function serverGroup(server, sdks, sdkText) {
  const mine = sdks.filter((doc) => !doc.fields.workspace && doc.fields.server === server.id);
  return {
    kind: "group",
    title: server.id,
    status: { tone: "neutral", text: `${mine.length} \u4E2A SDK` },
    help: "sdk-instances",
    body: [
      text([{ code: `${server.fields.user ?? "?"}@${server.fields.host ?? "?"}` }, ...server.fields.description ? [` \xB7 ${server.fields.description}`] : [], ...fromPack(server) ? [{ muted: ` \xB7 boardctrl \u81EA\u5E26\uFF08${server.layer}\uFF09` }] : []]),
      docList("instances", mine, (doc) => sdkText(doc, false), (doc) => sdkForm(doc), "\u8FD9\u53F0\u670D\u52A1\u5668\u4E0A\u8FD8\u6CA1\u6709 SDK"),
      { kind: "actions", actions: [
        open(`add-sdk-${server.id}`, "\u6DFB\u52A0 SDK", `\u5728 ${server.id} \u4E0A\u6DFB\u52A0 SDK`, () => sdkForm(null, { server: server.id }), { intent: "primary" }),
        ...docActions("servers", server, serverForm).map((op) => ({ ...op, label: `${op.label}\u670D\u52A1\u5668` }))
      ] }
    ]
  };
}
function advanced(s) {
  const own = s.docs.filter((doc) => !fromPack(doc));
  return {
    kind: "group",
    title: "\u9AD8\u7EA7",
    body: [
      { kind: "group", title: "\u7F16\u8BD1\u65B9\u5F0F", help: "sdk-families", body: [
        docList("families", docs("families"), (doc) => [doc.fields.runner ? `\u7528 ${doc.fields.runner}` : "", doc.fields.description ?? ""].filter(Boolean).join(" \xB7 ")),
        { kind: "actions", actions: [open("add-family", "\u6DFB\u52A0\u7F16\u8BD1\u65B9\u5F0F", "\u6DFB\u52A0\u7F16\u8BD1\u65B9\u5F0F", () => yamlForm("families", null))] }
      ] },
      { kind: "group", title: "\u6E90\u7801\u6811", help: "sdk-families", body: [
        docList("workspaces", docs("workspaces"), (doc) => `${doc.fields.server ?? "?"}:${doc.fields.path ?? "?"}`),
        { kind: "actions", actions: [open("add-workspace", "\u6DFB\u52A0\u6E90\u7801\u6811", "\u6DFB\u52A0\u6E90\u7801\u6811", () => yamlForm("workspaces", null))] }
      ] },
      { kind: "group", title: "SoC \u8D44\u6599", help: "soc-profiles", body: [
        text("\u5728\u7AD9\u70B9\u7684 socs/<soc>/ \u91CC\u6539\uFF1A\u7AD9\u70B9\u653E\u5728 git \u4ED3\u5E93\u91CC\u65F6\uFF0C\u5728\u4ED3\u5E93\u91CC\u6539\u3001\u63D0\u4EA4\uFF0C\u518D\u62C9\u53D6\u3002"),
        { kind: "list", empty: "\u6CA1\u6709 SoC \u8D44\u6599", items: s.socs.map((item) => ({ key: `${item.layer}/${item.soc}`, title: item.soc, description: item.layer === "site" ? `\u7AD9\u70B9\u7684 socs/${item.soc}` : `boardctrl \u81EA\u5E26\uFF08${item.layer}\uFF09` })) }
      ] },
      { kind: "group", title: "SDK skill", body: [
        text("SDK \u53EF\u4EE5\u5E26\u81EA\u5DF1\u7684 SKILL.md\uFF08\u7AD9\u70B9\u7684 skills/<id>.md\uFF0C\u6216 boardctrl \u81EA\u5E26\u5E73\u53F0\u91CC\u7684 skills/<id>.md\uFF09\uFF1Aagent \u5728\u90A3\u4E2A SDK \u7684\u4ED3\u5E93\u91CC\u5DE5\u4F5C\u65F6\uFF0C\u7528 boardlab sdk skill <id> \u6253\u5370\uFF0C\u6216 --install \u88C5\u5230 .claude/skills/<id>/SKILL.md\u3002"),
        { kind: "list", empty: "\u8FD8\u6CA1\u6709 SDK skill", items: (s.skills ?? []).map((skill) => ({ key: `${skill.layer}/${skill.id}`, title: skill.id, description: `${skill.file}${skill.title !== skill.id ? ` \xB7 ${skill.title}` : ""}`, tag: skill.layer === "site" ? void 0 : `boardctrl \u81EA\u5E26\uFF08${skill.layer}\uFF09` })) }
      ] },
      { kind: "group", title: "\u7F16\u8F91\u539F\u6587", body: [
        text("\u7AD9\u70B9\u91CC\u7684\u6BCF\u4E2A\u6587\u6863\u90FD\u53EF\u4EE5\u76F4\u63A5\u6539 YAML\uFF0C\u548C boardlab site set \u4E00\u6837\uFF1A\u5199\u8FDB\u53BB\u524D\u5148\u68C0\u67E5\uFF0C\u4E3B\u673A\u8BFB\u4E0D\u8FDB\u53BB\u7684\u6539\u52A8\u4E0D\u5199\u3002"),
        { kind: "details", summary: `\u7AD9\u70B9\u91CC\u7684\u6587\u6863\uFF08${own.length} \u4E2A\uFF09`, load: async () => [{
          kind: "list",
          empty: "\u7AD9\u70B9\u91CC\u8FD8\u6CA1\u6709\u6587\u6863",
          items: own.map((doc) => ({
            key: `${doc.kind}/${doc.id}`,
            title: doc.file,
            tag: KIND_NAME[doc.kind],
            description: `boardlab site set ${KIND_CLI[doc.kind]} ${doc.id} --file <\u6587\u4EF6>`,
            actions: [open("raw", "\u7F16\u8F91", `${KIND_NAME[doc.kind]} ${doc.id} \u7684\u539F\u6587`, () => yamlForm(doc.kind, doc))]
          }))
        }] },
        { kind: "actions", actions: [open("add-raw", "\u7528 YAML \u6DFB\u52A0", "\u7528 YAML \u6DFB\u52A0\u6587\u6863", () => yamlForm(null, null))] }
      ] }
    ]
  };
}
function siteView(labs) {
  if (Date.now() - loadedAt > 2e4) void loadSite();
  const s = site;
  const sdkText = (doc, server = true) => [
    doc.fields.workspace ? `\u6E90\u7801\u6811 ${doc.fields.workspace}` : server ? `${doc.fields.server ?? "?"}:${doc.fields.path ?? "?"}` : doc.fields.path ?? "?",
    doc.fields.soc ? `SoC ${doc.fields.soc}` : "",
    doc.fields.family ? `\u7F16\u8BD1 ${doc.fields.family}` : "",
    `\u5185\u5B58\u542F\u52A8 ${doc.fields.load ?? "?"} / \u5237\u673A ${doc.fields.download ?? "?"}`,
    doc.fields.description ?? ""
  ].filter(Boolean).join(" \xB7 ");
  const behind = s ? labs.filter((lab) => s.hosts[lab.id]?.revision !== s.revision) : [];
  const servers = docs("servers"), sdks = docs("instances");
  const loose = sdks.filter((doc) => doc.fields.workspace || !servers.some((server) => server.id === doc.fields.server));
  const optional = s?.images?.optional ?? [];
  return {
    id: "boardctrl-site",
    slot: "settings",
    title: "SDK \u4E0E\u7AD9\u70B9",
    help: "site",
    order: 20,
    summary: "SDK \u5728\u54EA\u3001\u600E\u4E48\u5237\uFF0C\u540C\u6B65\u5230\u6BCF\u53F0\u677F\u5361\u4E3B\u673A\u3002",
    // The guidance levels are read from this site; the help says how an agent asks for them.
    extra: { "boardctrl.guidanceHelp": "guidance" },
    hint: {
      commands: ["boardlab site show", "boardlab site set server <id> --file <yaml>", "boardlab site set sdk <id> --file <yaml>", "boardlab site remove <sdk|server|family|workspace> <id>", "boardlab site sync", "boardlab sdk plan <sdk> --boot load|download"],
      context: () => s ? siteContext(s) : "\uFF08\u7AD9\u70B9\u8FD8\u6CA1\u8BFB\u5230\uFF09",
      produce: "\u8981\u653E\u8FDB\u7AD9\u70B9\u7684 YAML\uFF08\u7F16\u8BD1\u670D\u52A1\u5668\u3001SDK \u548C\u5B83\u7684\u542F\u52A8\u3001\u5237\u673A\u6B65\u9AA4\uFF09\uFF0C\u4EE5\u53CA\u628A\u5B83\u4EEC\u653E\u8FDB\u53BB\u7684 boardlab site set \u547D\u4EE4"
    },
    status: !s ? void 0 : s.problems.length ? { tone: "warn", text: `${s.problems.length} \u4E2A\u95EE\u9898` } : { tone: behind.length ? "warn" : "ok", text: s.revision ?? "\u7A7A" },
    body: !s ? [siteError ? notice(`\u8BFB\u4E0D\u5230\u7AD9\u70B9\uFF1A${siteError}`) : text("\u8BFB\u53D6\u4E2D\u2026")] : [
      text("\u7AD9\u70B9\u662F\u6BCF\u53F0 boardctrl \u677F\u5361\u4E3B\u673A\u90FD\u8BFB\u7684\u914D\u7F6E\uFF1ASDK\u3001\u7F16\u8BD1\u670D\u52A1\u5668\u548C SoC \u8D44\u6599\u3002\u5728\u8FD9\u91CC\u6539\uFF0C\u518D\u540C\u6B65\u5230\u4E3B\u673A\u3002"),
      {
        kind: "facts",
        items: [
          { label: "\u6765\u6E90", value: s.source === "git" ? ["git: ", { code: s.url }, " \u5206\u652F ", { code: s.branch }] : "\u8FD9\u53F0 boardd \u7BA1\u7406\uFF08\u8FD8\u6CA1\u8FDE git \u4ED3\u5E93\uFF09" },
          { label: "\u7248\u672C", value: s.revision ? [{ code: s.revision }, ...s.commit ? [` \xB7 ${s.commit.subject} \xB7 `, { time: s.commit.at }] : []] : "\u8FD8\u6CA1\u6709" },
          ...s.source === "git" ? [{ label: "\u6CA1\u63A8\u9001\u7684\u63D0\u4EA4", value: String(s.ahead), tone: s.ahead ? "warn" : void 0 }] : [],
          { label: "\u4E3B\u673A", value: labs.length ? `${labs.length - behind.length}/${labs.length} \u53F0\u662F\u8FD9\u4E2A\u7248\u672C` : "\u8FD8\u6CA1\u6709" },
          { label: "\u955C\u50CF", value: s.images?.message ?? "\u8FD8\u6CA1\u53D6\uFF08\u62C9\u53D6\u6216\u540C\u6B65\u65F6\u53D6\uFF09", tone: s.images && !s.images.ok ? "warn" : void 0 }
        ]
      },
      ...s.problems.map((problem) => notice(problem)),
      // Images not there do not stop a sync; the hosts then lack them, so say which.
      ...(s.images?.failed ?? []).slice(0, 8).map((item) => notice(`\u955C\u50CF ${item.image} \u6CA1\u53D6\u5230\uFF1A${item.error}`)),
      ...(s.images?.missing ?? []).slice(0, 8).map((name) => notice(`\u955C\u50CF ${name} \u6709\u542F\u52A8\u6B65\u9AA4\u8981\u7528\uFF0C\u5374\u54EA\u513F\u90FD\u6CA1\u6709\uFF1A\u653E\u8FDB\u7AD9\u70B9\u7684 socs/<soc>/\uFF0C\u6216\u5728 soc.yaml \u91CC\u5199\u4E0A sha256 \u548C source`)),
      ...optional.length ? [{
        kind: "details",
        summary: `\u53EF\u9009\uFF1A${optional.slice(0, 2).join("\u3001")}${optional.length > 2 ? ` \u7B49 ${optional.length} \u4E2A` : ""}\u63A2\u6D4B\u7528\u955C\u50CF\u6CA1\u6709\uFF0C\u53D1\u73B0\u677F\u5B50\u65F6\u5C31\u8BFB\u4E0D\u5230\u578B\u53F7`,
        load: async () => [
          text("\u8FD9\u4E9B\u955C\u50CF\u53EA\u5728\u53D1\u73B0\u677F\u5B50\u65F6\u7528\u6765\u8BFB\u51FA\u578B\u53F7\u548C\u5E8F\u5217\u53F7\uFF0C\u6CA1\u6709\u4E5F\u80FD\u540C\u6B65\u3001\u542F\u52A8\u548C\u5237\u673A\u3002\u8981\u8865\u4E0A\uFF1A\u628A\u6587\u4EF6\u653E\u8FDB\u7AD9\u70B9\u7684 socs/<soc>/\uFF08\u6587\u4EF6\u540D\u7167\u62EC\u53F7\u91CC\u7684\uFF09\uFF0C\u6216\u8005\u5728\u7AD9\u70B9\u7684 socs/<soc>/soc.yaml \u91CC\u5199\u4E0A\u5B83\u7684 sha256 \u548C source\uFF08git\u3001url \u6216 file\uFF09\uFF0Cboardd \u540C\u6B65\u524D\u4F1A\u53BB\u53D6\u3002\u8BE6\u89C1\u300CSoC \u8D44\u6599\u300D\u7684\u5E2E\u52A9\u3002"),
          { kind: "list", items: optional.map((name) => ({ key: name, title: name })) }
        ]
      }] : [],
      {
        kind: "actions",
        actions: [
          job("sync", "\u540C\u6B65\u5230\u6240\u6709\u4E3B\u673A", async (_input, sink, signal) => {
            try {
              return (await stream("api/boardctrl/site/sync", {}, sink, signal)).message;
            } finally {
              await loadSite();
            }
          }, {
            intent: "primary",
            blocked: !labs.length ? "\u8FD8\u6CA1\u6709 boardctrl \u4E3B\u673A" : s.syncing ? "\u6B63\u5728\u540C\u6B65" : s.problems.length ? "\u7AD9\u70B9\u6709\u95EE\u9898\uFF0C\u5148\u6539\u597D" : void 0
          }),
          action("pull", "\u62C9\u53D6", () => change("api/boardctrl/site/pull", {}, (out) => out.message ?? "\u62C9\u597D\u4E86"), { blocked: s.source !== "git" ? "\u7AD9\u70B9\u7531\u8FD9\u53F0 boardd \u7BA1\u7406" : void 0 }),
          ...s.source === "git" ? [action("push", "\u63A8\u9001", () => change("api/boardctrl/site/push", {}, (out) => out.message ?? "\u63A8\u9001\u4E86"), { blocked: s.ahead ? void 0 : "\u6CA1\u6709\u8981\u63A8\u9001\u7684" })] : [],
          open("source", "\u6362\u6765\u6E90", "\u7AD9\u70B9\u7684\u6765\u6E90", sourceForm)
        ]
      },
      {
        kind: "group",
        title: "\u7F16\u8BD1\u670D\u52A1\u5668",
        help: "sdk-servers",
        body: [
          ...servers.length ? [] : [text("\u8FD8\u6CA1\u6709\u7F16\u8BD1\u670D\u52A1\u5668\u3002\u5148\u6DFB\u52A0\u4E00\u53F0\uFF0C\u518D\u5728\u5B83\u4E0B\u9762\u6DFB\u52A0 SDK\u3002")],
          ...servers.map((server) => serverGroup(server, sdks, sdkText)),
          ...loose.length ? [{ kind: "group", title: "\u7528\u6E90\u7801\u6811\u6216\u522B\u7684\u670D\u52A1\u5668\u7684 SDK", help: "sdk-instances", body: [docList("instances", loose, (doc) => sdkText(doc), (doc) => sdkForm(doc))] }] : [],
          { kind: "actions", actions: [open("add-server", "\u6DFB\u52A0\u7F16\u8BD1\u670D\u52A1\u5668", "\u6DFB\u52A0\u7F16\u8BD1\u670D\u52A1\u5668", () => serverForm(null)), open("add-sdk", "\u6DFB\u52A0 SDK", "\u6DFB\u52A0 SDK", () => sdkForm(null))] }
        ]
      },
      advanced(s)
    ]
  };
}
var ui = {
  module: "boardctrl",
  views(state, context) {
    const labs = state.labs.filter((lab) => lab.addedAs === "boardctrl");
    const board = context.board ? state.boards.find((item) => item.name === context.board) : void 0;
    if (board) {
      const labBoard = !!board.lab && !board.lab.empty && labs.some((lab) => lab.id === board.lab.id);
      const home = labBoard ? labs.find((lab) => lab.id === board.lab.id) : void 0;
      if (!labBoard) return [];
      if (hasDebug(board)) void readDebug(board.name);
      return [{
        id: "boardctrl-board",
        slot: "board",
        title: "boardctrl \u767B\u8BB0",
        body: [
          { kind: "actions", actions: [openBoardForm(board.name)] },
          // The host's own page: its GPIO header, lines and events, opened on the host itself.
          ...home?.url ? [text([{ link: "GPIO \u9762\u677F", href: gpioLink(home.url, home.id) }])] : [],
          ...debugView(board)
        ]
      }];
    }
    return [{
      id: "boardctrl-hosts",
      slot: "settings",
      title: "boardctrl \u677F\u5361\u4E3B\u673A",
      help: "board-hosts",
      order: 10,
      summary: "\u63A5\u7740\u677F\u5B50\u7684\u673A\u5668\uFF08\u4E5F\u53EF\u4EE5\u5C31\u662F\u8FD9\u53F0\uFF09\uFF1A\u7ED9\u5730\u5740\u548C\u767B\u5F55\u65B9\u5F0F\uFF0Cboardd \u8FC7\u53BB\u88C5\u597D\u3002",
      status: labs.length ? { tone: labs.every((lab) => lab.enabled && lab.verifyOk !== false) ? "ok" : "warn", text: `${labs.length} \u53F0` } : void 0,
      body: [
        text("\u63A5\u7740\u677F\u5B50\u7684\u673A\u5668\u3002\u6BCF\u53F0\u88C5\u4E0A boardctrld\uFF0C\u5C31\u662F\u4E00\u4E2A\u5B9E\u9A8C\u5BA4\uFF1A\u5B83\u7684\u590D\u4F4D\u7EBF\u3001\u4E32\u53E3\u548C\u4E0B\u8F7D\u53E3\u7531 boardd \u7BA1\uFF0C\u9501\u548C\u6392\u961F\u5728\u8FD9\u91CC\u3002"),
        ...labs.length ? [{
          kind: "list",
          items: labs.map((lab) => ({
            key: lab.id,
            title: lab.id,
            description: [
              [lab.url?.replace(/^boardctrld\+/, "") ?? "\u8FD8\u6CA1\u88C5", lab.verifyMessage ? ` \xB7 ${lab.verifyMessage}` : "", hostSite(lab.id)].join(""),
              // The host's own page (GPIO header, lines, events), through boardd, which adds the token.
              ...lab.enabled && lab.url ? [" \xB7 ", { link: "GPIO \u9762\u677F", href: gpioLink(lab.url, lab.id) }] : []
            ],
            status: lab.busy ? { tone: "neutral", text: lab.busy.line ? `${lab.busy.label}\uFF1A${lab.busy.line.slice(0, 60)}` : `${lab.busy.label}\u2026` } : !lab.enabled ? { tone: "warn", text: "\u8FD8\u6CA1\u88C5\u597D" } : lab.verifyOk === false ? { tone: "error", text: "\u8FDE\u4E0D\u4E0A" } : { tone: "ok", text: "\u5728\u7EBF" },
            actions: [
              open("reinstall", "\u91CD\u65B0\u5B89\u88C5", `\u91CD\u65B0\u5B89\u88C5 ${lab.id}`, () => install(lab)),
              action(
                "remove",
                "\u5220\u9664",
                async () => {
                  await call("POST", "api/boardctrl/uninstall", { id: lab.id });
                  return `\u5220\u9664\u4E86 ${lab.id}\uFF1A\u4E3B\u673A\u4E0A\u7684 boardctrld \u5378\u6389\u4E86`;
                },
                { intent: "danger", confirm: { title: `\u5220\u9664 ${lab.id}`, body: "\u5378\u6389\u4E3B\u673A\u4E0A\u7684 boardctrld\uFF08\u5B83\u7684\u677F\u5B50\u8BB0\u5F55\u7559\u5728\u4E3B\u673A\u4E0A\uFF09\uFF0C\u5E76\u4ECE boardlab \u5220\u6389\u8FD9\u4E2A\u5B9E\u9A8C\u5BA4\u548C\u5B83\u7684\u677F\u5B50\u3002\u6709\u4EBA\u62FF\u7740\u9501\u65F6\u4E0D\u80FD\u5220\u3002", action: "\u5220\u9664" } }
              )
            ]
          }))
        }] : [notice("\u8FD8\u6CA1\u6709\u677F\u5361\u4E3B\u673A\u3002\u6DFB\u52A0\u4E00\u53F0\uFF1A\u7ED9\u51FA\u5730\u5740\u548C\u767B\u5F55\u65B9\u5F0F\uFF0Cboardd \u4F1A\u88C5\u597D\u5B83\u3002", "neutral")],
        // Each host's download cache: read from the host when opened, so a slow host never holds the page up.
        ...labs.filter((lab) => lab.enabled).map((lab) => ({ kind: "details", summary: `${lab.id} \u7684\u4E3B\u673A\u7F13\u5B58\uFF08\u5237\u673A\u5305\u3001SDK \u4EA7\u7269\uFF09`, load: () => hostCaches(lab.id) })),
        { kind: "actions", actions: [open("add", "\u6DFB\u52A0\u677F\u5361\u4E3B\u673A", "\u6DFB\u52A0\u677F\u5361\u4E3B\u673A", () => install(null), { intent: "primary" })] }
      ]
    }, siteView(labs)];
  }
};
function bytes(value) {
  if (value >= 2 ** 30) return `${(value / 2 ** 30).toFixed(1)} GiB`;
  if (value >= 2 ** 20) return `${(value / 2 ** 20).toFixed(1)} MiB`;
  return value >= 1024 ? `${Math.round(value / 1024)} KiB` : `${value} B`;
}
async function hostCaches(lab) {
  const hosts = await call("GET", `api/boardctrl/hosts/${encodeURIComponent(lab)}/cache`);
  if (!hosts.length) return [text("\u8FD9\u4E2A\u5B9E\u9A8C\u5BA4\u8FD8\u6CA1\u6709\u4E3B\u673A\u3002")];
  return hosts.map((item) => {
    if (item.error) return notice(`${item.host}\uFF1A\u8BFB\u4E0D\u5230\uFF08${item.error}\uFF09`, "warn");
    if (!item.cache) return text([{ strong: item.host }, "\uFF1A\u4E3B\u673A\u4E0A\u7684 boardctrl \u592A\u65E7\uFF0C\u4E0D\u62A5\u7F13\u5B58\uFF1B\u91CD\u65B0\u5B89\u88C5\u540E\u5C31\u6709\u3002"]);
    const cache = item.cache;
    const label = [
      `${item.host}\uFF1A${bytes(cache.used)}${cache.max_bytes ? ` / ${bytes(cache.max_bytes)}` : ""}`,
      `${cache.entries} \u9879${cache.held ? `\uFF08${cache.held} \u9879\u6B63\u5728\u7528\uFF09` : ""}`,
      cache.ttl_s ? `\u4E0D\u7528\u7684\u7559 ${Math.round(cache.ttl_s / 86400)} \u5929` : null,
      cache.free !== null ? `\u78C1\u76D8\u8FD8\u5269 ${bytes(cache.free)}` : null
    ].filter(Boolean).join(" \xB7 ");
    const fraction = cache.max_bytes ? Math.min(1, cache.used / cache.max_bytes) : null;
    return { kind: "progress", label, fraction, tone: fraction !== null && fraction >= 0.9 ? "warn" : "neutral" };
  });
}
var paths = /* @__PURE__ */ new Map();
var asking = /* @__PURE__ */ new Map();
function debugPath(board) {
  return paths.get(board) ?? null;
}
function hasDebug(board) {
  return !!board.lab?.debug;
}
function readDebug(board, refresh = false) {
  if (!refresh && paths.has(board)) return Promise.resolve(paths.get(board) ?? null);
  const pending = asking.get(board);
  if (pending) return pending;
  const ask = call("POST", "api/debug", { board, action: "path" }).then((got) => {
    const path = got?.debug ?? null;
    paths.set(board, path);
    return path;
  }).catch(() => {
    paths.set(board, null);
    return null;
  }).finally(() => {
    if (asking.get(board) === ask) asking.delete(board);
  });
  asking.set(board, ask);
  return ask;
}
var KINDS = {
  halt: { label: "\u6682\u505C" },
  run: { label: "\u7EE7\u7EED" },
  reset: { label: "\u590D\u4F4D\uFF08\u8C03\u8BD5\u53E3\uFF09" },
  step: { label: "\u5355\u6B65" },
  regs: { label: "\u5BC4\u5B58\u5668" }
};
function runAction(board, kind) {
  return action(`debug-${kind}`, KINDS[kind]?.label ?? kind, async () => {
    const got = await call("POST", "api/debug", { board, action: kind });
    paths.delete(board);
    const data = got.debug?.data ?? [];
    return { message: got.debug?.message ?? `${kind} \u5DF2\u5B8C\u6210`, data };
  }, { intent: KINDS[kind]?.intent });
}
function trace(board) {
  return {
    kind: "live",
    height: "large",
    stream: {
      id: `boardctrl-debug-${board}`,
      open(sink) {
        const source = new EventSource(`api/debug/stream?board=${encodeURIComponent(board)}`);
        let pending = "";
        source.onmessage = (event) => {
          let bytes2;
          try {
            bytes2 = Uint8Array.from(atob(event.data), (char) => char.charCodeAt(0));
          } catch {
            return;
          }
          pending += new TextDecoder().decode(bytes2, { stream: true });
          const lines = pending.split(/\r?\n/);
          pending = lines.pop() ?? "";
          for (const line of lines) sink.line(line);
        };
        return () => {
          if (pending) sink.line(pending);
          source.close();
        };
      }
    }
  };
}
function debugView(board) {
  const path = debugPath(board.name);
  if (!path) return [];
  const kinds = path.kinds.filter((kind) => kind in KINDS);
  return [
    {
      kind: "group",
      title: `\u8C03\u8BD5\uFF08${path.title ?? path.provider}\uFF09`,
      help: "debug",
      status: path.running ? { tone: "ok", text: "\u4F1A\u8BDD\u5728\u8DD1" } : { tone: "neutral", text: "\u672A\u542F\u52A8" },
      body: [
        ...path.about ? [text(path.about, "neutral")] : [],
        ...path.state?.length ? [{ kind: "facts", items: path.state.map((item) => ({ label: item.label, value: item.value })) }] : [],
        {
          kind: "actions",
          actions: path.running ? [
            action("debug-stop", "\u505C\u6B62\u8C03\u8BD5\u4F1A\u8BDD", async () => {
              const got = await call("POST", "api/debug", { board: board.name, action: "stop" });
              paths.delete(board.name);
              return got.debug.message;
            }),
            ...kinds.map((kind) => runAction(board.name, kind))
          ] : [job("debug-start", "\u542F\u52A8\u8C03\u8BD5\u4F1A\u8BDD", async (_input, sink) => {
            sink.line("\u8BA9\u4E3B\u673A\u628A\u8C03\u8BD5\u53E3\u4EA4\u7ED9\u8FD9\u5757\u677F\u5B50\u2026");
            const got = await call("POST", "api/debug", { board: board.name, action: "start" });
            paths.delete(board.name);
            return `\u8C03\u8BD5\u4F1A\u8BDD\u8D77\u6765\u4E86${got.debug?.endpoint ? `\uFF1A${got.debug.endpoint}` : ""}\uFF08\u8DDF\u7740\u677F\u5B50\u7684\u9501\uFF0C\u677F\u5B50\u4E00\u91CA\u653E\u5C31\u505C\uFF09`;
          }, { intent: "primary" })]
        },
        ...path.running && path.kinds.includes("trace") ? [trace(board.name)] : []
      ]
    }
  ];
}
export {
  debugPath,
  debugView,
  hasDebug,
  readDebug,
  ui
};
