<!-- more -->

## 一、 架构概览

整个 MCP server 分为三层，自上而下单向依赖：

```
┌─────────────────────────────────────────────────────────┐
│ 进程入口层  src/index.ts                                 │
│   读 package.json、调 startMcpServer()                   │
└──────────────┬──────────────────────────────────────────┘
               │ 启动
┌──────────────▼──────────────────────────────────────────┐
│ Server 层   src/server.ts                                │
│   McpServer 实例 + StdioServerTransport + 退出清理钩子    │
│   遍历 mcpTools 统一 registerTool                        │
└──────────────┬──────────────────────────────────────────┘
               │ 读取 mcpTools（ToolEntry[]）
┌──────────────▼──────────────────────────────────────────┐
│ 工具层      src/tools/                                   │
│   index.ts（聚合） + 7 个工具模块 + 共享辅助              │
│   每个模块导出 {name? , config, handler}                 │
│        │             │            │                      │
│        ▼             ▼            ▼                      │
│   config: 库 description + 库 zod inputSchema            │
│   handler: 调库函数 → 适配器 → MCP content               │
│   适配器: src/adapters/  把库返回值转 ContentItem[]       │
└──────────────────────────────────────────────────────────┘
               │ 调用
┌──────────────▼──────────────────────────────────────────┐
│ @smai-kit/file-utils（第三方库，不改动）                  │
│   read / write / edit / grep / glob / bash               │
│   + listBackgroundTasks / getBackgroundTaskOutput        │
│     / waitForBackgroundTask                              │
│   + getDescription / getXxxDescription                   │
│   + inputSchema / readInputSchema / ...                  │
└──────────────────────────────────────────────────────────┘
```

各组件职责：

| 组件 | 文件 | 职责 | 对应 spec |
|------|------|------|-----------|
| 进程入口 | `src/index.ts` | 启动 server、错误兜底退出 | F1 |
| Server | `src/server.ts` | 创建 McpServer、注册工具、stdio 接入、退出钩子 | F1 / F2 / N2 / N4 |
| 工具聚合 | `src/tools/index.ts` | 收集 9 个工具成 ToolEntry[] | F2 |
| 共享辅助 | `src/tool-registry.ts` | ToolEntry 类型、text()、toErrorResult()、mcpDefineTool() | F2 / F11 / N6 |
| 工具模块 | `src/tools/*.ts` | 每个工具的 config + handler | F3–F11 |
| 适配器 | `src/adapters/*.ts` | 库返回值 → ContentItem[] | F3–F9 |

## 二、 核心数据结构

### ContentItem（MCP 协议类型）

来自 MCP 协议的 `content` 数组元素。本 server 只用到 text / image / resource 三种：

```typescript
type ContentItem =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri: string; mimeType?: string } };
```

### ToolEntry（工具注册条目）

聚合列表的单项。handler 用 `unknown` 异构存储，注册时由 server 统一处理：

```typescript
interface ToolEntry {
  name: string;
  config: {
    description: string;
    inputSchema: unknown; // 库 zod schema（StandardSchemaV1）或 zod object
  };
  handler: (args: unknown) => Promise<{ content: ContentItem[]; isError?: boolean }>;
}
```

### ToolHandlerResult（handler 统一返回）

所有工具 handler 的返回类型，对齐 MCP `tools/call` 的 `result`：

```typescript
type ToolHandlerResult = {
  content: ContentItem[];
  isError?: boolean; // 默认 false；业务错误时为 true
};
```

### AdapterFn（适配器函数签名）

把库的返回值转换为 ContentItem[] 的统一签名：

```typescript
type AdapterFn<T> = (output: T) => ContentItem[];
```

## 三、 核心接口

### 共享辅助（src/tool-registry.ts）

```typescript
/** 构造 text content 块 */
function text(content: string): { type: "text"; text: string };

/** 把库抛出的错误（或任意值）转为 isError:true 的 MCP 响应 */
function toErrorResult(err: unknown): ToolHandlerResult;

/** 构造 ToolEntry（泛型，捕获 handler 自身参数类型后存为 unknown） */
function mcpDefineTool(
  name: string,
  config: { description: string; inputSchema: unknown },
  handler: (args: any) => Promise<ToolHandlerResult>,
): ToolEntry;
```

