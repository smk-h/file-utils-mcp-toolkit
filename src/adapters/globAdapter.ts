/**
 * =====================================================
 * Copyright © sumu. 2022-present. Tech. Co., Ltd. All rights reserved.
 * File name  : globAdapter.ts
 * Author     : sumu
 * Date       : 2026/07/12
 * Description: GlobOutput → ContentItem[] 适配器
 * ======================================================
 */

import type { GlobOutput } from "@smai-kit/file-utils";
import { text } from "../tool-registry.js";
import type { AdapterFn } from "./types.js";

// ── 适配器 ──────────────────────────────────────────────────
/**
 * 把 glob() 的返回值适配为 MCP content。
 * 输出：匹配文件数 + 耗时头，后接文件名列表；truncated 时追加截断提示。
 * @param output - 库的 GlobOutput
 * @returns 含文件列表的 text content
 */
export const globAdapter: AdapterFn<GlobOutput> = (output) => {
  const lines: string[] = [
    `Found ${output.numFiles} file(s) in ${output.durationMs}ms:`,
  ];
  lines.push(...output.filenames);

  if (output.truncated) {
    lines.push("(results truncated to 100 files)");
  }

  return [text(lines.join("\n"))];
};
