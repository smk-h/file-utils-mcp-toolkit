<!-- more -->

## 一、 背景与目标

### 1. 问题场景

AI 编码助手（claudecode / opencode / zcode）运行在 Windows 本地，需要分析、修改位于编译服务器上的源代码。现有本地嵌入式 MCP server 提供的 SSH 工具（`ssh_shell_exec` 等）只能跑命令、回输出，没有「读文件内容到 AI 上下文」的直接路径。

核心矛盾在于：**源码数据在远端磁盘上，AI 的读 / 写工具在本地**。如果让本地工具通过网络去逐文件搬运，搜索和批量读的性能会被网络延迟拖垮。

### 2. 方案定位

在编译服务器上**部署一个专用的文件读写 MCP server**，让所有文件读、写、搜索、构建操作都在编译服务器本地完成。本地 AI 通过 MCP 协议远程调用，网络上只回传 AI 真正需要的内容片段。

这是「计算搬到数据旁」的思路——不把数据搬到计算旁，而是把文件操作工具搬到数据旁边，从根本上消除网络 I/O 瓶颈。

### 3. 设计目标

- **零网络文件操作**：读写、搜索都命中编译服务器本地文件系统；
- **对 AI 透明**：工具语义与 AI 自带的本地 `read` / `edit` / `write` 一致，AI 无差别使用；
- **本地嵌入式 MCP 零改动**：保留 serial / adb / powershell 等绑定本地物理设备的工具；
- **无远程端口暴露**：通过 SSH exec 通道接入，鉴权完全依托 SSH 账号体系。

## 二、 总体架构

### 1. 双 MCP 拆分部署

采用「本地嵌入式 MCP + 远端文件 MCP」的双 MCP 架构，各司其职：

| MCP server | 运行位置 | 职责 | 改动情况 |
|-----------|---------|------|---------|
| **嵌入式 MCP** | Windows 本地 | ssh / serial / adb / powershell / port_scan 等设备交互 | **原样保留，零改动** |
| **文件 MCP** | 编译服务器 | 文件读 / 写 / 搜索 / 构建等源码操作 | **新建**，轻量 |

为什么不把现有 MCP server 整体搬到远端？因为 PowerShell、serial、port_scan 这些工具绑定本地物理设备，搬到远端会失去意义还要做跨平台裁剪。拆分后，本地设备交互与远端源码操作走各自独立的通道，职责清晰、互不干扰。

### 2. 架构图

```
+---------- Windows -----------+                       +------- 编译服务器 ------+
| claudecode / opencode        |                       |                       |
|  ├── 嵌入式 MCP (本地)        | stdin/stdout          |  (不部署)              |
|  │   ssh / serial / adb /    |                       |                       |
|  │   powershell / port_scan  |                       |                       |
|  │                           |                       |                       |
|  └── 文件 MCP (远端)          | MCP over SSH/JSON-RPC | 文件 MCP server (Linux)|
|      remote_file_read/write  | <==================>  | file tools (本地 fs)   |
|      remote_grep / glob      |                       | rg (本地, 库自带)      |
|      remote_bash             |                       | make / git (本地)      |
+------------------------------+                       +-----------------------+
```

### 3. 接入方式：SSH exec + stdio JSON-RPC

远端文件 MCP server 以 `stdio` 模式启动，本地 MCP client 通过 `ssh` 命令拉起远端进程，把 stdin / stdout 作为 JSON-RPC 双向通道。

这种接入方式有两个关键优势：

- **不开远程端口**：所有通信走现有 SSH 通道，不暴露任何新的网络监听端口；
- **鉴权依托 SSH**：复用 SSH 账号体系和密钥认证，无需另建鉴权机制，比裸跑 TCP / SSE 安全得多。

MCP client 配置示例：

```json
{
  "mcpServers": {
    "embedded": {
      "command": "node",
      "args": ["./bin/embedded-mcp-toolkit-cli.js"]
    },
    "remote-src": {
      "command": "ssh",
      "args": ["user@build-server", "node /opt/mcp-file-server/cli.js"]
    }
  }
}
```

MCP client 会把两个 server 的工具合并成一份列表交给 AI。AI 看到的是统一的工具池，不关心工具来自哪个进程。

## 三、 工具设计与接口

### 1. 核心策略：复用 @smai-kit/file-utils，不重新造轮子

本方案的实现策略是**直接复用 `@smai-kit/file-utils` 库**，而非从零实现文件工具。该库内置了 bash / read / write / edit / grep / glob 六个工具，且读写流程全部基于进程内原生 `fs`（详见第四章的流程解析），天生适配远端部署。

远端文件 MCP server 的实际开发量极小——只需写一层薄的 MCP 协议适配层，把库导出的工具函数注册为 MCP tool handler：

```
@claudecode/zcode 等 agent
        ↑ MCP 协议 (stdio JSON-RPC)
        |
[ MCP 适配层 ]  ← 只需开发这一层（注册工具、转发调用）
        |
@smai-kit/file-utils  ← 现成库，read/write/edit/grep/glob/bash 全套
        |
   原生 fs / ripgrep   ← 命中编译服务器本地磁盘
```

这层适配层的职责是：声明工具的 inputSchema、把 MCP 请求参数转发给库函数、把库返回值格式化为 MCP 响应。读写、编辑、搜索的全部复杂逻辑（staleness 校验、原子写、引号归一化、行号格式化等）都由库承担，无需自己实现。

### 2. 职责边界

远端文件 MCP server 是一个**轻量、单一职责**的进程，只做与源码操作相关的事：