### Server 启动（src/server.ts）

```typescript
/** 已创建的 McpServer 实例（导出供测试/复用） */
export const server: McpServer;

/** 启动 server：注册清理钩子 + 接入 stdio 传输 */
export async function startMcpServer(): Promise<void>;
```

注册流程（模块加载时执行）：

```typescript
for (const { name, config, handler } of mcpTools) {
  // config.inputSchema 运行时接受库的 zod schema，但 SDK 的 TS 类型要求更窄，
  // 此处断言绕过编译期类型差异（与既有 out/server.js 一致的做法）。
  server.registerTool(name, config as any, handler);
}
```

### 工具适配器（src/adapters/）

每个适配器是一个纯函数，对应一个库返回值类型：

```typescript
// read: ReadOutput（6 分支 + diagnostics）→ ContentItem[]
export const readAdapter: AdapterFn<ReadOutput>;

// write: WriteOutput → ContentItem[]
export const writeAdapter: AdapterFn<WriteOutput>;

// edit: EditOutput → ContentItem[]
export const editAdapter: AdapterFn<EditOutput>;

// grep: GrepOutput → ContentItem[]
export const grepAdapter: AdapterFn<GrepOutput>;

// glob: GlobOutput → ContentItem[]
export const globAdapter: AdapterFn<GlobOutput>;

// bash: BashToolOutput → ContentItem[]
export const bashAdapter: AdapterFn<BashToolOutput>;

// execResult: ExecResult（后台任务 wait 返回）→ ContentItem[]
export const execResultAdapter: AdapterFn<ExecResult>;

/** 把 StructuredPatchHunk[] 序列化为 unified diff 文本 */
function formatPatch(patch: StructuredPatchHunk[]): string;
```

## 四、 模块设计

### 模块 A：进程入口（src/index.ts）

- **职责：** 进程入口，读 package.json 的 name/version，调用 server 启动。
- **对外接口：** 无（进程入口）。
- **依赖：** `src/server.ts` 的 `startMcpServer()`。
- **行为：** `main().catch()` 中把启动失败错误打 stderr 并 `process.exit(1)`。

### 模块 B：Server（src/server.ts）

- **职责：** 创建 McpServer（name/version 来自 package.json）、模块加载时遍历 `mcpTools` 注册全部工具、提供 `startMcpServer()`（注册退出清理钩子 + 接入 StdioServerTransport）。
- **对外接口：** `export const server`、`export async function startMcpServer()`。
- **依赖：** `@modelcontextprotocol/server`（McpServer）、`@modelcontextprotocol/server/stdio`（StdioServerTransport）、`src/tools/index.ts`（mcpTools）。
- **退出清理：** 定义 `registerCleanupHooks()`，用 `exiting` 标志防重复；监听 stdin `end`/`error`（Windows + POSIX 通用）与 SIGINT/SIGTERM（POSIX），统一 `process.exit(0)`。

### 模块 C：工具聚合（src/tools/index.ts）

- **职责：** 导入 9 个工具模块的 `{config, handler}`，用 `mcpDefineTool` 包成 ToolEntry，导出 `mcpTools: ToolEntry[]`。工具顺序：greet 保留、6 个 remote_file_* 主工具、3 个后台任务工具。
- **对外接口：** `export const mcpTools: ToolEntry[]`。
- **依赖：** `src/tool-registry.ts`、各工具模块。
- **扩展性（N6）：** 新增工具只需写一个工具模块并在数组追加一项。

### 模块 D：共享辅助（src/tool-registry.ts）

- **职责：** 提供 `text()`、`toErrorResult()`、`mcpDefineTool()` 三个公共函数与 `ToolEntry` / `ToolHandlerResult` 类型。
- **对外接口：** 见「核心接口」。
- **依赖：** 无外部依赖（纯类型 + 纯函数）。

