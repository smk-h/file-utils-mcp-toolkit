<!-- more -->

## 一、 背景

`@smai-kit/file-utils-mcp-toolkit` 是一个 MCP server，目标是把 `@smai-kit/file-utils` 库提供的 6 个文件工具（bash / read / edit / grep / glob / write）封装为 MCP 工具，供 AI 编码助手（claudecode / opencode / zcode）通过 MCP 协议调用。底层方案详见 `docs/remote-file-mcp.md`——该 server 通常部署在编译服务器上，让所有文件读写、搜索、构建操作在数据所在的主机本地完成，AI 通过 SSH+stdio 远程接入。

当前仓库现状：

- `src/` 只有旧的 greet 时代 `index.ts`（单工具 demo），**本次从零重写 src/ 全部源码**。
- `out/` 有一份今天编译的 6 工具产物（gitignore，不跟踪），仅作参考，不复用。
- 依赖已就绪：`@smai-kit/file-utils@1.0.2`、`@modelcontextprotocol/server@2.0.0-beta.3`、`zod@^4`。

核心矛盾（来自 `@smai-kit/file-utils/docs/mcp-adapter-guide.md`）：库的工具返回**结构化对象**（如 `ReadOutput` 的 6 种分支、`BashToolOutput` 的图片/后台任务/持久化输出等），而 MCP 协议要求 `content` 数组（text / image / resource）。两者不能直接对接，必须写一层适配层做格式转换。

## 二、 目标

- G1：把库的 6 个工具封装成 6 个 MCP 工具，外加 3 个 bash 后台任务管理工具，共 9 个。
- G2：工具名统一 `remote_file_` 前缀（`remote_file_read` 等），后台任务工具用 `list_background_tasks` / `get_background_task_output` / `wait_for_background_task`。
- G3：返回值按 mcp-adapter-guide **全量适配**为 MCP content——read 的 6 种 type 分支、bash 的 image/后台任务/persistedOutput、edit/write 的 diff、read 的 diagnostics 追加，全部覆盖。
- G4：库 throw 的业务错误统一转 `{ content, isError:true }`，让 AI 自行重试；不使用任何 `_DEPRECATED` 接口。
- G5：保持 stdio 单进程常驻（库的 readFileState staleness 校验依赖此约束）。

## 三、 功能需求

### F1 — MCP server 进程入口

提供 stdio 模式的进程入口，创建 McpServer 实例并接入 StdioServerTransport；server 名称/版本从 package.json 读取。注册进程退出清理钩子（stdin 关闭 / SIGINT / SIGTERM），跨 Windows/Linux 统一触发优雅退出。保持单进程常驻。

### F2 — 工具注册机制

提供统一的工具定义与批量注册能力：每个工具声明自己的 `config`（description + inputSchema）和 `handler`，由一个聚合入口收集成列表后统一注册到 server。

### F3 — remote_file_read

封装库的 `read`。参数透传：`file_path`（必填）、`offset?`、`limit?`、`pages?`。按返回的 `ReadOutput.type` 六分支适配：

- `text` → text content，带文件路径/行数头 + 带行号正文
- `image` → image content（`base64`→`data`、`type`→`mimeType` 字段映射）
- `notebook` → text content（cells 序列化为 JSON）
- `pdf` → text content（提示为 base64 PDF，路径与大小）
- `parts` → text content（提示已在服务端切片，count 与 outputDir）
- `file_unchanged` → text content（提示文件未变更）

若返回带 `diagnostics`，作为附加 text content 追加。

### F4 — remote_file_write

封装库的 `write`。参数透传：`file_path`、`content`。适配返回：`type`（create/update）+ 文件路径头，`structuredPatch` 序列化为 unified diff 文本。

### F5 — remote_file_edit

封装库的 `edit`。参数透传：`file_path`、`old_string`、`new_string`、`replace_all?`。适配返回：文件路径头 + 可选「replaced all」提示 + `structuredPatch` 序列化为 unified diff 文本。

### F6 — remote_file_grep

封装库的 `grep`。参数透传：`pattern`（必填）、`path?`、`glob?`、`output_mode?`、`-B/-A/-C/context?`、`-n?`、`-i?`、`type?`、`head_limit?`、`offset?`、`multiline?`。按 `output_mode` 适配：`content` 模式回传匹配正文；`files_with_matches`/`count` 模式回传文件名列表 + 计数；有 `appliedLimit` 时追加截断提示。

### F7 — remote_file_glob

封装库的 `glob`。参数透传：`pattern`（必填）、`path?`。适配返回：文件数 + 耗时头 + 文件名列表；`truncated` 为真时追加截断提示。

### F8 — remote_file_bash

封装库的 `bash`。参数透传：`command`（必填）、`timeout?`、`description?`、`run_in_background?`、`dangerouslyDisableSandbox?`。适配返回按优先级：

