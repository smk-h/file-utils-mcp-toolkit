<!-- more -->

## 一、 实现完整性

- [ ] **[C1]** 工具注册完整：用 MCP client 调 `tools/list`，返回的工具数量为 9，且名字集合等于 `{greet, remote_file_read, remote_file_write, remote_file_edit, remote_file_grep, remote_file_glob, remote_file_bash, list_background_tasks, get_background_task_output, wait_for_background_task}`（验证：跑 `node client/test-greet.mjs`，观察打印的工具列表，逐项核对）
- [ ] **[C2]** 每个工具的 `tools/list` 条目含 `name`、`description`、`inputSchema` 三个字段，且 `description` 非空（验证：在 C1 的输出里逐个检查字段存在性）
- [ ] **[C3]** 6 个 remote_file_* 主工具的 inputSchema 数值/布尔字段类型正确：grep 的 `-C`/`-A`/`-B`/`context`/`head_limit`/`offset` 为 number、`-n`/`-i`/`multiline` 为 boolean；read 的 `offset`/`limit` 为 integer、`pages` 为 string；edit 的 `replace_all` 为 boolean（验证：在 `tools/list` 响应里 grep 这些字段的 `type`，确认无 `"type":"any"`）
- [ ] **[C4]** 必填字段在 `required` 数组内：grep 的 `pattern`、read/write/edit 的 `file_path`、edit 的 `old_string`/`new_string`、glob 的 `pattern`、bash 的 `command`、后台任务工具的 `taskId`（验证：检查各工具 inputSchema 的 `required` 字段）

## 二、 适配正确性

- [ ] **[C5]** remote_file_read 读文本文件返回 text content，含 `File: <path> (<n> lines, ...)` 头 + 带行号正文（验证：client 调 `remote_file_read` 读 `package.json`，观察返回 content[0].text 含路径头与 `1\t{` 这样的行号前缀）
- [ ] **[C6]** remote_file_read 的 `offset`/`limit` 生效：传 `{file_path, offset:2, limit:1}`，返回头显示起始行 2 且正文仅 1 行（验证：对比不传 offset/limit 的返回）
- [ ] **[C7]** remote_file_read 读图片（png/jpg）返回 image content：`content[0].type === "image"`、`data` 为 base64 字符串、`mimeType` 为 `image/png` 或 `image/jpeg`（验证：临时放一张小 png 到仓库，client 调 read，检查 content 类型）
- [ ] **[C8]** remote_file_read 同文件同范围二次读返回 `file_unchanged` 的 text 提示（`File unchanged: <path>`）（验证：连续两次调 read 同一文件完整读，第二次返回含 "unchanged"）
- [ ] **[C9]** remote_file_read 带 `diagnostics` 时（库注入 diagnosticsProvider 才有，默认无）—— 本项标记为 N/A（适配层不注入 provider，库默认不返回 diagnostics；适配代码分支存在即可，验证靠代码审查）
- [ ] **[C10]** remote_file_write 新建文件返回 text，首行含 `Created: <path>`（验证：client 调 write 写一个新文件 `test-output/new.txt`，检查返回 text）
- [ ] **[C11]** remote_file_write 更新已存在文件返回 text，首行含 `Updated: <path>` 且后续含 unified diff（`@@ -...,... +...,... @@`）（验证：先 read 再 write 同一文件不同内容，检查返回含 diff 行）
- [ ] **[C12]** remote_file_edit 唯一匹配返回 text，含 `Edited: <path>` + diff（验证：read 后 edit 一个唯一字符串，检查返回）
- [ ] **[C13]** remote_file_edit `replace_all` 时返回含 `(replaced all occurrences)` 提示（验证：read 后 edit 一个多处出现的串，传 replace_all:true，检查返回含提示）

## 三、 错误处理

