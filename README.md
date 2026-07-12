<!-- more -->

## 一、 简介

`file-utils-mcp-toolkit` 是一个基于 [`@smai-kit/file-utils`](https://www.npmjs.com/package/@smai-kit/file-utils) 封装的 **stdio MCP server**，把文件读 / 写 / 编辑 / 搜索 / bash 操作搬到数据所在的编译服务器上，本地 AI 通过 SSH exec 远程调用。

核心思路是「计算搬到数据旁」——不把源码搬到 AI 本地，而是把文件操作工具搬到源码旁边，网络上只回传 AI 真正需要的内容片段。设计目标有三点：

- **零网络文件操作**：读写、搜索都命中编译服务器本地文件系统；
- **对 AI 透明**：工具语义与 AI 自带的本地 `read` / `edit` / `write` 一致，AI 无差别使用；
- **无远程端口暴露**：通过 SSH exec 通道接入，鉴权完全依托 SSH 账号体系。

完整的方案设计、架构图、体验等价性论证见 [`docs/remote-file-mcp.md`](docs/remote-file-mcp.md)；本文聚焦「怎么部署、怎么接入、怎么排错」。

## 二、 工具列表

启动后注册 9 个工具，工具定义在 [`src/tools/index.ts`](src/tools/index.ts#L39-L62)：

| 工具名 | 作用 |
|------|------|
| `remote_file_read` | 按路径 + 可选行号区间读文件（局部读，带行号返回） |
| `remote_file_write` | 全量覆盖写，用于新建文件或整文件重写 |
| `remote_file_edit` | 局部 patch 写，参数对齐本地 edit（`old_str`→`new_str`） |
| `remote_file_grep` | 内容搜索，基于 ripgrep，回传结构化匹配 |
| `remote_file_glob` | 文件名模式匹配，列目录树 |
| `remote_file_bash` | 执行任意命令（make / git / 其他构建工具） |
| `list_background_tasks` | 列出当前后台任务 |
| `get_background_task_output` | 获取后台任务输出 |
| `wait_for_background_task` | 等待后台任务完成 |
| `greet` | 探活工具，用于连通性验证 |

读写、staleness 校验、原子写、ripgrep 调用等复杂逻辑全部由 `@smai-kit/file-utils` 承担，本仓库只写了一层 MCP 协议适配层（声明 inputSchema、转发调用、格式化返回值）。

## 三、 怎么安装？

前置条件：Node.js（建议 LTS 版本）。本工具装在「要操作文件的那台机器上」——在远端编译场景下，就是装在编译服务器上，下面的命令在那台机器上执行。

### 1. 从 npm 全局安装（推荐）

```bash
npm install -g @smai-kit/file-utils-mcp-toolkit
```

安装后生成全局 bin `file-utils-mcp-toolkit`，验证可用：

```bash
which file-utils-mcp-toolkit       # 应输出 bin 绝对路径
file-utils-mcp-toolkit              # 启动后等待 stdin，按 Ctrl+C 退出，确认无报错
```

### 2. 从 GitHub Release 下载离线包安装（跨平台 / 离线环境）

适合**无 npm 访问**的内网 / 离线服务器，或想跳过跨平台 ripgrep / sharp 二进制问题的场景。每次发版（commit message 含 `[release]`）会触发 [GitHub Actions](https://github.com/smk-h/file-utils-mcp-toolkit/actions) 在原生平台 runner 上构建，产出含 `node_modules` + 平台二进制的离线压缩包，挂在 [Releases 页面](https://github.com/smk-h/file-utils-mcp-toolkit/releases)。

#### 2.1 下载对应平台的压缩包

| 平台 | 文件名 |
|------|--------|
| Linux x64 | `file-utils-mcp-toolkit-<版本>-linux-x64-offline.tar.gz` |
| Windows x64 | `file-utils-mcp-toolkit-<版本>-win32-x64-offline.tar.gz` |

> 平台必须匹配：包内 `node_modules/@vscode/ripgrep-{平台}-{架构}/` 与 `node_modules/@img/sharp-{平台}-{架构}/` 的二进制与 OS / 架构绑定，跨平台会启动失败。

#### 2.2 传到目标机器并解压

远端编译场景下，包要装到编译服务器上。先把压缩包传过去：

```bash
# 本地 → 编译服务器
scp file-utils-mcp-toolkit-1.0.0-linux-x64-offline.tar.gz sumu@192.168.1.100:~/
```

在目标机器上解压。压缩包是**扁平结构**——`package.json`、`bin`、`out`、`node_modules` 直接在归档根，没有外层目录。直接 `tar -xzf` 会散落到当前目录，建议先建一个目录再解压进去：

```bash
mkdir file-utils-mcp-toolkit
tar -xzf file-utils-mcp-toolkit-1.0.0-linux-x64-offline.tar.gz -C file-utils-mcp-toolkit
```

#### 2.3 全局安装（跳过编译）

```bash
npm install -g ./file-utils-mcp-toolkit --ignore-scripts
```

- `--ignore-scripts` 跳过 `prepare` 钩子（重新跑 `tsc`），因为离线包里 `out/` 已预编译好；
- 离线包构建时已 `npm prune --omit=dev` 精简掉 devDependencies，`node_modules` 只含运行时依赖 + 目标平台的 ripgrep / sharp 二进制，**全过程不需要联网下载任何东西**。

验证：

```bash
which file-utils-mcp-toolkit                  # 应输出 bin 绝对路径
file-utils-mcp-toolkit                          # 启动后等待 stdin，Ctrl+C 退出，确认无报错
```

#### 2.4 接入配置

装好后用法与第 1 节完全一致——MCP client 通过 SSH 拉起远端 `file-utils-mcp-toolkit` 进程，配置见第四章「远端接入配置」。

#### 2.5 与其他安装方式对比

| 维度 | npm 全局安装 | GitHub 离线包 | 源码构建 |
|------|-------------|---------------|---------|
| 需要联网 | 是（访问 npm registry） | 否 | 是（装依赖） |
| 需要编译 | 否 | 否（预编译 `out/`） | 是（`npm run build`） |
| 跨平台二进制 | 需 `--os` / `--cpu` 或 `--force` 手动处理 | 原生 runner 预装，开箱即用 | 需手动处理 |
| 适合场景 | 默认推荐 | 内网 / 离线 / 跨平台分发 | 本地修改 / 调试 |

### 3. 从源码构建安装

适合需要本地修改、或 npm 上没有所需版本时：

```bash
git clone https://github.com/smk-h/file-utils-mcp-toolkit.git
cd file-utils-mcp-toolkit
npm install        # 含 @smai-kit/file-utils，install 时按本机 OS 下载 ripgrep 二进制
npm run build      # 编译 TypeScript 到 out/
```

构建产物在 `out/`，可直接运行：

```bash
node ./out/index.js
```

或打包成 tgz 再全局安装：

```bash
npm pack
npm install -g file-utils-mcp-toolkit-1.0.0.tgz
```

### 4. 跨平台部署（ripgrep 二进制）

> 若已用第 2 节的 GitHub 离线包安装，平台二进制由原生 runner 预装，可跳过本节。本节适用于 npm 全局安装或源码构建后需要跨平台分发二进制的场景。

本工具依赖 `@smai-kit/file-utils`，后者通过 `@vscode/ripgrep` 调用 ripgrep。`@vscode/ripgrep` 通过 `require.resolve` 沿目录树查找平台二进制，npm 的依赖提升（hoisting）会将 `@vscode/ripgrep` 及其平台包统一放在顶层 `node_modules/@vscode/` 下。因此即便本工具被其他项目作为依赖集成，消费者安装的是 `@smai-kit/file-utils-mcp-toolkit` 而非 `@smai-kit/file-utils`，ripgrep 的解析机制也不受影响。

跨平台部署场景（如在 macOS 上安装、部署到 Linux 服务器，或 CI/CD 构建后分发到其他平台）需要为目标平台准备对应的 ripgrep 二进制，有两种方式。

#### 4.1 方式一：--force 手动安装（保留本地平台 + 目标平台）

```bash
# 1. 正常安装本工具（得到当前平台的 ripgrep）
npm install @smai-kit/file-utils-mcp-toolkit

# 2. 强制安装目标平台的 ripgrep（按需选择其一）
#    部署到 Linux x64 服务器：
npm install @vscode/ripgrep-linux-x64@1.18.0 --force --no-save
#    部署到 Windows x64 服务器：
npm install @vscode/ripgrep-win32-x64@1.18.0 --force --no-save
```

> 版本对齐：`@vscode/ripgrep-{平台}-{架构}` 的版本必须与实际安装的 `@vscode/ripgrep` 版本一致，否则二进制可能不可用。可通过 `npm ls @vscode/ripgrep` 查看版本。

#### 4.2 方式二：--os / --cpu 指定目标平台（推荐，一次性处理所有平台依赖）

```bash
# 部署到 Linux x64 服务器
npm install @smai-kit/file-utils-mcp-toolkit --os=linux --cpu=x64

# 部署到 Windows x64 服务器
npm install @smai-kit/file-utils-mcp-toolkit --os=win32 --cpu=x64
```

`--os` / `--cpu` 对整个依赖树生效，不仅安装目标平台的 ripgrep，还会一并安装 sharp 等其他平台相关依赖的目标平台二进制。适合 CI/CD 纯构建场景，无需逐个手动安装平台包，也没有版本对齐问题。

> 注意：使用此方式后，不要再执行任何不带 `--os` / `--cpu` 的 `npm install` 命令，否则 npm 会按当前真实平台重新解析依赖树，移除已安装的目标平台包。需要两个平台共存时请使用方式一。

#### 4.3 安装后的目录结构

无论通过哪种方式安装，npm 的依赖提升（hoisting）机制会将所有 `@vscode/*` 包平铺到顶层 `node_modules/@vscode/` 下，与依赖层级深度无关：

```
node_modules/
├── @smai-kit/
│   ├── file-utils-mcp-toolkit/        ← 消费者直接安装的上层包
│   └── file-utils/                    ← hoisted 传递依赖
│       └── out/utils/ripgrep.js       ← import { rgPath } from "@vscode/ripgrep"
│
├── @vscode/                           ← 所有 @vscode/* 都 hoisted 到这一层
│   ├── ripgrep/                       ← 主包（JS 包装代码）
│   │   └── lib/index.js               ← require.resolve("@vscode/ripgrep-{平台}-{架构}/bin/rg")
│   ├── ripgrep-linux-x64/             ← 当前平台，npm 自动安装
│   │   └── bin/rg
│   └── ripgrep-win32-x64/             ← --force 手动安装（或 --os 指定的目标平台）
│       └── bin/rg.exe
│
├── @img/                              ← sharp 的平台包，同样 hoisted
│   ├── sharp-linux-x64/
│   └── sharp-libvips-linux-x64/
├── sharp/
└── ... 其他依赖
```

`@vscode/ripgrep/lib/index.js` 中的 `require.resolve` 从自身位置向上查找，在 `node_modules/@vscode/` 这一层找到同级的 `ripgrep-{平台}-{架构}/bin/rg`。因此不管依赖链多深（`file-utils-mcp-toolkit` → `@smai-kit/file-utils` → `@vscode/ripgrep`），只要平台包存在于顶层 `node_modules/@vscode/` 下即可被正确解析。

> 关键：无论哪种安装方式，运行时必须保持**单进程常驻**。库的 staleness 校验依赖进程内 `readFileState`（模块级 `Map`），进程间不共享状态，详见 [`docs/remote-file-mcp.md`](docs/remote-file-mcp.md) 第四章第 5.3 节。stdio 模式天然满足这一约束。

## 四、 远端接入配置

### 1. 基础配置

远端 MCP server 以 stdio 模式启动，本地 MCP client 通过 `ssh` 拉起远端进程，把 stdin / stdout 作为 JSON-RPC 双向通道。不开远程端口，鉴权完全依托 SSH 账号体系（原理详见 [`docs/remote-file-mcp.md`](docs/remote-file-mcp.md) 第二章第 3 节）。

MCP client 是无头进程，stdin / stdout 被 JSON-RPC 占用，无法交互式输密码，所以**必须提前配好 SSH 密钥免密**。

#### 1.1 生成并推送密钥

```bash
# 本地生成密钥对（私钥 passphrase 留空，否则每次连接都要输）
ssh-keygen -t ed25519 -f ~/.ssh/id_build

# 把公钥推到编译服务器（这一步需要输一次服务器密码）
ssh-copy-id -i ~/.ssh/id_build.pub sumu@192.168.1.100
```

> Windows git bash 若无 `ssh-copy-id`，手动追加：
>
> ```bash
> ssh sumu@192.168.1.100 "mkdir -p ~/.ssh && chmod 700 ~/.ssh"
> cat ~/.ssh/id_build.pub | ssh sumu@192.168.1.100 "cat >> ~/.ssh/authorized_keys"
> ssh sumu@192.168.1.100 "chmod 600 ~/.ssh/authorized_keys"
> ```

#### 1.2 MCP 配置（两种 schema）

密钥路径、保活、内联 PATH 一次性配全。两种写法底层都是 `spawn` 一个进程，argv 传给 `ssh` 一样，差别只是 schema 形式。

- **写法一：opencode 风格（`command` 为数组）**

```json
{
  "mcpServers": {
    "file_utils_remote": {
      "type": "local",
      "command": [
        "ssh",
        "-i", "~/.ssh/id_build",
        "-o", "ServerAliveInterval=60",
        "sumu@192.168.1.100",
        "PATH=$HOME/.npm-global/bin:$PATH file-utils-mcp-toolkit"
      ],
      "enabled": true,
      "timeout": 600000
    }
  }
}
```

- **写法二：claudecode / zcode 风格（`command` + `args` 分体）**

```json
{
  "mcpServers": {
    "file_utils_remote": {
      "command": "ssh",
      "args": [
        "-i", "~/.ssh/id_build",
        "-o", "ServerAliveInterval=60",
        "sumu@192.168.1.100",
        "PATH=$HOME/.npm-global/bin:$PATH file-utils-mcp-toolkit"
      ]
    }
  }
}
```

把 `sumu@192.168.1.100` 换成你的账号和服务器 IP，`$HOME/.npm-global/bin` 换成实际的全局 bin 目录（nvm 装的通常是 `~/.nvm/versions/node/v20.x/bin`，路径怎么查见第 3 节排错）。

> 嫌 args 里密钥、保活参数太长？可以把它们收进 `~/.ssh/config`：
>
> ```
> # ~/.ssh/config（Windows: C:\Users\<用户名>\.ssh\config）
> Host build
>     HostName 192.168.1.100
>     User sumu
>     IdentityFile ~/.ssh/id_build
>     ServerAliveInterval 60
> ```
>
> 配置就能用别名 `build`：`"args": ["build", "PATH=$HOME/.npm-global/bin:$PATH file-utils-mcp-toolkit"]`。命令行手动测试也走同一条通道，便于排错。

#### 1.3 验证

```bash
ssh sumu@192.168.1.100 "echo ok"     # 应直接输出 ok，不再问密码
```

打通这一步，MCP 配置就能连上。

#### 1.4 备选：sshpass 明文密码

仅当服务器策略禁止密钥登录时使用，**密码会落盘**，安全性明显低于密钥免密。

```bash
echo 'yourpassword' > ~/.ssh/build.pass && chmod 600 ~/.ssh/build.pass
```

```json
{
  "mcpServers": {
    "file_utils_remote": {
      "command": "sshpass",
      "args": [
        "-f", "~/.ssh/build.pass",
        "ssh",
        "-o", "PreferredAuthentications=password",
        "-o", "PubkeyAuthentication=no",
        "-o", "ServerAliveInterval=60",
        "sumu@192.168.1.100",
        "PATH=$HOME/.npm-global/bin:$PATH file-utils-mcp-toolkit"
      ]
    }
  }
}
```

`-o PubkeyAuthentication=no` 强制走密码、跳过密钥协商，避免在某些环境下卡住。密钥免密是首选，sshpass 仅作兜底。

### 2. 远端命令为什么带 PATH

上面配置的远端命令写成 `PATH=$HOME/.npm-global/bin:$PATH file-utils-mcp-toolkit` 而不是裸 `file-utils-mcp-toolkit`，原因是 SSH 远程命令默认跑在**非登录、非交互、无 PTY** 的 shell 里，全局 bin 目录不在 PATH 中。直接写裸命令名会 `command not found`。

#### 2.1 根因

MCP client 通过 `ssh sumu@ip <command>` 拉起远端进程时，sshd 实际执行的是：

```bash
$SHELL -c "<command>"      # 非交互、非登录
```

这种 shell 调用的关键后果：

- `.bash_profile` / `.profile` **不会被 source**（它们只在 login shell 里跑）；
- `.bashrc` 虽然会被读，但很多发行版的 `.bashrc` 开头有这段拦截，非交互会话直接 `return`：

```shell
case $- in
    *i*) ;;
      *) return;;   # 非交互直接退出
esac
```

于是放在这段拦截**之后**的 nvm / node / 全局 bin 目录的 PATH 设置全部不生效。而 `file-utils-mcp-toolkit` 是 `npm i -g` 装出的全局 bin shim，真实路径只在 profile 执行后才进 PATH——PATH 没建好 → `command not found` → 接入失败。

#### 2.2 不要用 bash -lc

一个看起来合理的修法是用 login shell 包一层：`ssh sumu@ip "bash -lc file-utils-mcp-toolkit"`。这在交互式 SSH 登录（有 PTY）里能工作，但 **MCP client 作为子进程 spawn ssh 时不分配 PTY**（stdin / stdout 是管道），`bash -lc` 会出两个问题：

（1）**可能直接挂起（hang）**：某些 login profile 脚本在检测到无 TTY 时会等待输入或进入交互逻辑，进程卡死不退出，表现为 MCP 接入超时；

（2）**PATH 依旧没加载**：即便没 hang，无 PTY 环境下 profile 加载行为也与交互式不一致。

结论：**无头 MCP 场景下不要用 `bash -lc`**，用下面的内联 PATH。

#### 2.3 解法 A：内联 PATH（默认，第 1 节已用）

直接把 PATH 喂给这条命令，不依赖任何 profile：

```
ssh sumu@ip "PATH=$HOME/.npm-global/bin:$PATH file-utils-mcp-toolkit"
```

远端 shell（`$SHELL -c`）先执行赋值把 npm 全局 bin 塞进 PATH，再解析裸命令名。`$HOME` / `$PATH` 由远端 shell 展开（sshd 保证 HOME 已设置）。零服务器改动、不分配 PTY、不 hang，一次写通。

#### 2.4 解法 B：让 PATH 默认加载（可选）

嫌每次在配置里写 `PATH=...` 啰嗦，可以让全局 bin 目录进「非 login shell 也有的默认 PATH」，之后配置就能裸写命令名：

```json
"command": ["ssh", "sumu@192.168.1.100", "file-utils-mcp-toolkit"]
```

两种改法（在编译服务器上执行，改完无需重启 sshd）：

- **写进 `~/.bashrc` 的拦截之前**：bash 被 sshd 非交互调起时仍会读 `~/.bashrc`，把 export 放到 `case $-` 那段拦截**之前**即可生效：

```shell
# ~/.bashrc 最顶部（务必在 case $- 那段之前）
export PATH="$HOME/.npm-global/bin:$PATH"
```

- **写进 `/etc/environment`**：PAM 读取，对所有 SSH 会话生效（含非交互、非 login），不依赖 shell 初始化脚本。注意要写**绝对路径**，PAM 不做 shell 展开：

```shell
# /etc/environment（需要 sudo）
PATH="/home/sumu/.npm-global/bin:/usr/local/bin:/usr/bin:/bin"
```

改完验证：

```bash
ssh sumu@192.168.1.100 "which file-utils-mcp-toolkit"   # 能输出路径就说明默认加载成功
```

好处是配置最干净；代价是要改服务器（`/etc/environment` 还要 sudo）。多机部署时解法 A 更省事。

### 3. 排错

MCP 接入失败时，先用命令行验证（走的是同一条 SSH 通道）。先按第 1.3 节确认免密登录已打通，再排查 PATH 和进程拉起。注意 MCP client spawn ssh 时**没有分配 PTY**，排查要模拟这个环境，不要用交互式 `ssh sumu@ip` 进 shell 后再跑——那会分配 PTY，掩盖真实问题。

```bash
# 第 1 步：拿全局 bin 目录（在 login shell 里跑，拿到真实路径）
ssh sumu@192.168.1.100 "bash -lc 'echo \$HOME/.npm-global/bin'"
#   或用 npm 查：bash -lc 'npm config get prefix'/bin

# 第 2 步：模拟无 PTY 环境验证内联 PATH 能解析到 bin（不分配 tty）
ssh sumu@192.168.1.100 "PATH=\$HOME/.npm-global/bin:\$PATH which file-utils-mcp-toolkit"
#   能输出路径就说明第 1 节的配置写法可用

# 第 3 步：测 MCP 进程能否拉起（Ctrl+C 退出，确认无报错、不 hang）
ssh sumu@192.168.1.100 "PATH=\$HOME/.npm-global/bin:\$PATH file-utils-mcp-toolkit"
```

> 命令行里的 `$` 要转义成 `\$`，避免被本地 shell 提前展开；写进 MCP 配置 JSON 时则不转义（`$HOME` / `$PATH` 由远端 shell 展开）。

【常见问题】

- 私钥权限过宽（需 `chmod 600 ~/.ssh/id_build`）；
- 服务器未开启公钥认证；
- 跳板机不通；
- 第 3 步 hang 住不退出 → 远端 profile 脚本在无 PTY 下有问题，这正是不要用 `bash -lc` 的原因，改用第 2 节的内联 PATH；
- `which file-utils-mcp-toolkit` 找不到 → 第 1 步拿到的 bin 目录不对，或 bin 没装到全局，需先在远端 `npm i -g @smai-kit/file-utils-mcp-toolkit` 再核对 `npm config get prefix`。

## 五、 运维

### 1. 进程托管（systemd，可选）

默认的按需启动模式（`ssh ... file-utils-mcp-toolkit`）每次接入时启动、断开时退出，架构最简单、无端口暴露，且天然满足单进程常驻要求，**推荐作为默认方案**。

如果希望加速重复接入、减少冷启动延迟，可用 systemd 常驻，但必须保持单实例（不能用 socket 激活多实例，否则破坏 readFileState 共享）：

```ini
# /etc/systemd/system/mcp-file-server.service
[Service]
ExecStart=/usr/bin/node /opt/mcp-file-server/out/index.js
Restart=always
User=mcp
WorkingDirectory=/opt/mcp-file-server
# 通过 ssh 的 stdin/stdout 通信，不监听端口
StandardInput=socket
StandardOutput=socket
```

### 2. 连通性验证

配置完成后，在 AI 会话中验证工具可用：

- 调用 `remote_file_glob` 列出源码根目录，确认能返回结果；
- 调用 `remote_file_read` 读一个已知文件，确认带行号输出正确；
- 调用 `remote_file_grep` 搜索一个已知符号，确认匹配结果正常。

三项都通过，说明远端文件 MCP 已正常工作。也可以先调一次 `greet`（探活工具）确认进程能拉起。

### 3. 重连与保活

- 配置 `ServerAliveInterval=60` 保持 SSH 长连接活跃，避免空闲被服务器 kill；
- 本地 MCP client 实现重连机制，SSH 通道断开后自动重新拉起远端进程；
- 关键操作前做健康检查（如先 `remote_file_glob` 探活，确认进程与文件系统可用）；
- 远端进程崩溃时可借助 systemd 托管实现自动重启（常驻模式下）。

## 六、 进阶

- **方案设计与体验等价论证**：[`docs/remote-file-mcp.md`](docs/remote-file-mcp.md)——双 MCP 架构、read / write / edit / search 四个核心流程的逐流程对比、staleness 四层校验、ripgrep 跨平台二进制等。
- **工具实现**：[`src/tools/`](src/tools/)——每个工具的 Config（inputSchema）与 Handler（转发到 `@smai-kit/file-utils`）。
- **适配层**：[`src/server.ts`](src/server.ts)——McpServer 实例创建、工具批量注册、stdio transport 接入、进程退出清理钩子。
- **进程入口**：[`bin/file-utils-mcp-toolkit-cli.mjs`](bin/file-utils-mcp-toolkit-cli.mjs)——spawn `out/index.js`，npm 全局安装后生成 `file-utils-mcp-toolkit` bin。

---
*本文档由 markdowncli 技能辅助生成*
