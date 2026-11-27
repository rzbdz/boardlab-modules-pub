# 串口免密登录

调试镜像（Bianbu、Ubuntu、Debian 一类）启动到 Linux 以后，串口上是一行登录提示：要先敲账号、再敲密码，才能用 shell。调试内核、看启动、改板子上的文件的人每块板、每次重刷都要来一遍。这个模块把这一步自动化：它登录一次，认出串口上是什么系统，把**串口那一个 getty** 改成免密自动登录。之后串口一打开就是 shell。

## 命令行

```sh
boardlab login-disable k3-a            # 看串口，改成免密（自己拿锁、用完放锁）
boardlab login-disable k3-a --check    # 只看：什么系统、串口是哪个 tty、哪个 getty、现在要不要密码
boardlab login-disable k3-a --undo     # 还原：串口重新要账号密码
boardlab login-disable list            # 哪些板子上开过，现在还在不在
```

`--check` 只读，不拿锁也能跑（它只往串口敲回车、登录，不改任何东西；拿锁的人不会被打断）。`--undo` 和默认的改动要拿锁：它们会敲字、会重启 getty。命令自己拿锁（拿不到就报谁在用），做完放掉；本来就是你拿着的锁不会被动。

模块的设置（`boardd.json` 里 `modules["login-disable"]`）：

| 设置 | 默认 | 说明 |
|---|---|---|
| `accounts` | `root:bianbu,bianbu:bianbu` | 依次尝试的账号密码，`用户:密码`，逗号分开。调试镜像的惯例是第一组 `root`/`bianbu`，第二组 `bianbu`/`bianbu` |
| `user` | `root` | 免密以后以谁登录（root 调试不用再 sudo） |
| `allow` | `bianbu,ubuntu,debian` | 只动这些系统（按 `/etc/os-release` 的 `ID` 或 `ID_LIKE`，所以 Ubuntu、衍生版都算） |

## 它做什么

1. 往串口敲一次回车。已经是 shell 就直接往下走；是登录提示就依次用 `accounts` 登录（密码只在出现 `Password:`/`密码：` 时输入，账号被拒绝就换下一组）。
2. 读 `/etc/os-release`，认出系统；不在 `allow` 里就停下，什么都不改。
3. 读串口是哪个 tty（`tty`，读不到读 `/sys/class/tty/console/active`），找到管它的 getty 单元（`serial-getty@ttyS0.service` 这类），读它现在的 `ExecStart=`。
4. 写一个 drop-in：`/etc/systemd/system/serial-getty@ttyS0.service.d/autologin.conf`，内容是原来的 `ExecStart=` 加上 `--autologin <user>`，第一行是 `# boardlab login-disable` 标记。
5. `systemctl daemon-reload`，重启那个 getty，等串口回来看是新 shell（生效）还是还在要密码（没生效，会直说）。

厂商自己的 unit 文件不改；不发售的板子自带自动登录时，`--undo` 认出文件不是它写的，不会动。

## 还原

`--undo` 删掉它写的那个 drop-in（只删带标记、或它自己记下的那个文件），`daemon-reload`，重启 getty，串口重新要密码。板子重刷以后 drop-in 自然没了，`list` 里那条会显示「开着」但板子上已经不在了：再跑 `--undo` 会说不必，或者直接在板子上删掉那个文件。

## 它是怎么登录的

`consoles.input` 记录「往串口敲了字」，从不记录敲的是什么：密码不会进操作日志。板子重命名（`boardlab rename`）以后记录跟着板子走。它认的是 Debian 系 + systemd；Buildroot、Yocto 这类没有 systemd 的系统会明确拒绝，不会去猜。
