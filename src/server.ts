/**
 * =====================================================
 * Copyright © sumu. 2022-present. Tech. Co., Ltd. All rights reserved.
 * File name  : server.ts
 * Author     : sumu
 * Date       : 2026/07/12
 * Description: MCP Server — 创建 McpServer 实例、注册所有工具、提供启动入口
 * ======================================================
 */

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { mcpTools } from "./tools/index.js";

// ── package 信息 ───────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "../package.json"), "utf-8")
) as {
  name: string;
  version: string;
};

// ── server 实例 ────────────────────────────────────────────
export const server = new McpServer(
  { name: pkg.name, version: pkg.version },
  { capabilities: { logging: {} } }
);

// ── 工具批量注册 ───────────────────────────────────────────
// 遍历聚合的 ToolEntry 列表，统一注册到 server。
// SDK 的 registerTool 类型签名要求 inputSchema 为更窄的 StandardSchemaWithJSON，
// 但运行时接受任意 StandardSchemaV1（库的 zod v4 schema 即此结构）。
// 此处用类型断言绕过编译期类型差异（与运行时行为一致）。
for (const { name, config, handler } of mcpTools) {
  server.registerTool(
    name,
    config as { description: string; inputSchema: unknown } as never,
    handler as never
  );
}

// ── 进程退出清理 ───────────────────────────────────────────
/**
 * 注册进程退出清理钩子。
 * 监听 stdin 关闭（MCP client 断开）与 SIGINT/SIGTERM 信号，
 * 跨 Windows / Linux 统一触发优雅退出。
 */
function registerCleanupHooks(): void {
  let exiting = false;

  /**
   * 执行清理并退出，防止重复触发
   * @param reason - 退出原因
   */
  function cleanupAndExit(reason: string): void {
    if (exiting) {
      return;
    }
    exiting = true;
    console.error(`[mcp] ${reason}, exiting...`);
    process.exit(0);
  }

  // stdin 管道关闭：MCP 客户端断开连接 → 跨 Windows / Linux 统一触发
  process.stdin.on("end", () => {
    cleanupAndExit("stdin closed (client disconnected)");
  });
  process.stdin.on("error", (err: NodeJS.ErrnoException) => {
    cleanupAndExit(`stdin error: ${err.message}`);
  });

  // SIGINT / SIGTERM：Linux/macOS 上 Ctrl+C 或 kill 命令
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      cleanupAndExit(`${signal} received`);
    });
  }
}

// ── 启动入口 ───────────────────────────────────────────────
/**
 * 启动 MCP server：注册清理钩子，接入 stdio 传输。
 * 启动后进程常驻，等待 stdin 的 JSON-RPC 请求（单进程常驻是库 readFileState 共享的前提）。
 */
export async function startMcpServer(): Promise<void> {
  registerCleanupHooks();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
