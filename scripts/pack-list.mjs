import { execSync } from "child_process";
import fs from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

// 根据 package.json 的 name + version 推导 tgz 文件名
// scoped 包规则：去掉前导 @，把 / 替换为 -
const file = `${pkg.name.replace(/^@/, "").replace(/\//g, "-")}-${pkg.version}.tgz`;

if (!fs.existsSync(file)) {
  console.error(`未找到 ${file}，请先运行 npm run pack:tgz 生成打包产物`);
  process.exit(1);
}

console.log(`Archive: ${file}\n`);
// 列出 tgz 内容（tar 在 Windows 10+/Linux/macOS 均自带）
execSync(`tar -tzf ${file}`, { stdio: "inherit" });
