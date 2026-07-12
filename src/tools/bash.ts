/**
 * =====================================================
 * Copyright © sumu. 2022-present. Tech. Co., Ltd. All rights reserved.
 * File name  : bash.ts
 * Author     : sumu
 * Date       : 2026/07/12
 * Description: remote_file_bash 工具 — 封装 @smai-kit/file-utils 的 bash
 * ======================================================
 */

import {
  bash,
  bashInputSchema,
  getBashDescription,
} from "@smai-kit/file-utils";

import { bashAdapter } from "../adapters/index.js";
import { toErrorResult, type ToolHandlerResult } from "../tool-registry.js";

// ── 工具配置 ────────────────────────────────────────────────
/** remote_file_bash 工具配置：复用库的 description 与 zod inputSchema */
export const fileBashConfig = {
  description: getBashDescription(),
  inputSchema: bashInputSchema(),
};

// ── 工具回调 ────────────────────────────────────────────────
/**
 * remote_file_bash 工具回调：执行 shell 命令，按优先级链适配返回。
 * @param args - 命令参数（command 必填，timeout/run_in_background 等可选）
 * @returns 适配后的 MCP content（stdout/stderr/exit/image/后台任务 ID 等）；
 *          业务错误时 isError:true（注：非零退出码不视为错误，见 plan D6）
 */
export async function fileBashHandler(
  args: Record<string, unknown>
): Promise<ToolHandlerResult> {
  try {
    const result = await bash(args as Parameters<typeof bash>[0]);
    return { content: bashAdapter(result) };
  } catch (err) {
    return toErrorResult(err);
  }
}
