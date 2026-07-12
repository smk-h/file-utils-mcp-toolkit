/**
 * =====================================================
 * Copyright © sumu. 2022-present. Tech. Co., Ltd. All rights reserved.
 * File name  : grep.ts
 * Author     : sumu
 * Date       : 2026/07/12
 * Description: remote_file_grep 工具 — 封装 @smai-kit/file-utils 的 grep
 * ======================================================
 */

import {
  getDescription as getGrepDescription,
  grep,
  inputSchema as grepInputSchema,
} from "@smai-kit/file-utils";

import { grepAdapter } from "../adapters/index.js";
import { toErrorResult, type ToolHandlerResult } from "../tool-registry.js";

// 注意：grep 的 description/schema getter 名字不带工具前缀（库导出为 getDescription / inputSchema），
// 与其他 5 个工具（getReadDescription / readInputSchema 等）不同，故此处起别名。

// ── 工具配置 ────────────────────────────────────────────────
/** remote_file_grep 工具配置：复用库的 description 与 zod inputSchema */
export const fileGrepConfig = {
  description: getGrepDescription(),
  inputSchema: grepInputSchema(),
};

// ── 工具回调 ────────────────────────────────────────────────
/**
 * remote_file_grep 工具回调：基于 ripgrep 搜索文件内容，按 output_mode 三分支适配。
 * @param args - 搜索参数（pattern 必填，path/glob/output_mode 等可选）
 * @returns 适配后的 MCP content（匹配列表或正文）；业务错误时 isError:true
 */
export async function fileGrepHandler(
  args: Record<string, unknown>
): Promise<ToolHandlerResult> {
  try {
    const result = await grep(args as Parameters<typeof grep>[0]);
    return { content: grepAdapter(result) };
  } catch (err) {
    return toErrorResult(err);
  }
}
