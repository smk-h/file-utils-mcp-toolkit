#!/usr/bin/env bash
# offline_install.sh
# 把 file-utils-mcp-toolkit 离线包直接装到全局 npm 目录。
# 复刻 `npm install -g` 的两步（复制包到 node_modules + 建 bin shim），
# 但不触发 prepare、不依赖 --ignore-scripts，绕开 npm 版本差异导致的 tsc 报错。
#
# 用法（在解压后的目录里）：
#   bash offline_install.sh
# 或传解压目录：
#   bash offline_install.sh /path/to/file-utils-mcp-toolkit
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "${1:-$SCRIPT_DIR}" && pwd)"
PKG_JSON="$SRC/package.json"

[ -f "$PKG_JSON" ] || {
  echo "错误：$PKG_JSON 不存在。请在解压后的 file-utils-mcp-toolkit 目录里运行，" >&2
  echo "      或传目录参数：bash offline_install.sh <解压目录>" >&2
  exit 1
}

# 读 package.json 的 name / bin
NAME="$(node -p "require('$PKG_JSON').name")"
BIN_KEY="$(node -p "Object.keys(require('$PKG_JSON').bin)[0]")"
BIN_FIELD="$(node -p "require('$PKG_JSON').bin['$BIN_KEY']")"
BIN_REL="${BIN_FIELD#./}"                 # bin/file-utils-mcp-toolkit-cli.mjs

# 全局目录
PREFIX="$(npm prefix -g 2>/dev/null)"
ROOT_G="$(npm root -g 2>/dev/null)"        # = $PREFIX/lib/node_modules
SCOPE="$(dirname "$NAME")"                # @smai-kit
BASE="$(basename "$NAME")"                # file-utils-mcp-toolkit
DEST="$ROOT_G/$SCOPE/$BASE"               # 全局 node_modules 下的包路径
BIN_DIR="$PREFIX/bin"                      # 全局 bin

echo "源目录      : $SRC"
echo "包名        : $NAME"
echo "全局 prefix : $PREFIX"
echo "安装到      : $DEST"
echo "bin shim    : $BIN_DIR/$BIN_KEY"
echo

# 权限检查
if [ ! -w "$PREFIX" ]; then
  echo "错误：$PREFIX 不可写。" >&2
  echo "  - 用 nvm：重开终端或 source nvm 后再跑；" >&2
  echo "  - 系统级 npm：用 sudo bash offline_install.sh 运行。" >&2
  exit 1
fi

# 清理旧版
if [ -e "$DEST" ]; then
  echo "清理旧版 $DEST ..."
  rm -rf "$DEST"
fi

# 复制 package.json / bin / out / node_modules
mkdir -p "$DEST"
echo "复制 package.json bin out node_modules ..."
for item in package.json bin out node_modules; do
  [ -e "$SRC/$item" ] && cp -a "$SRC/$item" "$DEST/"
done
chmod +x "$DEST/$BIN_REL" 2>/dev/null || true

# bin 包装脚本（绝对路径，用 node 调起 cli.mjs，对齐 npm 行为）
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/$BIN_KEY" <<EOF
#!/bin/sh
exec node "$DEST/$BIN_REL" "\$@"
EOF
chmod +x "$BIN_DIR/$BIN_KEY"

echo
hash -r
echo "安装完成。验证："
echo "  which $BIN_KEY  ->  $(command -v "$BIN_KEY" || echo "$BIN_DIR/$BIN_KEY")"
echo "  运行 $BIN_KEY 启动（stdio MCP server，等 stdin，Ctrl+C 退出）"