- 文件读 / 写 / 局部编辑（`@smai-kit/file-utils` 提供）
- 目录列举 / 内容搜索（`@smai-kit/file-utils` 的 glob / grep）
- 任意命令执行（`@smai-kit/file-utils` 的 bash，可用于 make / git 等）

它**不**负责：SSH 连接管理（由本地 `ssh` 命令承担）、设备交互（由本地嵌入式 MCP 承担）、进程托管（由 systemd 等承担）。因此它不依赖 `ssh2` / `serialport` / `adb` 等重型库，部署到 Linux 几乎无障碍。

### 3. 工具集清单

| MCP 工具名 | 库内对应工具 | 作用 |
|-----------|------------|------|
| `remote_file_read` | `read` | 按路径 + 可选行号区间读文件（局部读，带行号返回） |
| `remote_file_write` | `write` | 全量覆盖写，用于新建文件或整文件重写 |
| `remote_file_edit` | `edit` | 局部 patch 写，参数对齐本地 edit（`old_str`→`new_str`） |
| `remote_file_grep` | `grep` | 内容搜索，基于 ripgrep，回传结构化匹配 |
| `remote_file_glob` | `glob` | 文件名模式匹配，列目录树 |
| `remote_bash` | `bash` | 执行任意命令（make / git / 其他构建工具） |

### 4. 工具语义：与本地工具对齐

库导出的工具 API 语义与 claudecode / zcode / opencode 自带的本地 `read` / `edit` / `write` **高度一致**——这套库本就提取自同类 agent 的源码，是对接同一推理模型的事实标准。对 AI 而言，调用 `remote_file_read` 与本地 `read` 的 token 消耗、返回格式完全相同，AI 无需学习新接口即可无差别使用。

核心语义有三点：

- **read 按行读**：返回带行号的文本，支持 `offset` + `limit` 指定行号区间；
- **edit 字符串精确替换**：`old_str` 必须唯一匹配（文件里只出现一次），否则报错要求补上下文；有 `replace_all` 选项可关闭唯一性约束；
- **write 整文件全量覆盖**：原文件被清空，写入完整新内容。

### 5. 接口速查表

| 工具 | 参数 | 返回 | 失败情形 |
|------|------|------|---------|
| `remote_file_read` | `path`（路径）`offset?`（起始行，默认 1）`limit?`（行数，默认到末尾） | 带行号文本（`行号\t内容`） | 文件不存在 / 是目录 / 超大小限制 |
| `remote_file_write` | `path`（路径）`content`（完整新内容） | 写入确认 + diff 补丁 | 父目录无权限 / 未先 read（已存在文件） |
| `remote_file_edit` | `path`（路径）`old_str`（原文，需唯一匹配）`new_str`（新内容）`replace_all?`（默认 false） | 替换确认 + diff 补丁 | 未先 read / `old_str` 未找到 / 多处匹配且非 `replace_all` / staleness 失败 |
| `remote_file_grep` | `pattern`（模式）`path?`（根目录）`glob?`（文件名过滤）`output_mode?`（content/files_with_matches/count） | 匹配列表（`file:line:content`） | 路径无效 / 无匹配（返回空） |
| `remote_file_glob` | `pattern`（glob 模式）`path?`（根目录） | 文件路径列表 | 路径无效 / 无匹配（返回空） |
| `remote_bash` | `command`（命令）`timeout?`（超时秒数） | stdout + stderr + 退出码 | 命令执行失败 / 超时 / 被权限拦截 |

### 6. 与本地文件操作的对比总览

本节的工具与 claudecode / zcode / opencode 操作本地文件用的工具**同源**——`@smai-kit/file-utils` 本就提取自同类 agent 的源码。下表把远端方案和纯本地方式做一个总览对比，后续第四章的每个流程会展开说明。

| 对比维度 | 本地方式（agent 自带工具） | 远端方式（本方案） | 是否一致 |
|---------|----------------------|-----------------|---------|
| 工具调用语义 | read / edit / write / grep / glob | remote_file_read / edit / write + remote_grep / glob | **完全一致**（同源实现） |
| read 返回格式 | 带行号文本 | 带行号文本 | **完全一致** |
| edit 匹配逻辑 | 读磁盘当前内容找 old_str | 读磁盘当前内容找 old_str | **完全一致** |
| edit 唯一匹配约束 | 是 | 是 | **完全一致** |
| write 全量覆盖 | 是 | 是 | **完全一致** |
| 一致性保证 | edit 内部读磁盘 + staleness 校验 | 同上 | **完全一致** |
| staleness 校验 | mtime 比对 + 内容兜底 | mtime 比对 + 内容兜底 | **完全一致** |
| 原子写 | 临时文件 + rename | 临时文件 + rename | **完全一致** |
| readFileState 共享 | 单进程内 `Map` | 单进程内 `Map` | **完全一致** |
| grep 后端 | 本地 ripgrep（`@vscode/ripgrep`） | 本地 ripgrep（`@vscode/ripgrep`） | **完全一致** |
| 文件位置 | 本地磁盘 | 编译服务器磁盘 | 不同（但都是「进程本地」） |
| 单次调用延迟 | 微秒级 | ~10-20ms（RPC 往返） | 略慢，不影响工作流 |
| 失败模式 | 几乎不失败 | SSH 断连 / 远端进程崩溃 | 需重连机制 |
| 离线能力 | 断网照用 | 断网失明 | 固有差异 |

一句话归纳：**语义层完全一致**（工具同源、校验机制相同），**只有「文件在哪块磁盘上」和「调用要过一次网络」两点不同**——前者靠工具命名 + description 让 AI 知情，后者影响的是健壮性而非编辑体验。第四章会逐流程印证这个结论。

## 四、 核心流程详解

