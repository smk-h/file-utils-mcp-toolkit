/**
 * =====================================================
 * Copyright © sumu. 2022-present. Tech. Co., Ltd. All rights reserved.
 * File name  : index.ts
 * Author     : sumu
 * Date       : 2026/07/12
 * Description: 适配器统一导出入口
 * ======================================================
 */

export { readAdapter } from "./readAdapter.js";
export { writeAdapter } from "./writeAdapter.js";
export { editAdapter } from "./editAdapter.js";
export { grepAdapter } from "./grepAdapter.js";
export { globAdapter } from "./globAdapter.js";
export { bashAdapter } from "./bashAdapter.js";
export { execResultAdapter } from "./execResultAdapter.js";
export type { ExecResult } from "./execResultAdapter.js";
export { formatPatch } from "./types.js";
export type { AdapterFn, PatchHunk } from "./types.js";
