/**
 * =====================================================
 * Copyright © sumu. 2022-present. Tech. Co., Ltd. All rights reserved.
 * File name  : read.ts
 * Author     : sumu
 * Date       : 2026/07/12
 * Description: remote_file_read 工具 — 封装 @smai-kit/file-utils 的 read
 * ======================================================
 */

import {
  getReadDescription,
  read,
  readInputSchema,
} from "@smai-kit/file-utils";

import { readAdapter } from "../adapters/index.js";
import { toErrorResult, type ToolHandlerResult } from "../tool-registry.js";

// ── 工具配置 ────────────────────────────────────────────────
/** remote_file_read 工具配置：复用库的 description 与 zod inputSchema */
export const fileReadConfig = {
  description: getReadDescription(),
  inputSchema: readInputSchema(),
};

// ── 工具回调 ────────────────────────────────────────────────
/**
 * remote_file_read 工具回调：读取文件，按 ReadOutput 六分支适配为 MCP content。
 * @param args - 读取参数（file_path 必填，offset/limit/pages 可选）
 * @returns 适配后的 MCP content；业务错误时 isError:true
 */
export async function fileReadHandler(
  args: Record<string, unknown>
): Promise<ToolHandlerResult> {
  try {
    const result = await read(args as Parameters<typeof read>[0]);
    return { content: readAdapter(result) };
  } catch (err) {
    return toErrorResult(err);
  }
}