本章是理解本方案的关键。以读、写、编辑、搜索四个核心操作为主线，用流程图展示数据如何流动，并论证为什么远程方案能达到和本地一致的体验。所有 fs 操作都发生在编译服务器本地的 MCP 进程内，数据不经网络中转。

### 1. 读流程：按行切片，只回传目标片段

#### 1.1 读操作时序

```
AI 上下文          远端 MCP 进程                磁盘
    │                  │                       │
    │ read(path,       │                       │
    │   offset=40,     │                       │
    │   limit=20)      │                       │
    │─────────────────>│                       │
    │                  │ readFile(path)        │
    │                  │──────────────────────>│
    │                  │<──────────────────────│ 全文字节流(~100KB)
    │                  │ 按\n切行,取40-59行     │
    │                  │ 加行号格式化           │
    │                  │ 记录 readFileState ──>│(内存Map)
    │<─────────────────│ 只回传这20行           │
    │                  │                      │
  AI 只看到 20 行       其余2980行丢弃,不进上下文
```

#### 1.2 数据流：网络上跑的和 AI 看到的不是同一份

```
编译服务器(远端本地)                         AI 上下文
──────────────────                         ─────────
main.c 共 3000 行, ~100KB

fs.readFile("main.c")
  → 内核读磁盘, 拿到完整字节流(~1ms)
按 \n 切行, 取第 40-59 行(20 行)
加行号格式化
其余 2980 行 → 丢弃(不进上下文)
                                           只收到这 20 行:
                                           40	xxx
                                           41	yyy
                                           ...
                                           59	zzz
```

读操作全程在远端本地完成，磁盘读取 ~1ms；网络上只回传那 20 行（~1KB）。`offset` / `limit` 既省 AI 的 token，也省网络——这是本方案「计算搬到数据旁」的直接收益。

> 关键：read 工具读完后会把 `{content, mtime, offset, limit}` 写入进程内的 `readFileState`（一个模块级 `Map`），供后续 edit / write 做 staleness 校验（见第 3 节编辑流程）。

#### 1.3 对比本地：唯一差异是磁盘在哪

| 维度 | 本地方式 | 远端方式 |
|------|---------|---------|
| 调用语义 | `read(path, offset, limit)` | `remote_file_read`，参数完全一致 |
| 返回格式 | `行号\t内容` | 同左 |
| 切行 / 加行号 | 在 agent 进程内做 | 在远端 MCP 进程内做 |
| readFileState 写入 | 写入 agent 进程的 `Map` | 写入远端 MCP 进程的 `Map` |
| 磁盘读取延迟 | 微秒级 | ~1ms（仍是本地 fs） |

AI 看到的返回内容、格式、行号完全相同，唯一的底层差异是「`fs.readFile` 命中的是哪块磁盘」。因为切行、格式化、readFileState 维护都在工具进程内完成，搬到远端进程后行为不变。

### 2. 写流程：全量覆盖 + 原子写

#### 2.1 全量覆盖是物理事实

不管是 `remote_file_write` 还是 `remote_file_edit`，底层写文件的物理流程都一样：

```
读出整个文件当前内容  →  "AAA...old_str...BBB"
        ↓
内存里做字符串替换    →  "AAA...new_str...BBB"
        ↓
把完整新内容写回文件  →  O_TRUNC 清空 + 写入全部新内容
```

原因纯粹是文件系统的物理限制：`old_str` 和 `new_str` 长度往往不同，替换后后续所有内容要移位，而文件系统不支持「在文件中间插入 / 删除字节」，只能读全文 → 内存替换 → 全量覆盖写回。

> `edit` 的「局部替换」是面向 AI 上下文窗口的省 token 抽象，「全量覆盖」是磁盘的物理事实。两者不矛盾——省的是 AI 的 token，没省磁盘写入量。

#### 2.2 原子写流程：临时文件 + rename

`@smai-kit/file-utils` 的原子写默认开启（非可选），流程如下：

```
                    原子写流程
                    ──────────

    ┌─ 写入临时文件 main.c.tmp.<pid>.<ts>
    │   (flush:true 确保落盘)
    │
    ├─ 应用原文件权限到临时文件(chmod)
    │
    ├─ rename(tmp → main.c)  ← 原子操作
    │   ├─ 成功 → 完成(原文件要么旧要么新,不会半个)
    │   └─ 失败 ─┐
    │            ↓
    └─ 回退: 清理临时文件 + 直接 writeFileSync(覆盖)
```

`rename` 是原子操作——要么看到旧文件、要么看到新文件，不会看到「半个」。最坏情况是「写失败，原文件没变」（临时文件残缺但没 rename），不是「写失败，原文件损坏」。

#### 2.3 写中断风险：本地 fs 窗口极短

```
本地 fs 写入窗口：
  open(O_TRUNC)   ← 清空文件, ~微秒级
  write(data)     ← 写入, ~1-2ms
  close()
  整个窗口：~1-2ms
```

因为全程在编译服务器本地完成，中断的原因只有「断电」「进程崩溃」这类极端事件（文件系统还有日志保护），概率极低。本地操作的中断是「极端事件」而非「日常事件」。再加上原子写（临时文件 + rename）兜底，可靠性足够。

#### 2.4 无模糊失败

本方案的 `fs.writeFile` 在远端进程内完成，成功 / 失败立刻知道，非此即彼。不存在「数据已写入但成功确认丢失」的模糊状态——AI 拿到的结果就是真实结果。

#### 2.5 对比本地：写入机制完全相同

