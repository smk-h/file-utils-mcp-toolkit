/**
 * =====================================================
 * Copyright © sumu. 2022-present. Tech. Co., Ltd. All rights reserved.
 * File name  : execResultAdapter.ts
 * Author     : sumu
 * Date       : 2026/07/12
 * Description: ExecResult（后台任务 wait 返回）→ ContentItem[] 适配器
 * ======================================================
 */

import type { ContentItem } from "../tool-registry.js";
import { text } from "../tool-registry.js";
import type { AdapterFn } from "./types.js";

// ── ExecResult 类型 ─────────────────────────────────────────
/**
 * 后台任务执行结果（对齐库内部 utils/ShellCommand.ts 的 ExecResult）。
 * 库的 waitForBackgroundTask 返回此结构（而非完整的 BashToolOutput）。
 * 此处本地定义：ExecResult 未从库主入口导出，本地定义让适配层与库内部解耦。
 */
export interface ExecResult {
  /** 标准输出 */
  stdout: string;
  /** 标准错误 */
  stderr: string;
  /** 退出码 */
  code: number;
  /** 是否被中断 */
  interrupted: boolean;
}

// ── 适配器 ──────────────────────────────────────────────────
/**
 * 把 ExecResult 适配为 MCP content。
 * 输出：stdout（若有）→ text；stderr（若有）→ [stderr] text；
 * 非零退出码 → [exit] text；中断 → 中断提示。
 * @param output - 后台任务执行结果
 * @returns 适配后的 content 数组
 */
export const execResultAdapter: AdapterFn<ExecResult> = (
  output
): ContentItem[] => {
  const items: ContentItem[] = [];

  if (output.stdout) {
    items.push(text(output.stdout));
  }
  if (output.stderr) {
    items.push(text(`[stderr]\n${output.stderr}`));
  }
  if (output.code !== 0) {
    items.push(text(`[exit] code ${output.code}`));
  }
  if (output.interrupted) {
    items.push(text("(command was interrupted)"));
  }

  return items;
};