- [ ] **[C14]** 文件不存在：remote_file_read 读不存在路径 → `isError === true`，content[0].text 含路径（验证：client 调 read 不存在文件，检查响应 isError 与消息）
- [ ] **[C15]** 未先 read 就 write/edit 已存在文件 → `isError === true`，消息含 "not been read"（验证：client 直接 edit 一个已存在文件，检查 isError 与消息）
- [ ] **[C16]** edit `old_string` 多匹配且非 replace_all → `isError === true`，消息含 "Found" 与 "matches"（验证：read 后 edit 一个出现 2+ 次的短串，不传 replace_all）
- [ ] **[C17]** grep/glob 路径不存在 → `isError === true`（验证：client 调 grep 传不存在的 path）
- [ ] **[C18]** 所有业务错误均走 `isError:true` 路径，不抛未捕获异常导致进程崩溃或 JSON-RPC error（验证：连续触发 C14-C17，server 进程保持存活，可继续响应下一次正常调用）

## 四、 bash 与后台任务

- [ ] **[C19]** remote_file_bash 普通命令返回 text content，含 stdout（验证：client 调 bash `{command: "echo hello"}`，content[0].text 含 "hello"）
- [ ] **[C20]** remote_file_bash 命令有 stderr 时返回追加 `[stderr]` text 块（验证：client 调 bash `{command: "echo err 1>&2"}`，观察是否多一个含 `[stderr]` 的 content 块）
- [ ] **[C21]** remote_file_bash 非零退出码时返回追加 `[exit]` text 块，但整体 `isError` 缺省/false（验证：client 调 bash `{command: "exit 3"}`，检查有 `[exit]` 块且 isError 不为 true —— 对应 plan D6）
- [ ] **[C22]** remote_file_bash `run_in_background:true` 返回 text 含 `Background task started: <id>`，且 client 不阻塞（验证：client 调 bash `{command: "sleep 2 && echo done", run_in_background: true}`，立即返回含 backgroundTaskId 的 text）
- [ ] **[C23]** list_background_tasks 返回 text，内容为 JSON 数组（验证：先启动一个后台任务（C22），再调 list_background_tasks，检查返回 text 可 JSON.parse）
- [ ] **[C24]** get_background_task_output 传入 C22 的 taskId 返回当前输出 text（验证：启动后台 sleep+echo 任务后，调 get_background_task_output，观察输出）
- [ ] **[C25]** wait_for_background_task 传入 taskId 等到完成返回 text（含 stdout/stderr/exit，来自 execResultAdapter）（验证：调 wait_for_background_task 等待 C22 任务完成，检查返回 text 含 "done"）

## 五、 staleness 与单进程

- [ ] **[C26]** 单进程常驻下，read 后 edit 同一文件通过 staleness 校验（不报 "not been read"）（验证：client 先 read 再 edit 同一文件，edit 成功返回 diff，无 "not been read" 错误）
- [ ] **[C27]** 单进程常驻下，read 后 write 同一文件通过 staleness 校验（验证：client 先 read 再 write 同一文件，write 成功）
- [ ] **[C28]** 适配层无业务逻辑：src/adapters/ 与 src/tools/ 下无自行实现的文件读写、staleness 校验、原子写、ripgrep 调用代码，全部委托库函数（验证：`grep -rn "fs.readFile\|fs.writeFile\|writeFileSync\|renameSync\|statSync" src/` 应无结果；`grep -rn "readFileState" src/` 应无结果 —— 状态管理由库内部维护）

## 六、 deprecated 与编码规范