| 维度 | 本地方式 | 远端方式 |
|------|---------|---------|
| 全量覆盖写 | 是 | 是 |
| 原子写（临时文件 + rename） | 默认开启 | 默认开启 |
| 写中断窗口 | ~1-2ms（本地 fs） | ~1-2ms（本地 fs） |
| 符号链接处理 | readlink 到真实目标 | 同左 |
| 权限保持 | chmod 还原原文件权限 | 同左 |
| 写入确认 | 进程内同步返回 | 同左（无模糊失败） |

唯一的底层差异是「写入的目标磁盘在哪」。写入机制（原子写、权限保持、符号链接处理）完全相同——因为本地方式和远端方式用的是**同一套库代码**，只是运行在不同主机的进程里。

> 注意「写中断窗口」一项：远端方案的写入窗口也是 1-2ms，因为写操作本身在编译服务器本地 fs 完成，不走网络。网络只影响「结果回传」，不影响「写入窗口」——这是本方案相对 SFTP 远程写入（窗口 60ms+ 且有网络中断风险）的核心优势。

### 3. 编辑流程：四层校验保证一致性（核心）

编辑流程是本方案最复杂、也最能体现「体验等价」的环节。`remote_file_edit` 内部实现了层层递进的四层校验，全部基于进程内原生 `fs`，确保 AI 每次编辑都基于磁盘最新内容。

#### 3.1 编辑时序图

```
AI上下文      远端MCP进程        readFileState(Map)        磁盘
  │             │                    │                    │
  │ edit(path,  │                    │                    │
  │  old_str,   │                    │                    │
  │  new_str)   │                    │                    │
  │────────────>│                    │                    │
  │             │                                         │
  │             │ ① 查 readFileState                      │
  │             │───────>│ 有无记录?                       │
  │             │<───────┘                                │
  │             │   ├─ 无记录 → 报错"File has not been read yet"
  │             │   └─ 有记录 ↓                            │
  │             │                                         │
  │             │ ② stat 磁盘 mtime                        │
  │             │────────────────────────────────────────>│
  │             │<────────────────────────────────────────│ mtimeMs
  │             │   mtime > 上次read时间?                   │
  │             │   ├─ 是 → 内容比对兜底,不一致则报"unexpectedly modified"
  │             │   └─ 否 ↓                               │
  │             │                                         │
  │             │ ③ readFile 磁盘当前内容(非AI快照!)         │
  │             │────────────────────────────────────────>│
  │             │<────────────────────────────────────────│ 文件全文
  │             │                                         │
  │             │ ④ 在全文找 old_str                       │
  │             │   ├─ 找不到 → 报错"String not found"     │
  │             │   ├─ 多处且非replace_all → 报错"N matches"
  │             │   └─ 唯一匹配 ↓                          │
  │             │                                        │
  │             │ 内存替换 → 临时文件 → rename(原子写)       │
  │             │───────────────────────────────────────>│
  │             │ 更新 readFileState ──>│                 │
  │<────────────│ 返回 diff 补丁                           │
```

#### 3.2 四层校验

| 层级 | 机制 | 代码位置 | 拦截的场景 |
|------|------|---------|-----------|
| 第 1 层 | 必须先 read —— `readFileState` 无记录则拒绝 | `readFileState.get()` | AI 凭空编辑没读过的文件 |
| 第 2 层 | staleness 检测 —— mtime 变化 + 内容比对兜底 | `getFileModificationTime` 与读取时间比对 | 文件自上次 read 后被外部（git pull / 人工）修改 |
| 第 3 层 | edit 读磁盘当前内容匹配 old_str（非上下文快照） | `fs.readFileBytes` 读当前文件 | AI 上下文快照与磁盘不一致 |
| 第 4 层 | old_str 唯一匹配，多处匹配则报错 | `findActualString` + 多匹配计数 | `old_str` 不唯一 / 已不存在 |

四层层层递进，前三层是「防冲突」，第四层是「防误改」。这正是「核心编辑循环体验等价」的根本保证。

#### 3.3 关键认知：edit 读的是磁盘当前内容，不是 AI 记忆

这是理解编辑流程的钥匙。AI 的上下文窗口存的是某个时刻读取的文件快照，而文件是持续变化的。一致性保证**不在 AI 端做版本管理，而是把校验下沉到 edit 工具本身**：

- edit 工具在执行替换时，**读的是磁盘当前内容**（第 3 层），去当前磁盘文件里找 `old_str`——而不是用 AI 上下文里的那份旧快照；
- 这意味着 edit 工具内部隐式做了一次「重读磁盘」，AI 不需要显式重新 read。

```
AI 上下文(t1 快照)              edit 工具实际操作
──────────────                ──────────────────
"AAA...old_str...BBB"          重新读磁盘当前内容(t2)
                               "AAA...XXX...BBB"   ← 别处被改了
构造 old_str → 去 ──────────→  在 t2 里找 old_str
                                  ├─ old_str 区域没变 → 匹配成功 → 替换
                                  └─ old_str 区域变了 → 匹配不到 → 报错
```

当文件已变、`old_str` 匹配不到或匹配多处时，edit 工具报错，AI 重新 read 后基于最新内容重试。这是一种「遇错才重读」的懒策略——靠 edit 读磁盘 + 唯一匹配兜底，多数情况一次过，少数情况报错重读一次。

> 而 handler 的这次读取是远端本地 `fs.readFile`（~1ms），同样「免费」，机制搬过来零额外成本。

#### 3.4 staleness 内容比对兜底

第 2 层 staleness 检测有个细节值得说明：mtime 变了不一定代表内容变了。Windows 上云同步、杀毒软件可能只改 mtime 不改内容。库对此做了兜底——**仅当全量读取时，比对读取时的内容与磁盘当前内容，内容没变则放行**，避免误报。

#### 3.5 对比本地：编辑体验完全等价

