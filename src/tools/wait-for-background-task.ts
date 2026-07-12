/**
 * =====================================================
 * Copyright © sumu. 2022-present. Tech. Co., Ltd. All rights reserved.
 * File name  : wait-for-background-task.ts
 * Author     : sumu
 * Date       : 2026/07/12
 * Description: wait_for_background_task 工具 — 等待后台任务完成并返回结果
 * ======================================================
 */

import { waitForBackgroundTask } from "@smai-kit/file-utils";
import * as z from "zod/v4";

import { execResultAdapter } from "../adapters/index.js";
import {
  text,
  toErrorResult,
  type ToolHandlerResult,
} from "../tool-registry.js";

// ── 工具配置 ────────────────────────────────────────────────
// 注：库的 waitForBackgroundTask 签名为 (taskId) 单参（实测 arity=1，d.ts 一致），
// adapter guide 的 (taskId, timeoutMs) 两参示例与实际库不符，故此处不暴露 timeoutMs。
/** wait_for_background_task 工具配置：taskId 必填 */
export const waitForBackgroundTaskConfig = {
  description: "等待后台 bash 任务完成并返回执行结果（阻塞）",
  inputSchema: z.object({
    taskId: z
      .string()
      .describe("后台任务 ID（由 remote_file_bash run_in_background 返回）"),
  }),
};

// ── 工具回调 ────────────────────────────────────────────────
/**
 * wait_for_background_task 工具回调：等待后台任务完成，用 execResultAdapter 格式化 ExecResult。
 * 库的 waitForBackgroundTask 返回 ExecResult（非完整 BashToolOutput），故用专门的 execResultAdapter。
 * @param args - 含 taskId
 * @returns 适配后的 MCP content；任务不存在时提示；业务错误时 isError:true
 */
export async function waitForBackgroundTaskHandler(args: {
  taskId: string;
}): Promise<ToolHandlerResult> {
  try {
    const { taskId } = args;
    const result = await waitForBackgroundTask(taskId);
    if (result === null) {
      return { content: [text(`任务 ${taskId} 不存在`)] };
    }
    return { content: execResultAdapter(result) };
  } catch (err) {
    return toErrorResult(err);
  }
}
