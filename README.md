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
| `human` | 人工请求：AI 请人插拔线、接板子、按按钮，人点「我做好了」；带 `boardlab ask` 命令 | `human` |
| `feedback` | 反馈：AI 用 boardlab 时提的请求，维护的人看和关闭；带 `boardlab feedback` 命令 | `feedback` |
| `alerts` | 通知总线：失败、等人、老化匹配记下来，推到飞书群（交互式卡片）或页面；带 `boardlab alerts` 命令 | `notifications` |
| `console-watch` | 串口监控：老化/长跑时盯多块板的串口，命中或缺行发到通知总线；带 `boardlab watch` 命令，要 `alerts` | `console` `watch` |
| `market` | 模块市场自己的页面：加市场、装/卸模块、拉新版本并让 boardd 重新加载 | `module` `market` |
| `sftp-images` | 构建服务器上的目录（ssh）：每个目录是一个文件夹，里面符合 glob 的文件是镜像 | `images` `ssh` |
| `clients` | 给编译机、笔记本装 boardlab 命令行，连到这台 boardd：加机器、装、看状态、删（页面上做） | `clients` `ssh` |
| `local` | 接在本机上的板子：槽位、serial-mux 串口、本机 fastboot、扫描 | `lab` `boards` `serial` |
| `home-assistant` | Home Assistant 上的复位/下载开关，槽位跟着控制器走（要 `local`） | `lab` `boards` |
| `script-slots` | 脚本驱动的槽位：智能插座之类的脚本复位（要 `local`） | `lab` `boards` |
| `boardctrl` | boardctrl 板卡主机和 SDK：板子接在别的 Linux 机器上，boardd 用 ssh 装上 boardctrld；带 `boardlab host`、`boardlab registry` 等命令 | `lab` `boards` `sdk` |
| `login-disable` | 串口免密登录：识别串口上的 Bianbu/Ubuntu/Debian，自己登录一次，把串口 getty 改成自动登录，可还原；带 `boardlab login-disable` 命令 | `console` `login` |

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

### 页面、命令和帮助

市场里的模块可以带三样和它一起走的东西，都在 `market.json` 那一项里写：

| 字段 | 是什么 |
| --- | --- |
| `ui` | 页面部分：`{ module, views }`，浏览器直接 import 这个文件。必须 `import … from 'boardlab/ui'`（页面的 import map 指到 boardd 自己的 SDK），不能 import 市场里的别的文件 |
| `cli` | `boardlab` 命令：导出 `{ title, commands }`（`RemoteCommandGroup`）。命令在装了模块的 boardd 上跑，用 `ctx.client` 访问 boardd |
| `docs` | 帮助页目录，默认是入口旁边的 `docs/`。每个 `.md` 是一页，名字是 `<模块>/<文件名>`，页面上 `view.help` 写这个名字 |

`ui` 写的是**浏览器能直接跑的文件**（`.js`）。用 TypeScript 写源码的话，把它编译好再提交：

```sh
pnpm build     # 每个带 ui 的模块：<模块>/ui.ts -> <模块>/ui.js，把 boardlab/ui 留在外面
```

`ui.js` 是构建产物，也要提交：市场是 git clone 的，boardd 不编译。

```ts
export const ui = {
  module: 'hello',
  views: (state) => [{ id: 'hello', slot: 'page', title: 'Hello', help: 'hello/hello', body: [] }],
}
```

```ts
export const commands = {
  title: 'Hello', id: 'hello',
  commands: [{
    name: 'hello', noBoard: true, usage: ['hello [名字]\t打个招呼'],
    async run({ args, client }) { console.log(await client.call('GET', '/api/hello')) },
  }],
}
```

模块在市场里的依赖就用 `inject`：`nexus-spacemit` 写 `inject: ["nexus"]`，而不是把目录套进 `nexus/` 里。

## 加上一个模块

1. `mkdir <模块>`，写 `<模块>/module.js`（或`.ts`）。
2. 在 `market.json` 的 `modules` 里加一项：`id`、`title`、`about`、`tags`、`inject`/`provide`，有页面、命令或帮助就再写 `ui`、`cli`、`docs`。
   页面部分用 `pnpm build` 编译，和源码一起提交。
3. 提交，推上来。装了市场的机器 `boardlab market update pub` 就能看到改了什么。