编辑流程是「体验等价」最关键的环节。下表逐项对比本地方式和远端方式：

| 维度 | 本地方式 | 远端方式 | 一致？ |
|------|---------|---------|-------|
| 必须先 read | 是（readFileState 校验） | 是 | ✓ |
| staleness 检测 | mtime 比对 + 内容兜底 | mtime 比对 + 内容兜底 | ✓ |
| edit 读哪份内容 | **磁盘当前内容**（非 AI 快照） | **磁盘当前内容**（非 AI 快照） | ✓ |
| old_str 唯一匹配 | 是 | 是 | ✓ |
| 原子写 | 临时文件 + rename | 临时文件 + rename | ✓ |
| readFileState 共享 | agent 进程内 `Map` | MCP 进程内 `Map` | ✓ |
| 报错后恢复流程 | AI 重新 read → 重试 | AI 重新 remote_file_read → 重试 | ✓ |

关键认知：**本地方式和远端方式用的是同一套 edit 代码**（`@smai-kit/file-utils` 的 `FileEditTool.ts`），四层校验、原子写、readFileState 共享一字不差。差异只有两点：

- **readFileState 在哪个进程**：本地方式在 agent 进程，远端方式在 MCP 进程。但只要各自是单进程常驻，read 和 edit 共享同一份 `Map`，行为一致；
- **edit 读的是哪块磁盘**：本地方式读 agent 主机的磁盘，远端方式读编译服务器的磁盘。但都是「`fs.readFile` 本地调用」，~1ms，无网络。

对 AI 而言，调用 `remote_file_edit` 和调用本地 `edit` 的 token 消耗、返回格式、错误信息、重试流程**完全相同**。这就是「编辑体验完全等价」的实证。

### 4. 搜索流程：本地 fork，极快

#### 4.1 搜索数据流

```
AI 上下文        远端 MCP 进程              磁盘
    │                  │                       │
    │ grep(pattern,    │                       │
    │   path="src/")   │                       │
    │─────────────────>│                       │
    │                  │ execFile("rg", [...]) │
    │                  │   本地 fork rg 进程    │
    │                  │──────────────────────>│
    │                  │                       │ rg 扫描本地磁盘
    │                  │                       │ (上万文件秒级)
    │                  │<──────────────────────│ 匹配结果
    │                  │ 格式化结构化输出         │
    │<─────────────────│ 只回传命中的匹配         │
    │                  │                       │
  AI 拿到 file:line:content 列表,网络只传匹配项
```

#### 4.2 ripgrep 自带跨平台二进制

grep / glob 工具通过 `@vscode/ripgrep` 包调用 ripgrep。这个包的特点是**自带对应平台的 ripgrep 二进制**——`npm install` 时会根据 OS 自动下载 Linux / macOS / Windows 版本。

部署到 Linux 编译服务器时：

- `npm install` 自动拉取 Linux 版 ripgrep 二进制；
- `rgPath` 自动指向 Linux 版 `rg`；
- `execFile(rgPath, args)` 在远端本地 fork rg 进程，直接扫描远端磁盘。

零代码改动，搜索体验和本地完全一致（秒级 grep）。这是本方案在「前期了解项目」阶段（高频 grep + 批量读）性能优势的根本来源。

#### 4.3 对比本地：搜索后端完全相同

| 维度 | 本地方式 | 远端方式 |
|------|---------|---------|
| 搜索引擎 | ripgrep（`@vscode/ripgrep`） | ripgrep（`@vscode/ripgrep`） |
| 调用方式 | `execFile(rgPath, args)` | `execFile(rgPath, args)` |
| rg 二进制来源 | npm 安装时按本机 OS 下载 | npm 安装时按编译服务器 OS 下载 |
| 扫描的磁盘 | agent 主机磁盘 | 编译服务器磁盘 |
| 结果格式 | `file:line:content` | `file:line:content` |
| 网络回传 | 无（本地结果直接返回） | 只回传匹配项（不传文件正文） |

本地方式和远端方式用的是**同一个 ripgrep 包、同一套调用代码**，差异只在「rg 进程在哪台主机上 fork、扫哪块磁盘」。对 AI 而言，grep 的参数、结果格式、性能特征（秒级）完全一致。

### 5. 体验等价性总结

#### 5.1 三层归纳

| 层次 | 能否达成 | 说明 |
|------|---------|------|
| **语义一致** | 能达成 | read / write / edit / grep 语义与本地严格对齐，尤其 edit 读磁盘当前内容做匹配（逐流程对比见 1.3 / 2.5 / 3.5 / 4.3）。AI 无差别使用，零学习成本。 |
| **工具完整** | 能达成 | 6 个工具覆盖读 / 写 / 编辑 / 搜索 / 列举 / 命令，没有缺口。少一个，AI 就会退回 `ssh_shell_exec` 跑原始命令，心智模型割裂。 |
| **健壮性一致** | 物理边界，缓解 | 单次延迟（~10-20ms RPC）、SSH 断连、离线失明等无法消除，但不影响「编辑语义等价」。 |

> 换句话说：**语义一致是设计目标（能达成），健壮性一致是物理边界（达成不了，但可缓解）**。只要语义一致，AI 用起来就是一样的；健壮性的差异靠重连、原子写、健康检查去缓解，但不影响「编辑体验等价」这个核心结论。

#### 5.2 源码验证：@smai-kit/file-utils 的实现印证

前文四节的流程论证「为什么能做到体验等价」，这里用库源码做实证。逐一核对读写流程涉及的所有底层操作，它们全部基于 Node.js 原生 `fs`，没有任何进程外的本地状态依赖：