- [ ] **[C29]** 代码中无 `_DEPRECATED` 标识符引用（验证：`grep -rn "_DEPRECATED" src/` 无结果）
- [ ] **[C30]** MCP SDK 只用当前 API：`grep -rn "Server\b" src/` 仅出现在类型/McpServer 上下文，不直接 new 低层 Server 类、不用 `setRequestHandler`（registerTool 是高层 API）（验证：`grep -rn "setRequestHandler\|ListToolsRequestSchema\|CallToolRequestSchema" src/` 无结果）
- [ ] **[C31]** `npm run build`（tsc）无错误，0 报错（验证：运行命令，观察退出码 0、无 error 输出）
- [ ] **[C32]** `npm run format:check`（prettier）通过（验证：运行命令，无 "would be" 差异）
- [ ] **[C33]** 新建文件均为 UTF-8 无 BOM、LF 换行（验证：`file src/*.ts src/**/*.ts` 或用编辑器/`hexdump` 抽检首字节无 `EF BB BF`；`grep -rl $'\r' src/` 无结果确认无 CRLF）
- [ ] **[C34]** 新建 .ts 文件均含版权头块（文件名/作者/日期/描述注释）（验证：`head -10 src/server.ts src/tools/read.ts src/adapters/types.ts` 等，检查开头有注释块）

## 七、 进程生命周期

- [ ] **[C35]** server 启动后进程常驻、等待 stdin（验证：`node out/index.js` 启动后不退出，等待输入；Ctrl+C 退出码 0）
- [ ] **[C36]** server 名称/版本与 package.json 一致（验证：client `tools/list` 前 server 返回的 initialize 响应里 serverInfo.name === package.json 的 name、serverInfo.version === version）
- [ ] **[C37]** client 断开（关闭 stdin）触发优雅退出，进程退出码 0（验证：client 脚本正常结束后，观察 server 进程退出；Windows 下靠 stdin end，POSIX 下 SIGINT/SIGTERM）
- [ ] **[C38]** SIGINT/SIGTERM 触发优雅退出（验证：Linux/CI 环境下 `kill -INT <pid>` 进程退出码 0，stderr 含 `[mcp] SIGINT received, exiting...`）

## 八、 端到端场景

- [ ] **[C39 端到端 1]** 完整文件编辑循环（对应 spec AC11）：用 MCP client 脚本按序调用——`remote_file_glob`（pattern `**/*.ts`, path `./src`）→ 拿到一个 .ts 文件路径 → `remote_file_read` 读该文件 → `remote_file_edit` 改一行（old_string 取文件中某唯一串，new_string 加一个注释）→ `remote_file_read` 复核改动已生效 → 改回原样（edit 还原）。全链路返回格式正确、无 isError（验证：观察每步返回的 content 与最终文件内容恢复原状）
- [ ] **[C40 端到端 2]** 搜索 + 命令循环：`remote_file_grep`（content 模式搜 `import`）返回匹配正文 → `remote_file_grep`（files_with_matches 模式）返回文件列表 → `remote_file_grep`（count 模式）返回计数 → `remote_file_bash`（`git status --short`）返回 stdout。四种调用返回格式各自正确、无 isError（验证：观察 content/files/count 三种模式输出差异，bash 输出含 git status 内容）
- [ ] **[C41 端到端 3]** 后台任务全生命周期：`remote_file_bash`（`sleep 1 && echo bg-done`, run_in_background:true）拿 taskId → `list_background_tasks` 看到该任务 → `wait_for_background_task` 等到完成返回含 "bg-done" → 任务结束后 `list_background_tasks` 不再列出（或状态变更）。全链路无阻塞、无 isError（验证：观察 taskId 一致性、wait 返回含 bg-done）

---

## 验收报告模板

完成开发后按此模板填写实际结果：

```
## 验收报告

### 通过（N/41）
- [x] C1 — 证据：node client/test-greet.mjs 输出工具列表含 9 个工具，名字集合匹配
- [x] C2 — 证据：...
...

### 未通过（如有）
- [ ] CXX — 预期：X，实际：Y，修复方案：...

### 端到端
- [x] C39 — 结果：glob 返回 src/*.ts 列表 → read 读到内容 → edit 成功 → 复核改动生效 → 还原
- [x] C40 — 结果：...
- [x] C41 — 结果：...
```

**规则：** 先跑命令、看输出，再报状态。证据必须是实际的命令输出或观察到的行为，不能是「应该没问题」。

---

*本文档由 code-spec 技能辅助生成*