- 后台任务（`backgroundTaskId`）→ 仅返回任务 ID（+ 可选由谁后台化提示），不再处理后续分支
- 图片输出（`isImage`）→ image content（mimeType 默认 image/png）
- 普通 stdout → text content；`stderr` → 追加 `[stderr]` text；`returnCodeInterpretation` → 追加 `[exit]` text；`interrupted` → 追加中断提示
- `persistedOutputPath` → 追加 resource（`file://` URI）

### F9 — 后台任务管理工具（3 个）

- `list_background_tasks`：无参，调用库的 `listBackgroundTasks()`，结果 JSON 序列化为 text。
- `get_background_task_output`：参数 `taskId`（必填），调用库的 `getBackgroundTaskOutput(taskId)`，按 F8 的 bash 适配逻辑格式化输出。
- `wait_for_background_task`：参数 `taskId`（必填）、`timeoutMs?`，调用库的 `waitForBackgroundTask(taskId, timeoutMs?)`，按 F8 的 bash 适配逻辑格式化输出。

### F10 — inputSchema

6 个主工具的 inputSchema **直接复用库导出的 zod schema**（已验证 zod v4 下 `z.toJSONSchema()` 正确导出，无 `type:any` 退化；`semanticNumber/semanticBoolean` 在输入解析侧生效，兼容 LLM 传字符串数字）。3 个后台任务工具用简单的 zod object 定义参数。

### F11 — 错误处理

所有工具 handler 用 try/catch 包裹：库 throw 的业务错误（文件不存在、staleness 失败、`old_string` 未找到/多匹配、超时等）统一转 `{ content:[{type:"text", text: 错误消息}], isError:true }`。不使用任何带 `_DEPRECATED` 后缀的库函数。

## 四、 非功能需求

### N1 — 不使用 deprecated 接口

- MCP 协议层只用 SDK 2.0.0-beta.3 的当前 API：`McpServer`、`registerTool`、`StdioServerTransport`，不触碰已删除/弃用的方法。
- 库层面避开所有带 `_DEPRECATED` 后缀的导出（如 `bashCommandIsSafe_DEPRECATED`、`bashCommandIsSafeAsync_DEPRECATED`）。

### N2 — 单进程常驻约束

server 以 stdio 单进程常驻运行，不 fork 子进程处理请求。这是库 `readFileState`（模块级 Map）staleness 校验生效的前提——read 写入状态、edit/write 读取校验必须在同一进程内。该约束写进工具 description 与进程入口说明，不作为可选项。

### N3 — 适配层薄、无业务逻辑

适配层只做三件事：声明 inputSchema、转发调用给库函数、把库返回值格式化为 MCP content。所有复杂逻辑（staleness 校验、原子写、引号归一化、ripgrep 调用、行号格式化、编码/行尾保持等）全部由库承担，适配层不重新实现、不绕过、不裁剪库的行为。

### N4 — 跨平台

编译产物需在 Windows（开发）与 Linux（编译服务器部署）上运行。注意：

- ripgrep 二进制由 `@vscode/ripgrep` 按 OS 自动下载，无需手工安装。
- 进程退出清理必须覆盖 Windows（stdin 关闭）与 POSIX（SIGINT/SIGTERM）两种信号语义。
- 图片处理依赖 sharp（库自带），PDF 依赖 poppler-utils（可选，缺则 PDF 分支报错降级）。

### N5 — 编码规范（语言：TypeScript）

- 编程语言 TypeScript（`"type": "module"`，ESM）。
- 适用语言规范技能：`ts-lang-spec`。
- 文件编码：新建文件 UTF-8 无 BOM、LF 换行（ts-lang-spec 另有规定时从其规定）；修改已有文件保持原编码不变。
- 复用项目既有工具链：tsc 编译、prettier 格式化（`.prettierrc.mjs`）。
- 复用项目既有的版权头与文件注释风格（参见 `out/server.js` 的 header 块结构）。

### N6 — 可维护的工具扩展

新增一个工具只需写一个工具模块（config + handler）并在聚合入口追加一项，无需改动 server 启动逻辑。工具命名、错误处理、text content 构造等公共能力由共享辅助模块提供。

## 五、 不做的事

### X1 — 不实现 SSH/远程接入逻辑

SSH 通道、密钥免密、`ssh ... node cli.js` 拉起远端进程等全部由本地 MCP client 与 ssh 命令承担，本 server 不含任何网络/SSH 代码。`docs/remote-file-mcp.md` 第五章的部署配置不在本期实现范围内。

### X2 — 不做权限/沙箱/安全验证

库导出的 bash 安全验证（`bashPermissions`、`pathValidation`、`sedValidation`、`readOnlyValidation`、`destructiveCommandWarning` 等）不在本期封装为 MCP 工具或拦截逻辑。bash 命令的权限收敛交给部署侧的 SSH 账号体系（见 remote-file-mcp.md 第六章）。适配层不调任何 `_DEPRECATED` 或权限相关导出。

### X3 — 不实现新的文件工具