| 操作 | 实现位置 | 调用方式 |
|------|---------|---------|
| 文件读取 | `fsOperations.ts` | `fs.readFile` / `fs.open` |
| 文件属性 | `fsOperations.ts` | `fs.stat` |
| 原子写 | `file.ts` 的 `writeFileSyncAndFlush` | 临时文件 + `renameSync`（默认开启） |
| mtime 获取 | `file.ts` | `statSync` |
| 符号链接处理 | `file.ts` | `readlinkSync` |
| 内容搜索 | `ripgrep.ts` | `execFile(rgPath)` 本地子进程 |
| 状态共享 | `readFileState.ts` | 模块级 `Map`（进程内内存） |

没有任何一处依赖「文件在本地磁盘」这个事实——它依赖的是「`fs` API 在进程内可用」。把整个 MCP server 部署到编译服务器，所有 `fs.*` 调用自然命中远端本地磁盘，语义零变化。

#### 5.3 部署形态约束

staleness 校验成立的前提是 read 和 edit **共享同一份 readFileState**。read 工具读文件后写入它，edit / write 工具编辑前读取它做校验。关键约束：

| 部署形态 | readFileState 是否生效 | staleness 校验是否生效 |
|---------|----------------------|---------------------|
| 单进程常驻（stdio MCP） | 生效，read 和 edit 同进程共享 | 完整生效 |
| 每次请求新进程（无状态 CGI 式） | 失效，进程间不共享 | 失效，每次 edit 都报「未读取」 |

本方案推荐的正是 stdio 模式单进程常驻，完全满足这个约束。edit 源码还特意标注了「原子区」注释——staleness 检查和写入之间不能有 `await` 让出事件循环，单进程 + 原子区设计让这套校验真正可靠。

> 结论：`@smai-kit/file-utils` 天生适配远端部署，**无需重写工具，封装成 stdio MCP server 部署即可获得与本地完全一致的编辑体验。**

## 五、 部署方案

### 1. 远端环境要求

部署前，编译服务器需满足以下条件：

| 条件 | 说明 | 是否必需 |
|------|------|---------|
| SSH 可达 | 本地能通过 `ssh user@build-server` 登录 | **必需** |
| Node.js 运行时 | 用于运行 MCP server，建议 LTS 版本 | **必需** |
| 源码目录可读写 | MCP 运行账号对目标源码目录有相应权限 | **必需** |
| `make` / `git` | 供 `remote_bash` 执行构建 / 版本操作 | 按需 |

> 关于 ripgrep：**不需要在编译服务器上单独安装**。`@smai-kit/file-utils` 依赖 `@vscode/ripgrep` 包，`npm install` 时会根据远端 OS 自动下载对应的 Linux 版 ripgrep 二进制，grep / glob 工具开箱即用（详见第四章第 4.2 节）。
>
> 关于 SFTP：本方案远端文件操作走的是 `fs` 原生调用，完全不依赖 SFTP，无需关心 `sftp-server` 是否启用。

### 2. 远端部署步骤

#### 2.1 上传 MCP server 代码

将文件 MCP server 的代码部署到编译服务器，例如 `/opt/mcp-file-server/`：

```bash
# 在编译服务器上
mkdir -p /opt/mcp-file-server
# 将打包好的代码放到该目录，包括：
#   - cli.js          (MCP 入口，stdio 模式)
#   - package.json    (依赖含 @smai-kit/file-utils 和 MCP SDK)
```

#### 2.2 安装依赖

```bash
cd /opt/mcp-file-server
npm install --production
```

`npm install` 会一并完成两件事：

- 安装 `@smai-kit/file-utils` 及其依赖；
- `@vscode/ripgrep` 的 postinstall 脚本自动下载 Linux 版 ripgrep 二进制到 `node_modules`。

#### 2.3 验证启动

手动启动验证 MCP server 能正常运行（stdio 模式）：

```bash
node /opt/mcp-file-server/cli.js
```

启动后进程会等待 stdin 的 JSON-RPC 输入，此时可按 `Ctrl+C` 退出，确认无报错即可。

> 关键：必须保持单进程常驻，不能每次请求 fork 新进程。库的 staleness 校验依赖进程内 `readFileState`（模块级 `Map`），进程间不共享状态——详见第四章第 5.3 节。stdio 模式天然满足这一约束。

#### 2.4 进程托管（可选）

默认的按需启动模式（`ssh ... node cli.js`）每次接入时启动、断开时退出，架构最简单、无端口暴露，且天然满足单进程常驻要求，**推荐作为默认方案**。

如果希望加速重复接入、减少冷启动延迟，可用 systemd 常驻，但需注意必须保持单实例（不能用 socket 激活多实例，否则破坏 readFileState 共享）：

```ini
# /etc/systemd/system/mcp-file-server.service
[Service]
ExecStart=/usr/bin/node /opt/mcp-file-server/cli.js
Restart=always
User=mcp
WorkingDirectory=/opt/mcp-file-server
# 通过 ssh 的 stdin/stdout 通信，不监听端口
StandardInput=socket
StandardOutput=socket
```

### 3. 本地接入配置

#### 3.1 基础配置

在本地 MCP client 配置中注册远端文件 MCP server（与嵌入式 MCP 并列）：

```json
{
  "mcpServers": {
    "embedded": {
      "command": "node",
      "args": ["./bin/embedded-mcp-toolkit-cli.js"]
    },
    "remote-src": {
      "command": "ssh",
      "args": [
        "build-server",
        "node /opt/mcp-file-server/cli.js"
      ]
    }
  }
}
```

注意上面的 `args` 里直接用了 `build-server` 这个 Host 别名（没有 `user@host`），连接参数（主机、用户、密钥、保活等）全部收进了 `~/.ssh/config`——这是推荐做法，原因见 3.3 节。

