/**
 * =====================================================
 * Copyright © sumu. 2022-present. Tech. Co., Ltd. All rights reserved.
 * File name  : greet.ts
 * Author     : sumu
 * Date       : 2026/07/12
 * Description: greet 工具（demo，保留向后兼容）
 * ======================================================
 */

import * as z from "zod/v4";

import { text, type ToolHandlerResult } from "../tool-registry.js";

// ── 工具配置 ────────────────────────────────────────────────
/** greet 工具配置：自写 description + 简单 zod object */
export const greetConfig = {
  description: "向指定的人打招呼",
  inputSchema: z.object({
    name: z.string().describe("要打招呼的人的名字"),
  }),
};

// ── 工具回调 ────────────────────────────────────────────────
/**
 * greet 工具回调：返回欢迎语。
 * @param args - 含 name 字段
 * @returns 含欢迎语文本的 MCP content
 */
export async function greetHandler(args: {
  name: string;
}): Promise<ToolHandlerResult> {
  const { name } = args;
  return {
    content: [text(`你好，${name}！欢迎使用 file-utils-mcp-toolkit！`)],
  };
}
