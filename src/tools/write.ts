/**
 * =====================================================
 * Copyright © sumu. 2022-present. Tech. Co., Ltd. All rights reserved.
 * File name  : write.ts
 * Author     : sumu
 * Date       : 2026/07/12
 * Description: remote_file_write 工具 — 封装 @smai-kit/file-utils 的 write
 * ======================================================
 */

import {
  getWriteDescription,
  write,
  writeInputSchema,
} from "@smai-kit/file-utils";

import { writeAdapter } from "../adapters/index.js";
import { toErrorResult, type ToolHandlerResult } from "../tool-registry.js";

// ── 工具配置 ────────────────────────────────────────────────
/** remote_file_write 工具配置：复用库的 description 与 zod inputSchema */
export const fileWriteConfig = {
  description: getWriteDescription(),
  inputSchema: writeInputSchema(),
};

// ── 工具回调 ────────────────────────────────────────────────
/**
 * remote_file_write 工具回调：全量写入文件，适配返回 create/update 头 + diff。
 * @param args - 写入参数（file_path、content 必填）
 * @returns 适配后的 MCP content；业务错误时 isError:true
 */
export async function fileWriteHandler(
  args: Record<string, unknown>
): Promise<ToolHandlerResult> {
  try {
    const result = await write(args as Parameters<typeof write>[0]);
    return { content: writeAdapter(result) };
  } catch (err) {
    return toErrorResult(err);
  }
}
