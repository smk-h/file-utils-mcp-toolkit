/**
 * =====================================================
 * Copyright © sumu. 2022-present. Tech. Co., Ltd. All rights reserved.
 * File name  : readAdapter.ts
 * Author     : sumu
 * Date       : 2026/07/12
 * Description: ReadOutput → ContentItem[] 适配器（6 分支 + diagnostics）
 * ======================================================
 */

import type { ReadOutput } from "@smai-kit/file-utils";
import type { ContentItem } from "../tool-registry.js";
import { text } from "../tool-registry.js";
import type { AdapterFn } from "./types.js";

// ── 适配器 ──────────────────────────────────────────────────
/**
 * 把 read() 的返回值适配为 MCP content。
 * ReadOutput 为判别联合类型，按 type 字段六分支处理：
 *   - text           → text content（路径/行数头 + 带行号正文）
 *   - image          → image content（base64→data、type→mimeType 字段映射）
 *   - notebook       → text content（cells 序列化为 JSON）
 *   - pdf            → text content（提示为 base64 PDF，路径与大小）
 *   - parts          → text content（提示服务端切片，count 与 outputDir）
 *   - file_unchanged → text content（提示文件未变更）
 * 另：diagnostics 字段游离在 outputSchema 外，单独作为附加 text content 追加。
 * @param output - 库的 ReadOutput
 * @returns 适配后的 content 数组
 */
export const readAdapter: AdapterFn<ReadOutput> = (output): ContentItem[] => {
  const items: ContentItem[] = [];
  const file = output.file as Record<string, unknown>;

  switch (output.type) {
    case "text": {
      const filePath = file.filePath as string;
      const content = file.content as string;
      const numLines = file.numLines as number;
      const startLine = file.startLine as number;
      const totalLines = file.totalLines as number;
      const header = `File: ${filePath} (${numLines} lines, ${startLine}-${startLine + numLines - 1} of ${totalLines})`;
      items.push(text(`${header}\n${content}`));
      break;
    }
    case "image": {
      // ⚠️ 字段映射：file.base64 → data, file.type → mimeType
      items.push({
        type: "image",
        data: file.base64 as string,
        mimeType: file.type as string,
      });
      break;
    }
    case "notebook": {
      // notebook 无原生 MCP 类型，序列化为 JSON 文本
      items.push(
        text(
          `Notebook: ${file.filePath as string}\n${JSON.stringify(file.cells, null, 2)}`
        )
      );
      break;
    }
    case "pdf": {
      // PDF base64 无法用 MCP image（仅支持 image/*），转成提示性 text
      items.push(
        text(
          `PDF: ${file.filePath as string} (${file.originalSize as number} bytes, base64 encoded)`
        )
      );
      break;
    }
    case "parts": {
      // parts 模式指向本地 outputDir，MCP 客户端无法访问
      items.push(
        text(
          `File split into ${file.count as number} parts at ${file.outputDir as string} (server-side only)`
        )
      );
      break;
    }
    case "file_unchanged": {
      items.push(text(`File unchanged: ${file.filePath as string}`));
      break;
    }
  }

  // diagnostics 字段不在 outputSchema 内，需单独追加
  const diagnostics = output.diagnostics;
  if (diagnostics && diagnostics.length > 0) {
    const diagText = diagnostics
      .map((d) => {
        const line = d.line ?? "?";
        return `[${d.severity}] ${d.message} (line ${line})`;
      })
      .join("\n");
    items.push(text(`Diagnostics:\n${diagText}`));
  }

  return items;
};