### 模块 E：适配器层（src/adapters/）

- **职责：** 把库的结构化返回值转为 MCP `ContentItem[]`，纯函数、无副作用、不抛错（错误在 handler 层捕获）。
- **子模块：**
  - `types.ts`：`ContentItem` / `AdapterFn` 类型 + `formatPatch()`（diff 序列化，被 write/edit 复用）。
  - `readAdapter.ts`：6 分支 + diagnostics 追加。
  - `writeAdapter.ts`：create/update 头 + diff。
  - `editAdapter.ts`：路径头 + replaceAll 提示 + diff。
  - `grepAdapter.ts`：按 output_mode 三分支 + appliedLimit 截断提示。
  - `globAdapter.ts`：文件数 + 耗时 + 截断提示。
  - `bashAdapter.ts`：后台任务 → image → stdout/stderr/exit/interrupted → persistedOutput 优先级链。
  - `execResultAdapter.ts`：ExecResult（stdout/stderr/code/interrupted）→ text content。
  - `index.ts`：统一导出。
- **依赖：** `@smai-kit/file-utils`（仅类型 import）。

### 模块 F：工具模块（src/tools/*.ts）

每个工具模块导出一对 `xxxConfig` + `xxxHandler`，结构固定：

```typescript
// 例：grep
export const fileGrepConfig = {
  description: getDescription(), // 库导出的描述
  inputSchema: grepInputSchema(), // 库导出的 zod schema
};

export async function fileGrepHandler(args): Promise<ToolHandlerResult> {
  try {
    const result = await grep(args);       // 调库
    return { content: grepAdapter(result) }; // 适配
  } catch (err) {
    return toErrorResult(err);             // 业务错误 → isError
  }
}
```

9 个工具的库函数映射：

| MCP 工具名 | 库函数 | description 来源 | inputSchema 来源 | 适配器 |
|-----------|--------|------------------|------------------|--------|
| `remote_file_read` | `read` | `getReadDescription()` | `readInputSchema()` | `readAdapter` |
| `remote_file_write` | `write` | `getWriteDescription()` | `writeInputSchema()` | `writeAdapter` |
| `remote_file_edit` | `edit` | `getEditDescription()` | `editInputSchema()` | `editAdapter` |
| `remote_file_grep` | `grep` | `getDescription()` | `grepInputSchema()` (= `inputSchema`) | `grepAdapter` |
| `remote_file_glob` | `glob` | `getGlobDescription()` | `globInputSchema()` | `globAdapter` |
| `remote_file_bash` | `bash` | `getBashDescription()` | `bashInputSchema()` | `bashAdapter` |
| `list_background_tasks` | `listBackgroundTasks` | 自写 | 自写 zod object（无参） | 内联 JSON 序列化 |
| `get_background_task_output` | `getBackgroundTaskOutput` | 自写 | 自写 zod `{taskId}` | 内联（string/null → text） |
| `wait_for_background_task` | `waitForBackgroundTask` | 自写 | 自写 zod `{taskId, timeoutMs?}` | `execResultAdapter` |

> **注意：** grep 的 description/schema getter 名字不带工具前缀（库导出为 `getDescription` / `inputSchema`），其他 5 个带前缀（`getReadDescription` / `readInputSchema` 等）。

### 模块 G：greet 工具（src/tools/greet.ts）

- **职责：** 保留既有 greet demo 工具（保持向后兼容，bin/client 脚本依赖）。
- **实现：** 自写 config（description + 简单 zod `{name}`）+ handler，不依赖库。

## 五、 模块交互

### 启动流程

```
进程启动
  → index.ts main()
    → server.ts startMcpServer()
      → registerCleanupHooks()（挂 stdin/SIGINT/SIGTERM）
      → new StdioServerTransport()
      → server.connect(transport)
  （server.ts 模块加载时已遍历 mcpTools 完成 registerTool）
  → 阻塞等待 stdin 的 JSON-RPC 请求
```

### 工具调用流程（以 remote_file_edit 为例）

