/**
 * =====================================================
 * Copyright © sumu. 2022-present. Tech. Co., Ltd. All rights reserved.
 * File name  : editAdapter.ts
 * Author     : sumu
 * Date       : 2026/07/12
 * Description: EditOutput → ContentItem[] 适配器
 * ======================================================
 */

import type { EditOutput } from "@smai-kit/file-utils";
import type { ContentItem } from "../tool-registry.js";
import { formatPatch, type AdapterFn } from "./types.js";

// ── 适配器 ──────────────────────────────────────────────────
/**
 * 把 edit() 的返回值适配为 MCP content。
 * 输出：Edited 头 + 文件路径，可选「replaced all」提示，后接 unified diff。
 * @param output - 库的 EditOutput
 * @returns 含路径头、可选提示与 diff 的 text content
 */
export const editAdapter: AdapterFn<EditOutput> = (output): ContentItem[] => {
  const blocks: string[] = [`Edited: ${output.filePath}`];
  if (output.replaceAll) {
    blocks.push("(replaced all occurrences)");
  }
  const diffText = formatPatch(output.structuredPatch);
  if (diffText.length > 0) {
    blocks.push(diffText);
  }
  return [{ type: "text", text: blocks.join("\n") }];
};
