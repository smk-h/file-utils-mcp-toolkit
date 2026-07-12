<!-- more -->

## 一、 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/tool-registry.ts` | text()/toErrorResult()/mcpDefineTool() + ToolEntry/ToolHandlerResult 类型 |
| 新建 | `src/adapters/types.ts` | ContentItem / AdapterFn 类型 + formatPatch() |
| 新建 | `src/adapters/readAdapter.ts` | ReadOutput 6 分支 + diagnostics 适配 |
| 新建 | `src/adapters/writeAdapter.ts` | WriteOutput 适配 |
| 新建 | `src/adapters/editAdapter.ts` | EditOutput 适配 |
| 新建 | `src/adapters/grepAdapter.ts` | GrepOutput 三模式适配 |
| 新建 | `src/adapters/globAdapter.ts` | GlobOutput 适配 |
| 新建 | `src/adapters/bashAdapter.ts` | BashToolOutput 优先级链适配 |
| 新建 | `src/adapters/execResultAdapter.ts` | ExecResult（后台 wait 返回）适配 |
| 新建 | `src/adapters/index.ts` | 统一导出全部适配器 |
| 新建 | `src/tools/greet.ts` | greet demo 工具（保留） |
| 新建 | `src/tools/read.ts` | remote_file_read |
| 新建 | `src/tools/write.ts` | remote_file_write |
| 新建 | `src/tools/edit.ts` | remote_file_edit |
| 新建 | `src/tools/grep.ts` | remote_file_grep |
| 新建 | `src/tools/glob.ts` | remote_file_glob |
| 新建 | `src/tools/bash.ts` | remote_file_bash |
| 新建 | `src/tools/list-background-tasks.ts` | list_background_tasks |
| 新建 | `src/tools/get-background-task-output.ts` | get_background_task_output |
| 新建 | `src/tools/wait-for-background-task.ts` | wait_for_background_task |
| 新建 | `src/tools/index.ts` | 聚合 mcpTools: ToolEntry[] |
| 新建 | `src/server.ts` | McpServer 实例、批量注册、stdio 接入、退出钩子 |
| 修改 | `src/index.ts` | 改为调 startMcpServer()（替换旧 greet 单文件逻辑） |
| 修改 | `client/test-greet.mjs` | 适配新工具名（greet 保留，验证脚本调用对象按需更新） |

> 说明：新建文件均带项目版权头块（见 plan 第八节）；`.gitignore` 已含 `out/`，无需改。`bin/`、`package.json`、`tsconfig.json`、`.prettierrc.mjs` 不动（X7）。

## 二、 任务列表

### T1：共享辅助模块

**文件：** `src/tool-registry.ts`
**依赖：** 无
**步骤：**
1. 写版权头块（文件名/作者/日期/描述注释）
2. 定义 `ToolHandlerResult` 类型（`{ content: ContentItem[]; isError?: boolean }`，ContentItem 从 `./adapters/types.js` 导入——为避免循环依赖，本任务先把 ContentItem 内联定义为本地 type，T2 建好后可改为导入；实际实现采用「本地定义 + 导出」）
3. 定义 `ToolEntry` 接口（`name: string; config: { description: string; inputSchema: unknown }; handler: (args: any) => Promise<ToolHandlerResult>`）
4. 实现 `text(content: string)`：返回 `{ type: "text", text: content }`
5. 实现 `toErrorResult(err: unknown)`：`message = err instanceof Error ? err.message : String(err)`，返回 `{ content: [text(message)], isError: true }`
6. 实现 `mcpDefineTool(name, config, handler)`：返回 `{ name, config, handler }`
7. 全部 `export`

**验证：** `npm run build`（tsc）该文件编译通过、无报错

### T2：适配器类型与 formatPatch

**文件：** `src/adapters/types.ts`
**依赖：** 无
**步骤：**
1. 写版权头块
2. 定义并导出 `ContentItem` 联合类型（text / image / resource 三种，字段对齐 plan 第二节）
3. 定义并导出 `AdapterFn<T>` 类型（`(output: T) => ContentItem[]`）
4. import `StructuredPatchHunk` 类型 from `@smai-kit/file-utils`（仅类型）
5. 实现 `formatPatch(patch: StructuredPatchHunk[]): string`：每个 hunk 输出 `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`，后接 `...lines`，hunk 间换行；空数组返回空字符串

