# 模块市场

boardlab 的核心和这台机器装的模块是两回事：核心管板子、锁、串口、刷机这些共用的东西，模块往上加一种能力（一个后端、一种镜像来源、一个站点专用的步骤）。模块市场是**放模块的地方**：一个 git 仓库，里面每个目录是一个模块包。换一台机器、换一个实验室，装哪些模块由 boardd 的配置决定，代码本身不用改。

市场只是货架：加了市场不等于装了它里面的模块，删了市场也不影响已经装了的模块（它只是不能再更新）。

## 命令行

```sh
boardlab market                                  # 装了哪些市场，各自提供什么
boardlab market add pub git@github.com:example/boardlab-modules.git
boardlab market add lab git@git.example:group/modules.git --branch main
boardlab market update [<市场>|--all]            # 拉取新版本，改了什么会列出来
boardlab market show pub                          # 一个市场提供哪些模块
boardlab market remove pub --yes                  # 删掉市场和它在本机的复制品
```

`market add` 会把仓库浅克隆到 boardd 的状态目录（`<状态目录>/markets/<市场>`），并记在 `markets.json` 里。boardd 从那里读每个模块的清单（`market.json`），再按配置导入选中的模块。

```sh
boardlab module list                             # boardd 装了哪些模块，在不在跑
boardlab module search 飞书                       # 在装了的和市场里按名字、说明、标签找
boardlab module change pub some-module ./config.json   # 改一个市场模块在 boardd 配置里的设置
```

## 一个市场长什么样

```
<市场>/
  market.json        # 根上的清单：列出它提供哪些模块
  <模块>/
    module.js        # 入口（也可以是 index.js；清单里的 entry 可以指定别的）
    ui.js            # 可选：页面部分，清单里的 ui 指向它
```

`market.json` 在**市场根上**，每个模块一条：

```json
{ "modules": [
  { "id": "images", "title": "镜像", "tags": ["images", "market"],
    "entry": "images/module.js", "ui": "images/ui.js", "inject": [], "provide": [] } ] }
```

`entry` 不写就是 `<模块>/module.js`，再不行 `<模块>/index.js`。`inject` 是它要的服务（别的模块给的），`provide` 是它给的。

模块对着发行版带的 SDK 写：`import { … } from 'boardlab'`。模块的页面部分在浏览器里跑，从同一个地址导入（`boardlab/ui`），所以模块的作者不用关心前端是哪一个。

## 生效时机

- `market add` / `remove`、装模块、卸载：改的是 boardd 加载的东西，重启它之后生效。页面「模块市场」一页有一个「重新加载」：boardd 在 supervisor 下跑的时候，它起一个新进程按现在的配置加载，新连接去新进程，旧进程跑完手上的任务再退——正在刷的机不会被打断。
- `market update` 只把仓库更新到最新提交；页面上「拉取新版本」做的是同一件事。
- 不在 supervisor 下跑的 boardd（比如从源码直接 `serve`）只能手动重启。

页面上「模块市场」一页能做全部这些：加市场（名字 + git 地址）、看每个市场提供什么、安装、卸载、拉取新版本、删掉市场、让 boardd 重新加载。加市场、装模块、卸载只有人能点：它们决定这台机器运行哪些代码。

## 安全

市场里的代码在 boardd 进程里跑，权限和 boardd 一样。只加你信得过的市场；私有市场用 ssh 地址，靠这台机器自己的密钥。

模块的页面文件只从**已经加载**的模块自己的目录里取（`/module-ui/<模块>/<文件>`），市场里别的文件不会被当成网页发出去。
