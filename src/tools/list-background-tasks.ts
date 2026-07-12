/**
 * =====================================================
 * Copyright © sumu. 2022-present. Tech. Co., Ltd. All rights reserved.
 * File name  : list-background-tasks.ts
 * Author     : sumu
 * Date       : 2026/07/12
 * Description: list_background_tasks 工具 — 列出后台 bash 任务
 * ======================================================
 */

import { listBackgroundTasks } from "@smai-kit/file-utils";
import * as z from "zod/v4";

import {
  text,
  toErrorResult,
  type ToolHandlerResult,
} from "../tool-registry.js";

// ── 工具配置 ────────────────────────────────────────────────
/** list_background_tasks 工具配置：无参 */
export const listBackgroundTasksConfig = {
  description: "列出所有运行中的后台 bash 任务",
  inputSchema: z.object({}),
};

// ── 工具回调 ────────────────────────────────────────────────
/**
 * list_background_tasks 工具回调：调用库的 listBackgroundTasks，结果 JSON 序列化为 text。
 * @returns 含任务列表 JSON 的 MCP content；业务错误时 isError:true
 */
export async function listBackgroundTasksHandler(): Promise<ToolHandlerResult> {
  try {
    const tasks = listBackgroundTasks();
    return { content: [text(JSON.stringify(tasks, null, 2))] };
  } catch (err) {
    return toErrorResult(err);
  }
}
