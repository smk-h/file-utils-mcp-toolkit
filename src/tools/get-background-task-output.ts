/**
 * =====================================================
 * Copyright © sumu. 2022-present. Tech. Co., Ltd. All rights reserved.
 * File name  : get-background-task-output.ts
 * Author     : sumu
 * Date       : 2026/07/12
 * Description: get_background_task_output 工具 — 取后台任务当前输出（非阻塞）
 * ======================================================
 */

import { getBackgroundTaskOutput } from "@smai-kit/file-utils";
import * as z from "zod/v4";

import {
  text,
  toErrorResult,
  type ToolHandlerResult,
} from "../tool-registry.js";

// ── 工具配置 ────────────────────────────────────────────────
/** get_background_task_output 工具配置：taskId 必填 */
export const getBackgroundTaskOutputConfig = {
  description: "获取后台 bash 任务的当前输出（非阻塞）",
  inputSchema: z.object({
    taskId: z
      .string()
      .describe("后台任务 ID（由 remote_file_bash run_in_background 返回）"),
  }),
};

// ── 工具回调 ────────────────────────────────────────────────
/**
 * get_background_task_output 工具回调：取后台任务当前输出字符串。
 * @param args - 含 taskId
 * @returns 含当前输出的 MCP content；任务不存在时提示；业务错误时 isError:true
 */
export async function getBackgroundTaskOutputHandler(args: {
  taskId: string;
}): Promise<ToolHandlerResult> {
  try {
    const { taskId } = args;
    const output = await getBackgroundTaskOutput(taskId);
    const message = output === null ? `任务 ${taskId} 不存在或已结束` : output;
    return { content: [text(message)] };
  } catch (err) {
    return toErrorResult(err);
  }
}
