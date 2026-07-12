/**
 * =====================================================
 * Copyright © sumu. 2022-present. Tech. Co., Ltd. All rights reserved.
 * File name  : edit.ts
 * Author     : sumu
 * Date       : 2026/07/12
 * Description: remote_file_edit 工具 — 封装 @smai-kit/file-utils 的 edit
 * ======================================================
 */

import {
  edit,
  editInputSchema,
  getEditDescription,
} from "@smai-kit/file-utils";

import { editAdapter } from "../adapters/index.js";
import { toErrorResult, type ToolHandlerResult } from "../tool-registry.js";

// ── 工具配置 ────────────────────────────────────────────────
/** remote_file_edit 工具配置：复用库的 description 与 zod inputSchema */
export const fileEditConfig = {
  description: getEditDescription(),
  inputSchema: editInputSchema(),
};

// ── 工具回调 ────────────────────────────────────────────────
/**
 * remote_file_edit 工具回调：精确字符串替换，适配返回 Edited 头 + diff。
 * @param args - 编辑参数（file_path、old_string、new_string 必填，replace_all 可选）
 * @returns 适配后的 MCP content；业务错误时 isError:true
 */
export async function fileEditHandler(
  args: Record<string, unknown>
): Promise<ToolHandlerResult> {
  try {
    const result = await edit(args as Parameters<typeof edit>[0]);
    return { content: editAdapter(result) };
  } catch (err) {
    return toErrorResult(err);
  }
}
