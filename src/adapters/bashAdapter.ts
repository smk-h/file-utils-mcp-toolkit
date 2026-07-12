/**
 * =====================================================
 * Copyright © sumu. 2022-present. Tech. Co., Ltd. All rights reserved.
 * File name  : bashAdapter.ts
 * Author     : sumu
 * Date       : 2026/07/12
 * Description: BashToolOutput → ContentItem[] 适配器
 * ======================================================
 */

import type { BashToolOutput } from "@smai-kit/file-utils";
import type { ContentItem } from "../tool-registry.js";
import { text } from "../tool-registry.js";
import type { AdapterFn } from "./types.js";

// ── 适配器 ──────────────────────────────────────────────────
/**
 * 把 bash() 的返回值适配为 MCP content，按优先级链处理：
 *   1. 后台任务（backgroundTaskId）→ 仅返回任务 ID（+ 可选后台化提示），后续分支不处理
 *   2. 图片输出（isImage）→ image content（mimeType 默认 image/png）
 *   3. 普通 stdout → text content
 *   4. stderr → 追加 [stderr] text
 *   5. returnCodeInterpretation → 追加 [exit] text
 *   6. interrupted → 追加中断提示
 *   7. persistedOutputPath → 追加 resource（file:// URI）
 * @param output - 库的 BashToolOutput
 * @returns 适配后的 content 数组
 */
export const bashAdapter: AdapterFn<BashToolOutput> = (
  output
): ContentItem[] => {
  const items: ContentItem[] = [];

  // 1. 后台任务：仅返回任务 ID，提前返回
  if (output.backgroundTaskId) {
    items.push(text(`Background task started: ${output.backgroundTaskId}`));
    if (output.backgroundedByUser) {
      items.push(text("(backgrounded by user request)"));
    }
    if (output.assistantAutoBackgrounded) {
      items.push(text("(auto-backgrounded by assistant)"));
    }
    return items;
  }

  // 2. 图片输出：stdout 中含 base64 图片数据
  if (output.isImage && output.stdout) {
    items.push({
      type: "image",
      data: output.stdout,
      mimeType: "image/png",
    });
  } else if (output.stdout) {
    // 3. 普通 stdout
    items.push(text(output.stdout));
  }

  // 4. stderr
  if (output.stderr) {
    items.push(text(`[stderr]\n${output.stderr}`));
  }

  // 5. 退出码语义
  if (output.returnCodeInterpretation) {
    items.push(text(`[exit] ${output.returnCodeInterpretation}`));
  }

  // 6. 中断
  if (output.interrupted) {
    items.push(text("(command was interrupted)"));
  }

  // 7. 持久化输出：本地路径转 resource，客户端按需读取
  if (output.persistedOutputPath) {
    items.push({
      type: "resource",
      resource: {
        uri: `file://${output.persistedOutputPath}`,
        mimeType: "text/plain",
      },
    });
  }

  return items;
};
