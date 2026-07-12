/**
 * =====================================================
 * Copyright © sumu. 2022-present. Tech. Co., Ltd. All rights reserved.
 * File name  : glob.ts
 * Author     : sumu
 * Date       : 2026/07/12
 * Description: remote_file_glob 工具 — 封装 @smai-kit/file-utils 的 glob
 * ======================================================
 */

import {
  getGlobDescription,
  glob,
  globInputSchema,
} from "@smai-kit/file-utils";

import { globAdapter } from "../adapters/index.js";
import { toErrorResult, type ToolHandlerResult } from "../tool-registry.js";

// ── 工具配置 ────────────────────────────────────────────────
/** remote_file_glob 工具配置：复用库的 description 与 zod inputSchema */
export const fileGlobConfig = {
  description: getGlobDescription(),
  inputSchema: globInputSchema(),
};

// ── 工具回调 ────────────────────────────────────────────────
/**
 * remote_file_glob 工具回调：基于 ripgrep 的文件名模式匹配，适配返回文件列表。
 * @param args - 查找参数（pattern 必填，path 可选）
 * @returns 适配后的 MCP content（文件路径列表）；业务错误时 isError:true
 */
export async function fileGlobHandler(
  args: Record<string, unknown>
): Promise<ToolHandlerResult> {
  try {
    const result = await glob(args as Parameters<typeof glob>[0]);
    return { content: globAdapter(result) };
  } catch (err) {
    return toErrorResult(err);
  }
}
