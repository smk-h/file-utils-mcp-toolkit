/**
 * =====================================================
 * Copyright © sumu. 2022-present. Tech. Co., Ltd. All rights reserved.
 * File name  : index.ts
 * Author     : sumu
 * Date       : 2026/07/12
 * Description: file-utils-mcp-toolkit 进程入口
 * ======================================================
 */

import { startMcpServer } from "./server.js";

// ── 启动 ────────────────────────────────────────────────────
/**
 * 进程入口：启动 MCP server（stdio 模式，单进程常驻）。
 * 工具注册在 server.ts 模块加载时完成。
 */
async function main(): Promise<void> {
  await startMcpServer();
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("MCP Server 启动失败:", msg);
  process.exit(1);
});