**验证：** `npm run build` 编译通过；`formatPatch([])` 返回 `""`（写个临时 node 脚本或用 node --input-type=module 验证）

### T3：write / edit 适配器

**文件：** `src/adapters/writeAdapter.ts`、`src/adapters/editAdapter.ts`
**依赖：** T2
**步骤：**
1. writeAdapter.ts：写版权头；import `WriteOutput` 类型 from `@smai-kit/file-utils`、`AdapterFn` from `./types.js`、`formatPatch` from `./types.js`
2. 实现 `writeAdapter: AdapterFn<WriteOutput>`：首行 `${output.type === "create" ? "Created" : "Updated"}: ${output.filePath}`；若 `formatPatch(output.structuredPatch)` 非空则换行追加；返回 `[{ type: "text", text }]`
3. editAdapter.ts：写版权头；import `EditOutput` 类型、`AdapterFn`、`formatPatch`
4. 实现 `editAdapter: AdapterFn<EditOutput>`：首行 `Edited: ${output.filePath}`；若 `output.replaceAll` 追加 `(replaced all occurrences)`；追加 formatPatch；返回 `[{ type: "text", text }]`

**验证：** `npm run build` 编译通过

### T4：grep / glob 适配器

**文件：** `src/adapters/grepAdapter.ts`、`src/adapters/globAdapter.ts`
**依赖：** T2
**步骤：**
1. grepAdapter.ts：写版权头；import `GrepOutput` 类型、`AdapterFn`
2. 实现 `grepAdapter: AdapterFn<GrepOutput>`，按 `output.mode` 分支：
   - `files_with_matches` 或 `undefined`：`Found ${numFiles} file(s):` + filenames
   - `content`：`${numLines} line(s) in ${numFiles} file(s):` + content（若有）
   - `count`：`${numMatches} match(es) in ${numFiles} file(s):` + content（若有）
   - 若 `appliedLimit !== undefined`，追加 `(truncated at ${appliedLimit})`
   - 返回 `[{ type: "text", text: lines.join("\n") }]`
3. globAdapter.ts：写版权头；import `GlobOutput` 类型、`AdapterFn`
4. 实现 `globAdapter: AdapterFn<GlobOutput>`：`Found ${numFiles} file(s) in ${durationMs}ms:` + filenames；若 `output.truncated` 追加 `(results truncated to 100 files)`；返回 `[{ type: "text", text }]`

**验证：** `npm run build` 编译通过

### T5：read 适配器（6 分支 + diagnostics）

**文件：** `src/adapters/readAdapter.ts`
**依赖：** T2
**步骤：**
1. 写版权头；import `ReadOutput` 类型 from `@smai-kit/file-utils`、`AdapterFn`、`ContentItem` from `./types.js`
2. 实现 `readAdapter: AdapterFn<ReadOutput>`，建 `items: ContentItem[]`，按 `output.type` switch：
   - `text`：`File: ${filePath} (${numLines} lines, ${startLine}-${startLine+numLines-1} of ${totalLines})` + 换行 + content，push 为 text
   - `image`：字段映射 `output.file.base64`→`data`、`output.file.type`→`mimeType`，push 为 image
   - `notebook`：`Notebook: ${filePath}` + 换行 + `JSON.stringify(cells, null, 2)`，push 为 text
   - `pdf`：`PDF: ${filePath} (${originalSize} bytes, base64 encoded)`，push 为 text
   - `parts`：`File split into ${count} parts at ${outputDir} (server-side only)`，push 为 text
   - `file_unchanged`：`File unchanged: ${filePath}`，push 为 text
3. switch 之后：若 `output.diagnostics && output.diagnostics.length > 0`，构造 `Diagnostics:\n` + 每条 `[${severity}] ${message} (line ${line ?? "?"})`，push 为 text
4. 返回 `items`

**验证：** `npm run build` 编译通过

### T6：bash / execResult 适配器

