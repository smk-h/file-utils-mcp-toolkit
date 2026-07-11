import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

const server = new McpServer({
  name: "file-utils-mcp-toolkit",
  version: "0.0.0",
});

// ─── Tool: 打招呼 ────────────────────────────────────────────────

server.registerTool(
  "greet",
  {
    description: "向指定的人打招呼",
    inputSchema: z.object({
      name: z.string().describe("要打招呼的人的名字"),
    }),
  },
  async ({ name }) => {
    return {
      content: [
        {
          type: "text",
          text: `你好，${name}！欢迎使用 file-utils-mcp-toolkit！`,
        },
      ],
    };
  }
);

// ─── 启动 ────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP Server 启动失败:", err);
  process.exit(1);
});
