#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // 启动 MCP Server（通过编译后的 out/index.js）
  const transport = new StdioClientTransport({
    command: "node",
    args: [path.resolve(__dirname, "../out/index.js")],
  });

  const client = new Client(
    { name: "test-client", version: "0.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);

  // 1. 列出所有可用工具
  const { tools } = await client.listTools();
  console.log("=== 可用工具 ===");
  for (const tool of tools) {
    console.log(`  - ${tool.name}: ${tool.description}`);
  }
  console.log();

  // 2. 调用 greet 工具
  const name = process.argv[2] || "World";
  console.log(`=== 调用 greet("${name}") ===`);
  const result = await client.callTool({
    name: "greet",
    arguments: { name },
  });
  console.log(result.content[0].text);

  await client.close();
}

main().catch((err) => {
  console.error("测试失败:", err.message);
  process.exit(1);
});