**文件：** `src/adapters/bashAdapter.ts`、`src/adapters/execResultAdapter.ts`
**依赖：** T2
**步骤：**
1. bashAdapter.ts：写版权头；import `BashToolOutput` 类型、`AdapterFn`、`ContentItem`
2. 实现 `bashAdapter: AdapterFn<BashToolOutput>`，建 `items`，按优先级：
   - 若 `output.backgroundTaskId`：push text `Background task started: ${backgroundTaskId}`；`backgroundedByUser` 追加 `(backgrounded by user request)`；`assistantAutoBackgrounded` 追加 `(auto-backgrounded by assistant)`；**return items**（后续分支不处理）
   - 若 `output.isImage && output.stdout`：push image `{ data: stdout, mimeType: "image/png" }`；否则若 `output.stdout`：push text stdout
   - 若 `output.stderr`：push text `[stderr]\n${stderr}`
   - 若 `output.returnCodeInterpretation`：push text `[exit] ${returnCodeInterpretation}`
   - 若 `output.interrupted`：push text `(command was interrupted)`
   - 若 `output.persistedOutputPath`：push resource `{ uri: \`file://${persistedOutputPath}\`, mimeType: "text/plain" }`
   - 返回 items
3. execResultAdapter.ts：写版权头；import `ExecResult` 类型（从 `@smai-kit/file-utils` 的 `out/utils/ShellCommand.js` 的类型——但该类型未必从主入口导出，需 import 时验证；若未导出则在本地定义结构相同的 type）、`AdapterFn`
4. 实现 `execResultAdapter: AdapterFn<ExecResult>`：若 `stdout` push text；若 `stderr` push `[stderr]\n${stderr}`；若 `code !== 0` push `[exit] code ${code}`；若 `interrupted` push `(command was interrupted)`；返回 items

**验证：** `npm run build` 编译通过；若 ExecResult 未从主入口导出导致类型 import 失败，改为本地 `type ExecResult = { stdout: string; stderr: string; code: number; interrupted: boolean }` 定义

### T7：适配器统一导出

**文件：** `src/adapters/index.ts`
**依赖：** T3、T4、T5、T6
**步骤：**
1. 写版权头
2. `export { readAdapter } from "./readAdapter.js"`
3. `export { writeAdapter } from "./writeAdapter.js"`
4. `export { editAdapter } from "./editAdapter.js"`
5. `export { grepAdapter } from "./grepAdapter.js"`
6. `export { globAdapter } from "./globAdapter.js"`
7. `export { bashAdapter } from "./bashAdapter.js"`
8. `export { execResultAdapter } from "./execResultAdapter.js"`
9. `export { formatPatch } from "./types.js"`
10. `export type { ContentItem, AdapterFn } from "./types.js"`

**验证：** `npm run build` 编译通过

### T8：greet 工具模块

**文件：** `src/tools/greet.ts`
**依赖：** T1
**步骤：**
1. 写版权头；import `* as z from "zod/v4"`、`{ ToolHandlerResult }` from `../tool-registry.js`、`{ text }` from `../tool-registry.js`
2. 定义 `greetConfig = { description: "向指定的人打招呼", inputSchema: z.object({ name: z.string().describe("要打招呼的人的名字") }) }`
3. 定义 `greetHandler({ name }): Promise<ToolHandlerResult>`：返回 `{ content: [text(\`你好，${name}！欢迎使用 file-utils-mcp-toolkit！\`)] }`
4. 导出 `greetConfig`、`greetHandler`

**验证：** `npm run build` 编译通过

### T9：6 个 remote_file_* 主工具模块

**文件：** `src/tools/read.ts`、`write.ts`、`edit.ts`、`grep.ts`、`glob.ts`、`bash.ts`
**依赖：** T1、T7（适配器）
**步骤：**

**read.ts：**
1. 写版权头；import `{ read, readInputSchema, getReadDescription }` from `@smai-kit/file-utils`、`{ readAdapter }` from `../adapters/index.js`、`{ toErrorResult, type ToolHandlerResult }` from `../tool-registry.js`
2. `export const fileReadConfig = { description: getReadDescription(), inputSchema: readInputSchema() }`
3. `export async function fileReadHandler(args): Promise<ToolHandlerResult>`：try 中 `const result = await read(args); return { content: readAdapter(result) }`；catch 返回 `toErrorResult(err)`

**write.ts：** 同结构，库函数 `write`/`writeInputSchema`/`getWriteDescription`，适配器 `writeAdapter`

**edit.ts：** 库函数 `edit`/`editInputSchema`/`getEditDescription`，适配器 `editAdapter`

**grep.ts：** 库函数 `grep`/`inputSchema`（注意 grep 的 schema 名是不带前缀的 `inputSchema`，导入时起别名 `inputSchema as grepInputSchema`）/`getDescription`（起别名 `getDescription as getGrepDescription`），适配器 `grepAdapter`

