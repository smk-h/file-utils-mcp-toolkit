/**
 * =====================================================
 * Copyright © sumu. 2022-present. Tech. Co., Ltd. All rights reserved.
 * File name  : grepAdapter.ts
 * Author     : sumu
 * Date       : 2026/07/12
 * Description: GrepOutput → ContentItem[] 适配器
 * ======================================================
 */

import type { GrepOutput } from "@smai-kit/file-utils";
import { text } from "../tool-registry.js";
import type { AdapterFn } from "./types.js";

// ── 适配器 ──────────────────────────────────────────────────
/**
 * 把 grep() 的返回值适配为 MCP content。
 * 按 output_mode 三分支格式化：
 *   - content           → 匹配正文行数与文件数 + content 正文
 *   - files_with_matches → 匹配文件数 + 文件名列表（默认）
 *   - count             → 总匹配数与文件数 + 计数正文
 * 有 appliedLimit 时追加截断提示。
 * @param output - 库的 GrepOutput
 * @returns 含匹配结果的 text content
 */
export const grepAdapter: AdapterFn<GrepOutput> = (output) => {
  const lines: string[] = [];

  if (output.mode === "content") {
    lines.push(
      `${output.numLines ?? 0} line(s) in ${output.numFiles} file(s):`
    );
    if (output.content) {
      lines.push(output.content);
    }
  } else if (output.mode === "count") {
    lines.push(
      `${output.numMatches ?? 0} match(es) in ${output.numFiles} file(s):`
    );
    if (output.content) {
      lines.push(output.content);
    }
  } else {
    // files_with_matches 或未指定模式（默认）
    lines.push(`Found ${output.numFiles} file(s):`);
    lines.push(...output.filenames);
  }

  if (output.appliedLimit !== undefined) {
    lines.push(`(truncated at ${output.appliedLimit})`);
  }

  return [text(lines.join("\n"))];
};