#### 3.2 为什么不能在 MCP 配置里用环境变量传密码

一个自然会想到的写法是：给 ssh 配个密码环境变量，或者用 `SSHPASS=xxx sshpass -e ssh ...`。**这条路走不通**，原因有两层。

第一层：SSH 协议本身不接受命令行 / 环境变量传密码。OpenSSH 的 `ssh` 客户端**没有**任何「密码参数」或「密码环境变量」入口——这是 SSH 的安全设计，避免密码出现在命令行（会被 `ps` / 进程列表看到）或环境变量（会被子进程继承、被 `/proc/<pid>/environ` 读取）。所以下面的写法 SSH 根本不认：

```
# ❌ 不存在这样的参数
ssh --password=xxx user@build-server
SSHPASS=xxx ssh ...        # ssh 本身不读 SSHPASS，需要 sshpass 包装
```

第二层（更关键）：MCP 是无头进程，无法交互式输入。MCP client 拉起 `ssh` 子进程时，它的 stdin / stdout 被占用为 JSON-RPC 双向通道：

```
MCP client ───stdin───> ssh 子进程 ───> 编译服务器
         <──stdout───           <───
         (这条通道跑 JSON-RPC 协议,不能塞密码)
```

SSH 的密码提示走 `/dev/tty`（控制终端）而非 stdin，但问题在于：

- **agent 是无头运行的**（claudecode / opencode 后台进程），没有人在终端前输密码；
- SSH 检测到非交互式终端（无 tty）时，密码认证会直接失败或无限卡死；
- 即便用 `sshpass` 把密码喂进去，密码也会出现在配置文件或进程列表里（见 3.4 节的代价）。

结论：**密码必须以非交互方式提前配置好**，让 `ssh` 在无头环境下也能直接建立连接。标准做法是 SSH 密钥免密。

#### 3.3 方案一：SSH 密钥免密（推荐）

一次配置，永久免密。私钥不离本机，安全性高。

- **第 1 步：本地生成密钥对**

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_build
# 私钥 passphrase 留空（否则每次连接都要输 passphrase，等于回到密码问题）
```

> Windows 上路径是 `C:\Users\<用户名>\.ssh\id_build`。

- **第 2 步：把公钥推到编译服务器**（这一步需要输一次服务器密码）

```bash
ssh-copy-id -i ~/.ssh/id_build.pub user@build-server
```

> Windows git bash 若无 `ssh-copy-id`，手动追加：
>
> ```bash
> ssh user@build-server "mkdir -p ~/.ssh && chmod 700 ~/.ssh"
> cat ~/.ssh/id_build.pub | ssh user@build-server "cat >> ~/.ssh/authorized_keys"
> ssh user@build-server "chmod 600 ~/.ssh/authorized_keys"
> ```

- **第 3 步：把连接参数收进 ~/.ssh/config**

```
# ~/.ssh/config（Windows: C:\Users\<用户名>\.ssh\config）
Host build-server
    HostName 192.168.1.100         # 编译服务器 IP 或域名
    User mcpuser                    # 登录账号
    IdentityFile ~/.ssh/id_build    # 私钥路径
    ServerAliveInterval 60          # 保活，避免空闲被服务器 kill
    # 若需跳板机：
    # ProxyJump jumphost.example.com
