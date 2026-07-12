/**
 * =====================================================
 * Copyright © sumu. 2022-present. Tech. Co., Ltd. All rights reserved.
 * File name  : tool-registry.ts
 * Author     : sumu
 * Date       : 2026/07/12
 * Description: MCP 共享辅助函数、类型与工具构建器
 * ======================================================
 */

// ── 协议类型 ────────────────────────────────────────────────
/**
 * MCP content 数组元素。本 server 只用到 text / image / resource 三种。
 * 放在此处（而非 adapters/types.ts）作为底层协议类型，供适配器与工具模块共享，
 * 避免类型重复定义与循环依赖。
 */
export type ContentItem =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri: string; mimeType?: string } };

/**
 * MCP tools/call 的统一返回结构。
 * content 必填；isError 缺省为 false，业务错误时置 true。
 */
export type ToolHandlerResult = {
  content: ContentItem[];
  isError?: boolean;
};

// ── 工具注册条目 ────────────────────────────────────────────
/**
 * 工具注册条目。
 * inputSchema 为库导出的 zod schema（StandardSchemaV1）或自写 zod object，
 * 存为 unknown 以兼容异构工具统一收集。
 */
export interface ToolEntry {
  /** 工具名，如 "remote_file_read" */
  name: string;
  /** 工具配置：description + inputSchema */
  config: {
    description: string;
    // SDK 的 registerTool 类型要求更窄的 StandardSchemaWithJSON，运行时接受任意 StandardSchemaV1；
    // 此处用 unknown 异构存储，注册时再断言（见 server.ts）。
    inputSchema: unknown;
  };
  /** 工具回调，参数为 LLM 传入的 arguments（已由库 schema 校验） */
  handler: (args: Record<string, unknown>) => Promise<ToolHandlerResult>;
}

// ── 辅助函数 ────────────────────────────────────────────────
/**
 * 快速构造 MCP TextContent 对象
 * @param content - 文本内容
 * @returns MCP TextContent 块
 */
export function text(content: string): ContentItem {
  return { type: "text", text: content };
}

/**
 * 把库抛出的错误转为 MCP 错误响应（isError: true 的 content）。
 * 业务错误（文件不存在、staleness 失败、多匹配等）走此路径，
 * 让 AI 据错误消息自行重试，而非抛 JSON-RPC error。
 * @param err - 捕获到的错误对象（任意类型）
 * @returns 带 isError 标记的 MCP 响应
 */
export function toErrorResult(err: unknown): ToolHandlerResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [text(message)], isError: true };
}

// ── 工具构建器 ──────────────────────────────────────────────
/**
 * 用泛型辅助函数创建工具条目，同时捕获各 handler 自身的参数类型。
 * handler 形参用 any 是异构回调统一存储的必要妥协（TS 中 any 是 unknown 的类型安全反向），
 * 实际运行时参数由库的 inputSchema 校验。
 * @param name - 工具名称
 * @param config - 工具配置（description + inputSchema）
 * @param handler - 工具回调函数
 * @returns ToolEntry 条目
 */
export function mcpDefineTool(
  name: string,
  config: ToolEntry["config"],
  // 异构工具的 handler 参数类型各不相同，统一收集时退化为 any；
  // 这是 TS 表达「异构回调数组」的标准做法，运行时由库 schema 保证类型安全。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => Promise<ToolHandlerResult>
): ToolEntry {
  return { name, config, handler: handler as ToolEntry["handler"] };
}
