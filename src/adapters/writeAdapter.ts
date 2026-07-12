/**
 * =====================================================
 * Copyright © sumu. 2022-present. Tech. Co., Ltd. All rights reserved.
 * File name  : writeAdapter.ts
 * Author     : sumu
 * Date       : 2026/07/12
 * Description: WriteOutput → ContentItem[] 适配器
 * ======================================================
 */

import type { WriteOutput } from "@smai-kit/file-utils";
import type { ContentItem } from "../tool-registry.js";
import { formatPatch, type AdapterFn } from "./types.js";

// ── 适配器 ──────────────────────────────────────────────────
/**
 * 把 write() 的返回值适配为 MCP content。
 * 输出：create/update 类型头 + 文件路径，后接 unified diff。
 * @param output - 库的 WriteOutput
 * @returns 含路径头与 diff 的 text content
 */
export const writeAdapter: AdapterFn<WriteOutput> = (output): ContentItem[] => {
  const head =
    output.type === "create"
      ? `Created: ${output.filePath}`
      : `Updated: ${output.filePath}`;
  const diffText = formatPatch(output.structuredPatch);
  const text = diffText.length > 0 ? `${head}\n${diffText}` : head;
  return [{ type: "text", text }];
};
