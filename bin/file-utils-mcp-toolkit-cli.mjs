#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(__dirname, "../out/index.js");

const child = spawn(process.execPath, [entry], {
  stdio: ["inherit", "inherit", "inherit", "ipc"],
});

child.on("error", (err) => {
  console.error("Failed to start file-utils-mcp-toolkit:", err.message);
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