```
MCP client (tools/call, name="remote_file_edit", args={...})
  → StdioServerTransport → McpServer 分发
    → fileEditHandler(args)               [src/tools/edit.ts]
      → try: edit(args)                    [@smai-kit/file-utils]
        ← EditOutput
      → editAdapter(result)                [src/adapters/editAdapter.ts]
        ← ContentItem[]
      → return { content }                 [成功路径，isError 缺省 false]
      │
      └ catch (err): toErrorResult(err)    [src/tool-registry.ts]
        ← { content:[text(msg)], isError:true }
  → JSON-RPC 响应回 client
```

### 后台任务交互链

```
remote_file_bash(run_in_background:true)
  → bash() → BashToolOutput{ backgroundTaskId } → bashAdapter → text("Background task: <id>")
  （库内部 registerBackgroundTask，任务在库的内存 Map 中运行）

后续：
list_background_tasks → listBackgroundTasks() → JSON text
get_background_task_output(id) → getBackgroundTaskOutput(id): Promise<string|null> → text
wait_for_background_task(id) → waitForBackgroundTask(id): Promise<ExecResult|null> → execResultAdapter → text
```

## 六、 文件组织

```
src/
├── index.ts                      进程入口：读 pkg、调 startMcpServer
├── server.ts                     McpServer 实例、批量注册、stdio 接入、退出钩子
├── tool-registry.ts              text()/toErrorResult()/mcpDefineTool()/ToolEntry 类型
├── adapters/
│   ├── types.ts                  ContentItem / AdapterFn 类型 + formatPatch()
│   ├── readAdapter.ts            ReadOutput 6 分支 + diagnostics
│   ├── writeAdapter.ts           WriteOutput → create/update 头 + diff
│   ├── editAdapter.ts            EditOutput → 路径头 + replaceAll + diff
│   ├── grepAdapter.ts            GrepOutput 三模式 + 截断提示
│   ├── globAdapter.ts            GlobOutput → 文件列表 + 耗时 + 截断
│   ├── bashAdapter.ts            BashToolOutput → 后台/image/stdout/exit/persisted
│   ├── execResultAdapter.ts      ExecResult（后台 wait 返回）→ text
│   └── index.ts                  统一导出
└── tools/
    ├── index.ts                  聚合 mcpTools: ToolEntry[]
    ├── greet.ts                  保留的 demo 工具
    ├── read.ts                   remote_file_read
    ├── write.ts                  remote_file_write
    ├── edit.ts                   remote_file_edit
    ├── grep.ts                   remote_file_grep
    ├── glob.ts                   remote_file_glob
    ├── bash.ts                   remote_file_bash
    ├── list-background-tasks.ts  list_background_tasks
    ├── get-background-task-output.ts  get_background_task_output
    └── wait-for-background-task.ts    wait_for_background_task
```

