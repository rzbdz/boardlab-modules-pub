# boardlab-modules-pub

boardlab 的公共模块市场：随 boardlab 发布的模块之外，可以从这里装模块。一个模块就是一段注册到 boardd 的代码，装上以后和随 boardlab 发的模块一样：同样的配置、同样的 `inject`/`provide`、同样的页面和接口。

```sh
boardlab market add pub git@github.com:rzbdz/boardlab-modules-pub.git
boardlab market show pub
```

然后在 boardd 的 `boardd.json` 的 `modules` 里写上要装的模块，重启 boardd。

## 市场里有什么

| 模块 | 带来什么 | 标签 |
| --- | --- | --- |
| `nexus-images` | Nexus raw 仓库的镜像市场 | `images` `market` |

## 写一个模块

一个模块是市场里一个目录，入口在 `market.json` 里写了，默认是 `<模块>/module.js`（或 `index.js`、`module.ts`，Node 24 直接跑 TypeScript）。模块的默认导出是 `{ id, title, setup }`：

```ts
import type { Module } from 'boardlab'

export default {
  id: 'hello', title: 'Hello',
  setup(lab, ctx) {
    lab.api.addOne('hello', { method: 'GET', path: '/api/hello', about: '打个招呼', handle: () => ({ text: `hello, ${ctx.config.name ?? 'world'}` }) })
    return {}
  },
} satisfies Module
```

- `import 'boardlab'` 得到的是 boardd 自己那套（`BoardError`、`TextReply`、市场、lab 的类型），不需要 `node_modules`，别的包也不会被解析。
- `setup(lab, ctx)` 里注册的一切随模块卸载一起撤销：`ctx.effect`、`ctx.on`、`ctx.provide`，以及 `lab.…` 上带 undo 的那些调用。
- `inject` 声明需要的服务，`provide` 声明提供的服务：缺的服务没人给时，模块在 boardd 里是「等着」，不会启动。
- 模块更新在 boardd 下次启动生效。

模块在市场里的依赖就用 `inject`：`nexus-spacemit` 写 `inject: ["nexus"]`，而不是把目录套进 `nexus/` 里。

## 加上一个模块

1. `mkdir <模块>`，写 `<模块>/module.js`（或`.ts`）。
2. 在 `market.json` 的 `modules` 里加一项：`id`、`title`、`about`、`tags`、`inject`/`provide`。
3. 提交，推上来。装了市场的机器 `boardlab market update pub` 就能看到改了什么。
