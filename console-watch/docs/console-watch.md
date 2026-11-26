# 串口监控

老化测试、长跑、还有「这行一出现就告诉我」：让板子自己喊。串口监控把一个或几个匹配绑到一块或所有板子上，在串口输出里找它们，找到了（或者该来的不来了）就发到[通知总线](notifications.md)，由渠道规则决定推到飞书群、页面，还是两边都推。

监控**只看不发**：不往串口打字、不拿板子的锁，所以老化跑在自己的租约里，监控在旁边看，互不打扰。一个监控可以同时盯十块板子。

## 快速上手：十块板子一起老化

```sh
boardlab list                                   # 有哪十块板子
boardlab alerts channel add lab <飞书 webhook> --title BOARDLAB告警群 --topic aging,failed

# 一个监控盯所有板子：出现 panic 或 login: 就报警
boardlab watch console add aging-1 --boards '*' --title 老化 re:panic 'str:login:'
boardlab watch console start aging-1            # 盯上现在的所有板子；以后新接上的也会盯上
boardlab watch console list                     # 盯哪些板子、触发过几次
```

`--boards '*'` 就是「这台 boardd 的所有板子」，包括开始之后才扫描到的。也可以点名：`--boards board-1,board-2`。`start` 时还能临时改目标（`--boards`、`--patterns`）。

## 匹配怎么写

| 写法 | 意思 |
|---|---|
| `re:panic.*` | 正则 |
| `panic.*` | 不写前缀也当正则 |
| `str:login:` | 原文匹配（点、星号、括号都当普通字符） |
| `re:timeout\|hang` | 两个都算（正则的 `\|`） |
| `re:error i` | 末尾一个 `i`：不分大小写 |
| 多条 | 逗号分开，或者在命令行上写多个位置参数 |

写错了在**加监控的时候**就报错，不会等到板子跑起来才炸。

## 两种模式

- **命中即告警**（默认，`--mode line`）：串口输出某一行对上了，就发一条。一块板子上同一条噪声最多五秒发一次，不会刷屏。
- **缺行告警**（`--mode absent`）：反过来——你给的是**健康的运行会打印的那一行**（心跳、进度、`still alive`），它长时间不出现才是问题。这是挂死、卡住的那种老化最需要的。

```sh
# 心跳每 30 秒一行；两分钟没看到就当挂了
boardlab watch console add soak-1 --boards '*' --mode absent --silent 120 'str:heartbeat'
boardlab watch console start soak-1
```

`--silent <秒>` 是多久没看到算挂（默认 600 秒）。计时从开始盯、或者从最近看到的**任何一行**算起：一直有输出就不算静默，哪怕没有你要的那一行。缺行告警在挂住之后每分钟再提醒一次，直到你停下它。

## 通知去哪里

监控只负责发到通知总线（`topic: aging`，标签是这个监控的 id 和板名）。推到哪里由渠道规则决定：

```sh
# 这个飞书群只收 aging-1 的
boardlab alerts channel add soak https://open.feishu.cn/open-apis/bot/v2/hook/<webhook> --title 老化群 --tag aging-1
```

于是老化群收老化，告警群收失败，页面两样都能看到。详见[通知](notifications.md)。

## 别的东西也能报

外部脚本、流水线里自己判定的问题，直接发到总线，不用自己写飞书：

```sh
boardlab alerts raise "aging-1：10 块里有 2 块掉线" --topic aging --tag aging-1
```

## 命令行

```sh
boardlab watch console [list]                        # 有哪些监控，在不在跑，触发过几次
boardlab watch console add <id> [--boards a,b|*] [--title 名字] [--mode line|absent] [--silent 秒] <匹配…>
boardlab watch console start <id> [--boards …] [--patterns …]
boardlab watch console stop <id>
boardlab watch console remove <id> --yes
```

页面上「串口监控」一页能做同样的事：加监控（含缺行多久算挂）、开始、停下、删掉。