## 七、 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| D1 工具命名前缀 | `remote_file_` | 与 docs/remote-file-mcp.md 一致，明确「远端文件」语义，防与 agent 本地工具撞名；后台任务工具不加前缀（它们不是文件操作） |
| D2 inputSchema 来源 | 直接复用库的 zod schema | 已验证 zod v4 下 `z.toJSONSchema()` 对 grep/read/edit 等所有字段（含 `-C`/`-i`/`offset`/`limit` 等 semanticNumber/Boolean 字段）正确导出 number/boolean，无 `type:any` 退化。adapter guide 的 M2 担忧（z.preprocess 丢类型）在 zod v3 才成立，本项目 zod ^4 不受影响。复用可避免双份 schema 漂移 |
| D3 SDK 类型 vs 运行时差异 | registerTool 的 config 参数用 `as any` 断言 | SDK 的 TS 类型要求 `StandardSchemaWithJSON`，比运行时实际接受的 `StandardSchemaV1` 更窄。运行时已验证库 schema 可正常注册（不抛错）。与既有 out/server.js 一致 |
| D4 read image 字段映射 | `file.base64`→`data`、`file.type`→`mimeType` | MCP image content 要求 `data`/`mimeType`，库 ReadOutput 的 image 分支用 `base64`/`type`。adapter guide S2 明确要求重命名 |
| D5 notebook/pdf/parts 处理 | 序列化为 text content | 这三种无原生 MCP 类型（adapter guide S3）。notebook → JSON text；pdf → 提示性 text（base64 过大且 MCP image 仅支持 image/*）；parts → 提示服务端切片 text（客户端无法访问 outputDir） |
| D6 bash 错误退出码 | `returnCodeInterpretation` 追加 `[exit]` text，不设 isError | 库的 bash 即使退出码非 0 也是「成功执行了一条命令」，属正常返回而非业务错误。AI 据退出码自行判断是否重试 |
| D7 bash persistedOutput | 转 resource（`file://` URI） | 适配层无法把大文件内联进 content（adapter guide S5）。注册为 resource 让客户端按需读取。远端部署时该 URI 指向编译服务器本地路径 |
| D8 后台任务 wait 返回类型 | 用 `execResultAdapter` 而非 `bashAdapter` | **spec F9 偏差修正**：库的 `waitForBackgroundTask` 返回 `ExecResult`（stdout/stderr/code/interrupted），不是 `BashToolOutput`（无 isImage/returnCodeInterpretation 等字段）；`getBackgroundTaskOutput` 返回 `string|null`。故 wait 用专门的 execResultAdapter，get 直接 text 化 |
| D9 description 复用库的 getter | 用库的 `getXxxDescription()` | 库的 description 已含详细 usage 指引（如 edit 的「必须先 read」「old_string 唯一匹配」等），复用可保证 AI 看到的工具说明与库行为一致 |
| D10 退出清理跨平台 | stdin end/error + SIGINT/SIGTERM 双管 | Windows 无可靠 SIGTERM，靠 stdin 关闭（MCP client 断开时触发）兜底；POSIX 用信号。`exiting` 标志防重复触发 |
| D11 greet 工具保留 | 保留在工具列表 | bin/cli 与 client/test 脚本依赖其存在；保留不影响新工具，删了反而要同步改脚本（违反 X7） |
| D12 ESM 导入带 .js 后缀 | import 路径写 `.js`（如 `./server.js`） | tsconfig `module: Node16`，编译后 Node ESM 要求带扩展名。源码写 `.js`，tsc 原样保留，运行时解析到对应 `.js` 产物 |

## 八、 编码规范

**编程语言：** TypeScript（`"type": "module"`，ESM）

**适用的语言规范技能：** `ts-lang-spec`

**文件编码规则（ts-lang-spec 优先，以下为兜底）：**
- **新建文件**：UTF-8 无 BOM、LF 换行（与项目 `.prettierrc.mjs` 的 `endOfLine: "lf"` 一致）。ts-lang-spec 另有要求时从其规定。
- **修改已有文件**（硬规则，不得覆盖）：必须保持原文件编码与换行符不变，绝不转换。

**项目既有约定（开发执行者须遵循）：**
- **编译：** `npm run build`（tsc，`module: Node16` → import 路径必须带 `.js` 后缀）。
- **格式化：** `npm run format:check` / `format:fix`（prettier，2 空格、双引号、分号、`arrowParens: always`、`trailingComma: es5`）。
- **版权头：** 新建 `.ts` 文件沿用项目既有 header 块（见 `out/server.js` 的版权头结构：文件名/作者/日期/描述注释块）。
- **命名：** 文件名 kebab-case（如 `list-background-tasks.ts`）；导出标识符 camelCase（`fileGrepConfig`、`fileGrepHandler`）；类型 PascalCase（`ToolEntry`、`ToolHandlerResult`）。
- **注释：** 模块/函数级 JSDoc 注释（中文），与既有源码风格一致；复用 `out/*.js` 中可见的分区注释风格（`// ── xxx ───` 分隔）。

开发阶段编写代码时，必须遵循 ts-lang-spec 中定义的编码风格、命名约定、注释规范等要求。开发执行者应在开始编码前调用 ts-lang-spec 技能，并严格遵守上述文件编码规则。

---

*本文档由 code-spec 技能辅助生成*