**glob.ts：** 库函数 `glob`/`globInputSchema`/`getGlobDescription`，适配器 `globAdapter`

**bash.ts：** 库函数 `bash`/`bashInputSchema`/`getBashDescription`，适配器 `bashAdapter`

**验证：** `npm run build` 6 个文件全部编译通过；grep 别名导入正确（grep 的 getter/schema 不带前缀，与其他 5 个不同）

### T10：3 个后台任务工具模块

**文件：** `src/tools/list-background-tasks.ts`、`get-background-task-output.ts`、`wait-for-background-task.ts`
**依赖：** T1、T7
**步骤：**

**list-background-tasks.ts：**
1. 写版权头；import `{ listBackgroundTasks }` from `@smai-kit/file-utils`、`* as z from "zod/v4"`、`{ text, toErrorResult, type ToolHandlerResult }` from `../tool-registry.js`
2. `export const listBackgroundTasksConfig = { description: "列出所有运行中的后台 bash 任务", inputSchema: z.object({}) }`
3. `export async function listBackgroundTasksHandler(): Promise<ToolHandlerResult>`：try 中 `const tasks = listBackgroundTasks(); return { content: [text(JSON.stringify(tasks, null, 2))] }`；catch `toErrorResult`

**get-background-task-output.ts：**
1. 写版权头；import `{ getBackgroundTaskOutput }` from `@smai-kit/file-utils`、`* as z`、`{ text, toErrorResult, type ToolHandlerResult }`
2. `export const getBackgroundTaskOutputConfig = { description: "获取后台 bash 任务的当前输出（非阻塞）", inputSchema: z.object({ taskId: z.string().describe("后台任务 ID") }) }`
3. handler `({ taskId })`：try 中 `const output = await getBackgroundTaskOutput(taskId); return { content: [text(output === null ? \`任务 ${taskId} 不存在或已结束\` : output)] }`；catch `toErrorResult`

**wait-for-background-task.ts：**
1. 写版权头；import `{ waitForBackgroundTask }` from `@smai-kit/file-utils`、`* as z`、`{ text, toErrorResult, type ToolHandlerResult }`、`{ execResultAdapter }` from `../adapters/index.js`
2. `export const waitForBackgroundTaskConfig = { description: "等待后台 bash 任务完成并返回结果", inputSchema: z.object({ taskId: z.string().describe("后台任务 ID"), timeoutMs: z.number().optional().describe("超时毫秒数") }) }`
3. handler `({ taskId, timeoutMs })`：try 中 `const result = await waitForBackgroundTask(taskId, timeoutMs); if (result === null) return { content: [text(\`任务 ${taskId} 不存在\`)] }; return { content: execResultAdapter(result) }`；catch `toErrorResult`

**验证：** `npm run build` 编译通过

### T11：工具聚合

**文件：** `src/tools/index.ts`
**依赖：** T8、T9、T10
**步骤：**
1. 写版权头；import `{ mcpDefineTool }` from `../tool-registry.js`
2. import 9 个工具模块的 config/handler：`{ greetConfig, greetHandler }` from `./greet.js`、`{ fileReadConfig, fileReadHandler }` from `./read.js`、…（write/edit/grep/glob/bash）、`{ listBackgroundTasksConfig, listBackgroundTasksHandler }` from `./list-background-tasks.js`、`{ getBackgroundTaskOutputConfig, getBackgroundTaskOutputHandler }` from `./get-background-task-output.js`、`{ waitForBackgroundTaskConfig, waitForBackgroundTaskHandler }` from `./wait-for-background-task.js`
3. `export const mcpTools: ToolEntry[] = [ mcpDefineTool("greet", greetConfig, greetHandler), mcpDefineTool("remote_file_read", fileReadConfig, fileReadHandler), … 依次 write/edit/grep/glob/bash …, mcpDefineTool("list_background_tasks", listBackgroundTasksConfig, listBackgroundTasksHandler), mcpDefineTool("get_background_task_output", getBackgroundTaskOutputConfig, getBackgroundTaskOutputHandler), mcpDefineTool("wait_for_background_task", waitForBackgroundTaskConfig, waitForBackgroundTaskHandler) ]`
4. import `ToolEntry` 类型 from `../tool-registry.js` 用于标注

