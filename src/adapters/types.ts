/**
 * =====================================================
 * Copyright © sumu. 2022-present. Tech. Co., Ltd. All rights reserved.
 * File name  : types.ts
 * Author     : sumu
 * Date       : 2026/07/12
 * Description: 适配器层共享类型与 diff 序列化辅助函数
 * ======================================================
 */

import type { ContentItem } from "../tool-registry.js";

// ── 适配器函数签名 ──────────────────────────────────────────
/**
 * 适配器函数签名：把库的结构化返回值转换为 MCP ContentItem[]。
 * 纯函数、无副作用、不抛错（错误在工具 handler 层捕获）。
 * @param output - 库返回的结构化对象
 * @returns MCP content 数组
 */
export type AdapterFn<T> = (output: T) => ContentItem[];

// ── diff hunk 结构 ──────────────────────────────────────────
/**
 * 结构化差异补丁的单个 hunk（对齐 diff 库的 StructuredPatch）。
 * 库的 EditOutput.structuredPatch / WriteOutput.structuredPatch 元素即此结构。
 * 此处本地定义而非 import diff 库，让适配层与库内部依赖解耦。
 */
export interface PatchHunk {
  /** 旧文件中的起始行号 */
  oldStart: number;
  /** 旧文件中的行数 */
  oldLines: number;
  /** 新文件中的起始行号 */
  newStart: number;
  /** 新文件中的行数 */
  newLines: number;
  /** 变更行内容（含 "+"、"-"、" " 前缀） */
  lines: string[];
}

// ── diff 序列化 ─────────────────────────────────────────────
/**
 * 把 StructuredPatchHunk[] 序列化为可读的 unified diff 文本。
 * 每个 hunk 输出表头 `@@ -oldStart,oldLines +newStart,newLines @@`，后接变更行。
 * 被 writeAdapter 与 editAdapter 复用。
 * @param patch - hunk 数组（可为空）
 * @returns unified diff 文本；空数组返回空字符串
 */
export function formatPatch(patch: PatchHunk[]): string {
  if (patch.length === 0) {
    return "";
  }
  const blocks: string[] = [];
  for (const hunk of patch) {
    blocks.push(
      `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
    );
    blocks.push(...hunk.lines);
  }
  return blocks.join("\n");
}