不重新实现 read/write/edit/grep/glob/bash 的任何业务逻辑。若库的行为不满足需求，提 issue 给库，不在适配层打补丁。

### X4 — 不做 inputSchema 的手工 JSON Schema

adapter guide 的 M2 担忧（`z.preprocess` 导致 `type:any`）在 zod v4 下已不复存在（已验证）。因此不手写 JSON Schema，直接复用库的 zod schema，避免双份 schema 漂移。

### X5 — 不实现 outputSchema

本期不为工具声明 MCP outputSchema（结构化输出 schema）。返回值适配为 content 数组即可，outputSchema 留作后续增强。

### X6 — 不做测试框架搭建

项目当前 `npm test` 为占位（`echo "Error: no test specified"`）。本期不引入测试框架（vitest/jest 等），验证靠 checklist 的端到端场景（用现有 `client/test-greet.mjs` 风格的 MCP client 脚本手动跑通）。测试体系留作后续。

### X7 — 不动 bin/ 与 client/ 既有脚本

`bin/file-utils-mcp-toolkit-cli.mjs`（拉起 `out/index.js`）与 `client/test-greet.mjs`（测试 client）保持原样，仅按需更新测试 client 的调用对象。package.json 的 `bin`/`main`/`scripts` 字段保持现有结构。

### X8 — 不处理库的 sharp/poppler 原生依赖安装问题

sharp 由库依赖自带，PDF 的 poppler-utils 属系统级依赖。若部署环境缺 poppler，PDF 分支按库自身行为报错/降级，适配层不兜底。

## 六、 验收标准

### AC1（对应 F1）

启动 server 后进程常驻、等待 stdin；client 调 `tools/list` 能返回全部 9 个工具，且 server 名称/版本与 package.json 一致。client 断开（关闭 stdin）或收到 SIGINT/SIGTERM 时进程退出码为 0。

### AC2（对应 F2/F10）

`tools/list` 返回的每个工具都带 `name`、`description`、`inputSchema`；6 个主工具的 inputSchema 中数值/布尔字段（如 grep 的 `-C`/`-i`、read 的 `offset`/`limit`）类型为 number/boolean（非 `any`），必填字段（如 `pattern`/`file_path`/`command`）在 `required` 内。

### AC3（对应 F3）

- 读文本文件 → 返回 text content，含文件路径/行数头与带行号正文；`offset`/`limit` 生效。
- 读图片（png/jpg 等）→ 返回 image content，`data` 为 base64、`mimeType` 为对应 image/*。
- 同文件同范围二次读 → 返回 `file_unchanged` 的 text 提示。
- 文件不存在 → `isError:true`，错误消息含路径。

### AC4（对应 F4/F5）

- write 新文件 → text content 含 `create` + 路径；write 已存在文件需先 read，否则 `isError:true`（"not been read"）；更新成功返回含 unified diff 的 text。
- edit 唯一匹配 → 返回 diff 文本；`old_string` 多匹配且非 `replace_all` → `isError:true`（"Found N matches"）；未先 read → `isError:true`。

### AC5（对应 F6/F7）

- grep content 模式 → 回传匹配正文（file:line:content）；files_with_matches → 文件名列表 + 计数；count → 计数。
- glob → 文件名列表 + 数量 + 耗时；超 100 文件时 `truncated` 提示出现。
- 路径不存在 → `isError:true`。

### AC6（对应 F8）

- bash 普通命令 → stdout 为 text content，stderr 追加 `[stderr]`，退出码异常追加 `[exit]`。
- bash `run_in_background:true` → 返回 `backgroundTaskId` 的 text，不阻塞。
- bash 图片命令（`isImage`）→ image content。

### AC7（对应 F9）

- `list_background_tasks` → 返回任务列表 JSON text。
- 启动一个后台 bash 后，`get_background_task_output(taskId)` 能取到当前输出；`wait_for_background_task(taskId)` 能等到完成并返回最终输出。

### AC8（对应 F11/N1）

代码中不出现任何 `_DEPRECATED` 标识符的引用；所有工具 handler 的业务错误路径返回 `isError:true` 而非抛 JSON-RPC error。

### AC9（对应 N2/N3）

单进程常驻下，read 后 edit/write 同一文件能通过 staleness 校验（不报 "not been read"）；适配层无业务逻辑——不出现自己实现的文件读写/搜索/原子写代码，全部委托库函数。

### AC10（对应 N5）

`npm run build`（tsc）无错误；`npm run format:check` 通过；新文件为 UTF-8 无 BOM、LF 换行。

### AC11（端到端）

用 MCP client 脚本跑完整流程：`remote_file_glob` 列目录 → `remote_file_read` 读文件 → `remote_file_edit` 改一行 → `remote_file_read` 复核改动 → `remote_file_grep` 搜符号 → `remote_file_bash` 跑命令。全链路返回格式正确、无报错。

---

*本文档由 code-spec 技能辅助生成*