```

把参数收进 config 而非散落在 MCP 配置里，有两个好处：MCP 配置保持干净（只用 Host 别名）；平时命令行手动测试走的是同一条通道，便于排错。

**第 4 步：验证免密登录**

```bash
ssh build-server "echo ok"          # 应直接输出 ok，不再问密码
```

打通这一步，MCP 配置就能连上。

#### 3.4 方案二：sshpass 明文密码（不推荐，备选）

仅当服务器策略禁止密钥登录时使用。**密码会落盘**，安全性明显低于方案一。

```bash
# 密码存到权限受限的文件（比命令行 -p 明文好）
echo 'yourpassword' > ~/.ssh/build.pass
chmod 600 ~/.ssh/build.pass
```

MCP 配置改为用 `sshpass` 包装 `ssh`：

```json
{
  "mcpServers": {
    "remote-src": {
      "command": "sshpass",
      "args": [
        "-f", "~/.ssh/build.pass",
        "ssh",
        "-o", "PreferredAuthentications=password",
        "-o", "PubkeyAuthentication=no",
        "-o", "ServerAliveInterval=60",
        "user@build-server",
        "node /opt/mcp-file-server/cli.js"
      ]
    }
  }
}
```

`-o PubkeyAuthentication=no` 强制走密码、跳过密钥协商，避免在某些环境下卡住。方案一的密钥免密是首选，sshpass 仅作兜底。

#### 3.5 排错：先在命令行打通

MCP 接入失败时，先用命令行验证（走的是同一条 SSH 通道）：

```bash
ssh build-server "ls /opt/mcp-file-server"     # 测连接 + 目录可见
ssh build-server "node /opt/mcp-file-server/cli.js"  # 测 MCP 进程能否拉起（Ctrl+C 退出）
```

如果 `ssh build-server` 都进不去，MCP 配置必然也连不上。常见问题：私钥权限过宽（需 `chmod 600`）、服务器未开启公钥认证、跳板机不通。

### 4. 验证连通性

配置完成后，在 AI 会话中验证工具可用：

- 调用 `remote_file_glob` 列出源码根目录，确认能返回结果；
- 调用 `remote_file_read` 读一个已知文件，确认带行号输出正确；
- 调用 `remote_file_grep` 搜索一个已知符号，确认匹配结果正常。

三项都通过，说明远端文件 MCP 已正常工作。

## 六、 风险与对策

### 1. 远端进程可用性

【**风险**】

远端文件 MCP server 挂掉，或 SSH 通道断开，AI 将无法操作远端源码。

【**对策**】

- 本地 MCP client 实现重连机制，SSH 通道断开后自动重新拉起远端进程；
- 配置 `ServerAliveInterval=60` 保持 SSH 长连接活跃；
- 关键操作前做健康检查（如先 `remote_file_glob` 探活，确认进程与文件系统可用）；
- 远端进程崩溃时可借助 systemd 托管实现自动重启（常驻模式下）。

### 2. 工具命名冲突

本地嵌入式 MCP 与远端文件 MCP 的工具名不能撞。

【**对策**】

- 远端文件工具统一加 `remote_file_` 前缀，与本地工具区分；
- 工具 `description` 明确说明使用场景（如「读源码用 `remote_file_read` 而非 `ssh_shell_exec "cat"`」），引导 AI 选对工具。

### 3. 鉴权与权限收敛

【**风险**】

MCP server 运行账号若权限过大，可能误操作系统关键文件。

【**对策**】

- SSH 账号权限收敛：MCP server 运行账号应只授予源码目录的读写权限；
- 远端 MCP server 不监听任何网络端口，仅通过 stdio 与本地通信；
- 建议为 SSH 配置专用账号和密钥免密登录。

### 4. 并发写入的一致性

【**风险**】

AI 读 t1 时刻的文件快照后，远端文件被其他进程（如人工编辑、git pull）改到 t2，AI 基于旧快照做 patch 写回会静默覆盖他人改动。

【**对策**】

`@smai-kit/file-utils` 已内置完整的 staleness 校验，无需额外开发（详见第四章第 3.2 节）：

- edit / write 工具在写入前比对 `getFileModificationTime` 与上次读取时间，发现外部修改即报「File unexpectedly modified」，阻止盲目覆盖；
- 对全量读取还做内容比对兜底（mtime 变了但内容没变则放行），避免误报；
- AI 收到报错后重新 `remote_file_read` 获取最新内容再重试即可。

## 七、 落地步骤

### 1. 开发远端文件 MCP server（薄适配层）

基于 `@smai-kit/file-utils` 封装，无需实现读写逻辑，只写一层 MCP 协议适配层。实现要点：

- 用 Node.js + MCP SDK，stdio 模式启动；
- 把 `@smai-kit/file-utils` 导出的 read / write / edit / grep / glob / bash 注册为 MCP tool handler（转发调用 + 格式化返回值）；
- 工具名统一加 `remote_` 前缀，description 注明「操作编译服务器远端文件」；
- 读写、staleness 校验、原子写、ripgrep 调用等复杂逻辑全部由库承担，适配层不做业务处理；
- 保持单进程常驻（库的 readFileState 状态共享依赖此约束，见第四章第 5.3 节）。

### 2. 部署到编译服务器

- 上传代码到 `/opt/mcp-file-server/`；
- `npm install --production` 安装依赖；
- 手动启动验证无报错。

### 3. 本地接入配置

- 在 MCP client 配置中注册 `remote-src` server；
- 配置 SSH 密钥免密 + `ServerAliveInterval`；
- 验证三项连通性（`remote_file_glob` / `remote_file_read` / `remote_file_grep`）。

### 4. 验证 AI 工作流

跑一轮完整的 AI 分析任务，确认：

- AI 能正确选用 `remote_file_*` 工具（而非误用 `ssh_shell_exec "cat"`）；
- 读、改、搜索、构建全流程通畅；
- 性能符合预期（grep 秒级、单文件读毫秒级）。

### 5. 迭代优化

根据实际使用反馈迭代：

- 补充高级工具（如 `remote_file_index` 调 cscope 建符号索引、`remote_file_diff` 做版本对比）；
- 优化大文件分块流式返回；
- 完善错误处理与重连机制。

## 八、 结论

- **核心思想**：在编译服务器上部署一个专用的文件读写 MCP server，让所有文件 / 搜索 / 构建操作都在远端本地完成，本地 AI 通过 SSH exec 的 JSON-RPC 通道远程接入，零端口暴露、鉴权依托 SSH。
- **架构形态**：双 MCP 拆分部署——本地嵌入式 MCP 管设备交互（零改动），远端文件 MCP 管源码读写（新建、轻量），职责清晰互不干扰。
- **体验等价**：远端工具的 read / write / edit 语义与本地工具严格对齐，且 edit 读磁盘当前内容做匹配 + 四层一致性校验（必须先 read / staleness 检测 / 读当前内容 / 唯一匹配），AI 无差别使用，零学习成本。
- **性能优势**：文件操作零网络、无「假局部」问题、写中断窗口极短（1-2ms）、无模糊失败。搜索直接扫描本地磁盘，秒级完成；读单文件毫秒级。
- **实现成本极低**：直接复用 `@smai-kit/file-utils`（内置 bash / read / write / edit / grep / glob），读写流程全部基于进程内原生 `fs`、staleness 校验、原子写、ripgrep 跨平台二进制均已就绪。只需写一层 MCP 协议适配层，无需重新实现文件工具。
- **落地路径**：写薄适配层封装库 → 部署到编译服务器 → 本地接入配置 → 验证 AI 工作流 → 按需迭代高级能力。

本方案兼顾了设备交互刚需（保留本地嵌入式 MCP）和远端源码操作性能（文件 MCP 跑在数据旁），且得益于 `@smai-kit/file-utils` 天然适配远端部署的特性，落地成本极低，是嵌入式开发场景下「AI 分析 / 修改远端源码」的推荐方案。

---
*本文档由 markdowncli 技能辅助生成*