**验证：** `npm run build` 编译通过；`mcpTools.length` 应为 9

### T12：Server 模块

**文件：** `src/server.ts`
**依赖：** T11
**步骤：**
1. 写版权头；import `{ McpServer }` from `@modelcontextprotocol/server`、`{ StdioServerTransport }` from `@modelcontextprotocol/server/stdio`、`{ readFileSync }` from `node:fs`、`{ dirname, resolve }` from `node:path`、`{ fileURLToPath }` from `node:url`、`{ mcpTools }` from `./tools/index.js`
2. 读 package.json：`const __dirname = dirname(fileURLToPath(import.meta.url)); const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf-8"))`
3. `export const server = new McpServer({ name: pkg.name, version: pkg.version }, { capabilities: { logging: {} } })`
4. 模块加载时遍历注册：`for (const { name, config, handler } of mcpTools) { server.registerTool(name, config as any, handler); }`（`config as any` 绕过 SDK 类型窄化，见 plan D3）
5. 实现 `registerCleanupHooks()`：`let exiting = false`；`cleanupAndExit(reason)` 打 stderr `[mcp] ${reason}, exiting...` 后 `process.exit(0)`，`exiting` 防重复；监听 `process.stdin.on("end"/"error")`；`for (signal of ["SIGINT","SIGTERM"]) process.on(signal, ...)`
6. `export async function startMcpServer()`：调 `registerCleanupHooks()`、`new StdioServerTransport()`、`await server.connect(transport)`

**验证：** `npm run build` 编译通过；`node -e "import('./out/server.js').then(m=>console.log('server:', !!m.server, 'start:', typeof m.startMcpServer))"` 输出 server 实例存在、startMcpServer 是函数

### T13：进程入口改造

**文件：** `src/index.ts`（修改）
**依赖：** T12
**步骤：**
1. 用 Read 读取当前 `src/index.ts` 确认编码（应为 UTF-8 LF）
2. 替换整个文件内容为：版权头 + `import { startMcpServer } from "./server.js"` + `async function main() { await startMcpServer(); }` + `main().catch((err) => { const msg = err instanceof Error ? err.message : String(err); console.error("MCP Server 启动失败:", msg); process.exit(1); })`
3. 保持原编码（UTF-8 LF）写回

**验证：** `npm run build` 编译通过；`out/index.js` 顶层 import `./server.js`

### T14：测试 client 适配

**文件：** `client/test-greet.mjs`（修改）
**依赖：** T13
**步骤：**
1. Read 当前 `client/test-greet.mjs` 确认编码
2. 该脚本已调用 greet（保留），新增列工具逻辑无需改 greet 调用；但 `tools/list` 会多返回 8 个工具。确认脚本 `console.log` 列出工具列表正常即可，greet 调用逻辑不变
3. 如脚本硬编码了工具数或断言，更新为不依赖具体数量（只打印）
4. 保持原编码写回

**验证：** `node client/test-greet.mjs` 能列出全部 9 个工具且 greet 调用返回正常

## 三、 执行顺序

```
T1 (tool-registry) ──┬──> T8 (greet) ─────────────────┐
                      │                                 │
T2 (adapters/types) ──┼──> T3 (write/edit) ──┐         │
                      ├──> T4 (grep/glob) ───┤         │
                      ├──> T5 (read) ────────┼──> T7 ──┼──> T9 (6 主工具) ──┐
                      └──> T6 (bash/exec) ───┘ (index) │                     │
                                                     │ ├──> T10 (3 后台) ───┤
                                                     │ │                     │
                                                     └─┘                     ├──> T11 (聚合) ──> T12 (server) ──> T13 (入口) ──> T14 (client)
                                                                               │
                                                                               └─────────────────────────────┘
```

线性关键路径：**T1/T2 → T3–T6 → T7 → T9/T10 → T11 → T12 → T13 → T14**

- T1 与 T2 无依赖，可并行起步
- T3、T4、T5、T6 仅依赖 T2，可并行
- T9 与 T10 仅依赖 T1 + T7，可并行
- T8（greet）独立，可在任意时机插入
- T11 必须在所有工具模块（T8/T9/T10）完成后
- T12→T13→T14 严格顺序

每个任务完成后运行 `npm run build` 验证编译；最后 T13/T14 后跑端到端（见 checklist）。

---

*本文档由 code-spec 技能辅助生成*
