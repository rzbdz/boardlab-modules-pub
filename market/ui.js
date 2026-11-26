// market/ui.ts
import { action, call, notice, text } from "boardlab/ui";
var known = null;
var load = async () => {
  known = await call("GET", "api/market");
  return known;
};
void load().catch(() => {
});
var edges = (module) => [module.inject.length ? `\u8981 ${module.inject.join("\u3001")}` : "", module.provide.length ? `\u7ED9 ${module.provide.join("\u3001")}` : "", module.version ? module.version : ""].filter(Boolean).join(" \xB7 ");
var ui = {
  module: "market",
  views(state) {
    const data = known;
    const running = new Set(state.modules.map((module) => module.id));
    const chosen = new Set(data?.selected ?? []);
    const body = [
      text("\u6A21\u5757\u5E02\u573A\u662F\u653E\u6A21\u5757\u7684\u5730\u65B9\uFF1A\u4E00\u4E2A git \u4ED3\u5E93\uFF0C\u91CC\u9762\u6BCF\u4E2A\u76EE\u5F55\u662F\u4E00\u4E2A\u6A21\u5757\u5305\u3002\u52A0\u4E86\u5E02\u573A\u4E0D\u7B49\u4E8E\u88C5\u4E86\u5B83\u91CC\u9762\u7684\u6A21\u5757\uFF1B\u88C5\u4E86\u7684\u6A21\u5757\u5199\u8FDB boardd \u7684\u914D\u7F6E\uFF0C\u91CD\u542F\u540E\u7531 boardd \u52A0\u8F7D\u3002"),
      ...data ? [] : [text("\u8BFB\u53D6\u4E2D\u2026")],
      ...(data?.problems ?? []).map((problem) => notice(problem))
    ];
    for (const market of data?.markets ?? []) {
      body.push({
        kind: "group",
        title: `${market.id}  ${market.commit ? market.commit.slice(0, 12) : "\u8FD8\u6CA1\u62C9\u53D6"}`,
        status: market.problems.length ? { tone: "warn", text: `${market.problems.length} \u4E2A\u95EE\u9898` } : { tone: "ok", text: `${market.modules.length} \u4E2A\u6A21\u5757` },
        body: [
          text([{ code: market.url }, market.branch ? `\uFF08${market.branch}\uFF09` : ""]),
          ...market.problems.map((problem) => notice(problem)),
          {
            kind: "list",
            empty: "\u8FD9\u4E2A\u5E02\u573A\u6CA1\u6709\u63D0\u4F9B\u6A21\u5757",
            items: market.modules.map((module) => {
              const installed = chosen.has(module.id), live = running.has(module.id);
              return {
                key: module.id,
                title: module.title,
                description: [module.id, module.about, edges(module)].filter(Boolean).join("  \xB7  "),
                status: installed ? { tone: live ? "ok" : "warn", text: live ? "\u5728\u8DD1" : installed ? "\u88C5\u4E86\uFF0C\u6CA1\u5728\u8DD1" : "\u6CA1\u88C5" } : { tone: "neutral", text: "\u6CA1\u88C5" },
                actions: installed ? [
                  action(`uninstall-${module.id}`, "\u5378\u8F7D", async () => {
                    const out = await call("POST", "api/market/uninstall", { id: module.id });
                    await load();
                    return out.message;
                  }, { confirm: { title: `\u5378\u8F7D ${module.title}`, body: "\u4ECE boardd \u7684\u914D\u7F6E\u91CC\u62FF\u6389\u5B83\uFF1A\u4EE3\u7801\u548C\u8BBE\u7F6E\u90FD\u8FD8\u5728\u5E02\u573A\u91CC\uFF0C\u8981\u88C5\u56DE\u6765\u518D\u70B9\u4E00\u6B21\u5C31\u884C\u3002", action: "\u5378\u8F7D" } })
                ] : [
                  action(`install-${module.id}`, "\u5B89\u88C5", async () => {
                    const out = await call("POST", "api/market/install", { id: module.id });
                    await load();
                    return out.message;
                  }, { intent: "primary" })
                ]
              };
            })
          },
          {
            kind: "actions",
            actions: [
              action(`update-${market.id}`, "\u62C9\u53D6\u65B0\u7248\u672C", async () => {
                const out = await call("POST", "api/market/update", { id: market.id });
                await load();
                return out.message;
              }),
              action(`remove-${market.id}`, "\u5220\u6389\u8FD9\u4E2A\u5E02\u573A", async () => {
                const out = await call("POST", "api/market/remove", { id: market.id, yes: true });
                await load();
                return out.message;
              }, { intent: "danger", confirm: { title: `\u5220\u6389\u5E02\u573A ${market.id}`, body: "\u5B83\u5728\u672C\u673A\u7684\u590D\u5236\u54C1\u4E00\u8D77\u5220\u6389\uFF1B\u914D\u7F6E\u91CC\u4ECE\u5B83\u88C5\u7684\u6A21\u5757\u4E0B\u6B21\u542F\u52A8\u5C31\u6CA1\u4E86\uFF08\u73B0\u5728\u6B63\u5728\u8DD1\u7684\u8FD9\u6B21\u4E0D\u53D7\u5F71\u54CD\uFF09\u3002", action: "\u5220\u6389" } })
            ]
          }
        ]
      });
    }
    body.push({
      kind: "form",
      fields: [
        { kind: "text", id: "id", label: "\u5E02\u573A\u540D", required: true, placeholder: "pub", pattern: "[A-Za-z0-9][A-Za-z0-9._-]{0,63}", help: "\u672C\u673A\u4E0A\u7684\u540D\u5B57\uFF1A\u547D\u4EE4\u884C\u91CC\u7528\u5B83\uFF0C\u4E24\u4E2A\u5E02\u573A\u7684\u540D\u5B57\u4E0D\u80FD\u4E00\u6837" },
        { kind: "text", id: "url", label: "git \u5730\u5740", required: true, wide: true, placeholder: "git@github.com:\u7EC4/\u4ED3\u5E93.git \u6216 https://\u2026" },
        { kind: "text", id: "branch", label: "\u5206\u652F\uFF08\u53EF\u9009\uFF09", placeholder: "\u9ED8\u8BA4\u662F\u4ED3\u5E93\u81EA\u5DF1\u7684\u9ED8\u8BA4\u5206\u652F" }
      ],
      submitLabel: "\u52A0\u5E02\u573A",
      note: "\u5E02\u573A\u91CC\u7684\u4EE3\u7801\u5728 boardd \u8FDB\u7A0B\u91CC\u8DD1\uFF0C\u6743\u9650\u548C boardd \u4E00\u6837\uFF1A\u53EA\u52A0\u4F60\u4FE1\u5F97\u8FC7\u7684\u5E02\u573A\u3002\u79C1\u6709\u5E02\u573A\u7528 ssh \u5730\u5740\uFF0C\u9760\u8FD9\u53F0\u673A\u5668\u81EA\u5DF1\u7684\u5BC6\u94A5\u3002",
      submit: action("add-market", "\u52A0\u5E02\u573A", async (input) => {
        const out = await call("POST", "api/market/add", { id: String(input.id).trim(), url: String(input.url).trim(), branch: String(input.branch ?? "").trim() || void 0 });
        await load();
        return out.message;
      }, { intent: "primary" })
    });
    const orphan = [...chosen].filter((id) => !(data?.markets ?? []).some((market) => market.modules.some((module) => module.id === id)) && !running.has(id));
    if (data && orphan.length) body.push(notice(`\u914D\u7F6E\u91CC\u8FD8\u6709\u8FD9\u4E9B\u6A21\u5757\uFF0C\u53EF\u662F\u6CA1\u6709\u5E02\u573A\u63D0\u4F9B\u5B83\u4EEC\uFF0C\u5B83\u4EEC\u4E5F\u6CA1\u5728\u8DD1\uFF1A${orphan.join("\u3001")}\u3002\u88C5\u56DE\u6765\uFF0C\u6216\u8005\u4ECE\u914D\u7F6E\u91CC\u62FF\u6389\u3002`));
    if (data && data.canReload && (data.markets.length || chosen.size)) body.push({
      kind: "actions",
      actions: [
        action("reload", "\u8BA9 boardd \u6309\u73B0\u5728\u7684\u914D\u7F6E\u91CD\u65B0\u52A0\u8F7D", async () => {
          const out = await call("POST", "api/market/reload", {});
          return out.message;
        }, { intent: "primary", confirm: { title: "\u91CD\u65B0\u52A0\u8F7D boardd", body: "\u4F1A\u8D77\u4E00\u4E2A\u65B0\u7684 boardd \u8FDB\u7A0B\u6309\u73B0\u5728\u7684\u914D\u7F6E\u52A0\u8F7D\uFF0C\u65B0\u7684\u8FDE\u63A5\u53BB\u5B83\u90A3\u91CC\uFF1B\u65E7\u8FDB\u7A0B\u8DD1\u5B8C\u624B\u4E0A\u7684\u4EFB\u52A1\u518D\u9000\uFF0C\u6B63\u5728\u5237\u7684\u673A\u4E0D\u4F1A\u88AB\u6253\u65AD\u3002", action: "\u91CD\u65B0\u52A0\u8F7D" } })
      ]
    });
    if (data && !data.canReload) body.push(text([{ muted: "\u8FD9\u4E2A boardd \u4E0D\u5728 supervisor \u4E0B\u8DD1\uFF08\u6BD4\u5982\u4ECE\u6E90\u7801\u76F4\u63A5 serve\uFF09\uFF1A\u88C5\u3001\u5378\u3001\u52A0\u5E02\u573A\u90FD\u8981\u91CD\u542F\u5B83\u624D\u751F\u6548\u3002" }]));
    return [{
      id: "market",
      slot: "page",
      title: "\u6A21\u5757\u5E02\u573A",
      help: "market/market",
      status: data ? { tone: data.problems.length ? "warn" : "ok", text: data.markets.length ? `${data.markets.length} \u4E2A\u5E02\u573A \xB7 ${chosen.size} \u4E2A\u88C5\u4E86` : "\u6CA1\u6709\u5E02\u573A" } : void 0,
      body
    }];
  }
};
export {
  ui
};
