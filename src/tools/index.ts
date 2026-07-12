/**
 * =====================================================
 * Copyright © sumu. 2022-present. Tech. Co., Ltd. All rights reserved.
 * File name  : index.ts
 * Author     : sumu
 * Date       : 2026/07/12
 * Description: 工具聚合注册器 — 导入各工具的 Config/Handler，构建 ToolEntry[]
 * ======================================================
 */

import type { ToolEntry } from "../tool-registry.js";
import { mcpDefineTool } from "../tool-registry.js";

import { fileBashConfig, fileBashHandler } from "./bash.js";
import { fileEditConfig, fileEditHandler } from "./edit.js";
import {
  getBackgroundTaskOutputConfig,
  getBackgroundTaskOutputHandler,
} from "./get-background-task-output.js";
import { fileGlobConfig, fileGlobHandler } from "./glob.js";
import { greetConfig, greetHandler } from "./greet.js";
import { fileGrepConfig, fileGrepHandler } from "./grep.js";
import {
  listBackgroundTasksConfig,
  listBackgroundTasksHandler,
} from "./list-background-tasks.js";
import { fileReadConfig, fileReadHandler } from "./read.js";
import {
  waitForBackgroundTaskConfig,
  waitForBackgroundTaskHandler,
} from "./wait-for-background-task.js";
import { fileWriteConfig, fileWriteHandler } from "./write.js";

// ── 工具列表 ────────────────────────────────────────────────
/**
 * 所有已定义的工具列表（共 9 个）。
 * 添加新工具时只需在此数组中追加一项即可（见 plan N6）。
 */
export const mcpTools: ToolEntry[] = [
  mcpDefineTool("greet", greetConfig, greetHandler),
  mcpDefineTool("remote_file_read", fileReadConfig, fileReadHandler),
  mcpDefineTool("remote_file_write", fileWriteConfig, fileWriteHandler),
  mcpDefineTool("remote_file_edit", fileEditConfig, fileEditHandler),
  mcpDefineTool("remote_file_grep", fileGrepConfig, fileGrepHandler),
  mcpDefineTool("remote_file_glob", fileGlobConfig, fileGlobHandler),
  mcpDefineTool("remote_file_bash", fileBashConfig, fileBashHandler),
  mcpDefineTool(
    "list_background_tasks",
    listBackgroundTasksConfig,
    listBackgroundTasksHandler
  ),
  mcpDefineTool(
    "get_background_task_output",
    getBackgroundTaskOutputConfig,
    getBackgroundTaskOutputHandler
  ),
  mcpDefineTool(
    "wait_for_background_task",
    waitForBackgroundTaskConfig,
    waitForBackgroundTaskHandler
  ),
];
