#!/usr/bin/env bash
# * =====================================================
# * Copyright © hk. 2022-2025. All rights reserved.
# * File name  : offline_install.sh
# * Author     : 苏木
# * Date       : 2026-07-13
# * Description: 把 file-utils-mcp-toolkit 离线包直接装到全局 npm 目录。
# *              复刻 `npm install -g` 的两步（复制包到 node_modules + 建 bin 软链接），
# *              但不触发 prepare、不依赖 --ignore-scripts，绕开 npm 版本差异导致的 tsc 报错。
# * Usage      :
# *              bash offline_install.sh
# *              bash offline_install.sh /path/to/file-utils-mcp-toolkit
# *              bash offline_install.sh uninstall
# * ======================================================

set -euo pipefail

# 脚本和工程路径
# ========================================================
SCRIPT_NAME=${0#*/}
SCRIPT_CURRENT_PATH=${0%/*}
SCRIPT_ABSOLUTE_PATH=$(cd "$(dirname "${0}")" && pwd)

# 颜色和日志标识
# ========================================================
# |      ---       |Black |  Red | Green | Yellow | Blue | Magenta | Cyan | White |
# | Fore(Standard) |  30  |  31  |  32   |   33   |  34  |   35    |  36  |   37  |
# | Fore(light)    |  90  |  91  |  92   |   93   |  94  |   95    |  96  |   97  |
# | Back(Standard) |  40  |  41  |  42   |   43   |  44  |   45    |  46  |   47  |
# | Back(light)    | 100  | 101  | 102   |  103   | 104  |  105    | 106  |  107  |
step() {
    echo -e "\e[96m➤  $@\e[0m"
}

warning() {
    echo -n "⚠️  "
    echo -e "\e[33m$@\e[0m"
}

error() {
    echo -n "❌ "
    echo -e "\e[31m$@\e[0m"
}

success() {
    echo -n "✅ "
    echo -e "\e[32m$@\e[0m"
}

info() {
    echo -ne "\e[32mℹ️ [INFO]\e[0m"
    echo -e "\e[0m$@\e[0m"
}

# sudo 密码配置
SUDO_PASSWORD="000000"

# 带命令回显的执行函数
# 回显和错误信息输出到 stderr, 不干扰管道和重定向
# 支持 sudo 自动提权: 当首个参数为 sudo 时, 自动判断 root 权限并处理
#
# 注意: 不要将管道输入接到 execute 上（如 echo data | execute sudo tee file），
#       因为 execute 内部通过 echo password | sudo -S 传递密码，如果外部也通过管道传入数据，
#       execute 的 stdin 会被外层管道占据，导致两种问题:
#         1. 若用 (echo password; cat) 转发 stdin，非管道调用时 cat 会因等待终端输入而永久阻塞
#         2. 若用 echo password | sudo -S，外部管道的数据无法传给实际命令（如 tee 写入的是密码而非数据）
#       正确做法: 在调用侧避免管道进 execute，改用临时文件中转或 sudo bash -c "echo > file"
execute() {
    printf '\e[95m[CMD] %s\e[0m\n' "$*" >&2

    if [ "$1" = "sudo" ]; then
        shift
        if [ "$(id -u)" -eq 0 ]; then
            printf '\e[33m[SUDO] Already root, skip sudo\e[0m\n' >&2
            "$@"
        else
            printf '\e[33m[SUDO] Auto elevating privileges\e[0m\n' >&2
            echo "$SUDO_PASSWORD" | sudo -S "$@" 2>&1
        fi
    else
        "$@"
    fi
    local ret=$?
    if [ $ret -ne 0 ]; then
        printf '\e[31m❌ Command failed (exit code: %d): %s\e[0m\n' "$ret" "$*" >&2
        return $ret
    fi
    return 0
}

# 目录切换函数定义
cdi() {
    if command -v pushd &>/dev/null; then
        pushd "$1" >/dev/null || return 1
    else
        cd "$1"
    fi
}

cdo() {
    if command -v popd &>/dev/null; then
        popd >/dev/null || return 1
    else
        cd -
    fi
}

# ========================================================
# 参数
# ========================================================

# 包名（与 package.json 中 name 字段一致）
PACKAGE_NAME="@smai-kit/file-utils-mcp-toolkit"
# bin 命令名（与 package.json 中 bin 的 key 一致）
PACKAGE_BIN="file-utils-mcp-toolkit"

# 源目录（解压后的 file-utils-mcp-toolkit 目录）
# 仅在 install 模式下使用，uninstall 不需要源目录
SRC_DIR=""
PKG_JSON=""

# 解析子命令: uninstall / 源目录路径
if [ "${1:-}" = "uninstall" ]; then
    ACTION="uninstall"
elif [ -n "${1:-}" ]; then
    ACTION="install"
    SRC_DIR="$(cd "$1" && pwd)"
else
    ACTION="install"
    SRC_DIR="$SCRIPT_ABSOLUTE_PATH"
fi
[ -n "$SRC_DIR" ] && PKG_JSON="$SRC_DIR/package.json"

# ========================================================
# 检查依赖（node / npm）
check_dependencies() {
    step "checking dependencies..."

    if ! command -v node &>/dev/null; then
        error "node is not installed!"
        info "please install Node.js first"
        return 1
    fi
    success "node $(node --version) found"

    if ! command -v npm &>/dev/null; then
        error "npm is not installed!"
        return 1
    fi
    success "npm $(npm --version) found"

    return 0
}

# ========================================================
# 读取 package.json 的 name / bin，计算安装路径
read_package_info() {
    step "reading package info..."

    if [ ! -f "$PKG_JSON" ]; then
        error "$PKG_JSON does not exist"
        info "please run this script inside the extracted file-utils-mcp-toolkit directory"
        info "or pass the directory: bash offline_install.sh <extracted-dir>"
        return 1
    fi

    PKG_NAME="$(node -p "require('$PKG_JSON').name")"
    BIN_KEY="$(node -p "Object.keys(require('$PKG_JSON').bin)[0]")"
    BIN_FIELD="$(node -p "require('$PKG_JSON').bin['$BIN_KEY']")"
    BIN_REL="${BIN_FIELD#./}"                 # bin/file-utils-mcp-toolkit-cli.mjs

    # 全局目录
    PREFIX="$(npm prefix -g 2>/dev/null)"
    ROOT_G="$(npm root -g 2>/dev/null)"        # = $PREFIX/lib/node_modules
    SCOPE="$(dirname "$PKG_NAME")"            # @smai-kit
    BASE="$(basename "$PKG_NAME")"            # file-utils-mcp-toolkit
    DEST="$ROOT_G/$SCOPE/$BASE"               # 全局 node_modules 下的包路径
    BIN_DIR="$PREFIX/bin"                      # 全局 bin

    info "源目录      : $SRC_DIR"
    info "包名        : $PKG_NAME"
    info "全局 prefix : $PREFIX"
    info "安装到      : $DEST"
    info "bin symlink : $BIN_DIR/$BIN_KEY -> $DEST/$BIN_REL"

    return 0
}

# ========================================================
# 权限检查
check_permission() {
    step "checking write permission on $PREFIX ..."

    if [ ! -w "$PREFIX" ]; then
        error "$PREFIX is not writable"
        info "using nvm: reopen terminal or source nvm then retry"
        info "system npm: run with sudo bash offline_install.sh"
        return 1
    fi

    success "permission OK"
    return 0
}

# ========================================================
# 清理旧版
clean_old_version() {
    if [ -e "$DEST" ]; then
        step "cleaning previous install at $DEST ..."
        execute rm -rf "$DEST" || return 1
        success "previous install removed"
    else
        info "no previous install found, skipping clean"
    fi
    return 0
}

# ========================================================
# 复制 package.json / bin / out / node_modules
copy_files() {
    step "copying package.json bin out node_modules ..."

    execute mkdir -p "$DEST" || return 1

    local item
    for item in package.json bin out node_modules; do
        if [ -e "$SRC_DIR/$item" ]; then
            execute cp -a "$SRC_DIR/$item" "$DEST/" || return 1
        fi
    done

    execute chmod +x "$DEST/$BIN_REL" 2>/dev/null || true

    success "files copied to $DEST"
    return 0
}

# ========================================================
# 创建 bin 软链接（相对路径，对齐 npm i -g 行为）
# npm 自身用的就是相对路径：$PREFIX/bin -> ../lib/node_modules/...
# 这样整个 $PREFIX 目录搬走软链接也不会断
create_bin_symlink() {
    step "creating bin symlink..."

    # 计算从 BIN_DIR 到 target 的相对路径
    # BIN_DIR = $PREFIX/bin,  ROOT_G = $PREFIX/lib/node_modules
    # 相对路径恒为 ../lib/node_modules/$SCOPE/$BASE/$BIN_REL
    local target="$DEST/$BIN_REL"
    local link="$BIN_DIR/$BIN_KEY"
    local rel_target

    # 优先用 realpath --relative-to（coreutils >= 8.23），失败则手工拼
    if command -v realpath &>/dev/null; then
        rel_target="$(realpath --relative-to="$BIN_DIR" "$target" 2>/dev/null || true)"
    fi
    if [ -z "${rel_target:-}" ]; then
        # 手工拼：从 $PREFIX/bin 出发，回到 $PREFIX 再下到 lib/node_modules
        rel_target="../lib/node_modules/$SCOPE/$BASE/$BIN_REL"
    fi

    execute mkdir -p "$BIN_DIR" || return 1

    # 清理旧链接/旧脚本
    if [ -e "$link" ] || [ -L "$link" ]; then
        execute rm -f "$link" || return 1
    fi

    execute ln -s "$rel_target" "$link" || return 1

    success "symlink created: $link -> $rel_target"
    return 0
}

# ========================================================
# 安装
do_install() {
    check_dependencies || return 1
    read_package_info || return 1
    check_permission || return 1
    clean_old_version || return 1
    copy_files || return 1
    create_bin_symlink || return 1

    # 刷新命令哈希表，确保新的 bin 立即可用
    hash -r 2>/dev/null || true

    success "install completed"
    return 0
}

# ========================================================
# 卸载
do_uninstall() {
    step "uninstalling $PACKAGE_NAME ..."

    # 直接用常量算路径，不依赖源目录 package.json
    PREFIX="$(npm prefix -g 2>/dev/null)"
    ROOT_G="$(npm root -g 2>/dev/null)"
    SCOPE="$(dirname "$PACKAGE_NAME")"
    BASE="$(basename "$PACKAGE_NAME")"
    DEST="$ROOT_G/$SCOPE/$BASE"
    BIN_DIR="$PREFIX/bin"
    BIN_KEY="$PACKAGE_BIN"

    # 1. 删除 node_modules 中的包目录
    if [ -e "$DEST" ]; then
        step "removing $DEST ..."
        execute rm -rf "$DEST" || warning "failed to remove $DEST"
    else
        info "package directory not found: $DEST"
    fi

    # 2. 删除 bin 软链接
    local link="$BIN_DIR/$BIN_KEY"
    if [ -e "$link" ] || [ -L "$link" ]; then
        step "removing symlink $link ..."
        execute rm -f "$link" || warning "failed to remove $link"
    else
        info "symlink not found: $link"
    fi

    hash -r 2>/dev/null || true
    success "uninstall done."
    return 0
}

# ========================================================
# 显示版本信息
show_version() {
    echo ""
    echo -e "file-utils-mcp-toolkit:"
    if command -v "$BIN_KEY" &>/dev/null; then
        info "found at: $(command -v "$BIN_KEY")"
    else
        warning "$BIN_KEY not found in PATH"
    fi
    echo ""
    echo -e "运行 $BIN_KEY 启动（stdio MCP server，等 stdin，Ctrl+C 退出）"
}

# ========================================================
# 打印菜单
do_echo_menu() {
    echo "================================================="
    echo -e "    file-utils-mcp-toolkit offline installer"
    echo "================================================="
    echo -e "ACTION              : ${ACTION}"
    echo -e "PACKAGE_NAME        : ${PACKAGE_NAME}"
    echo -e "PACKAGE_BIN         : ${PACKAGE_BIN}"
    echo -e "SRC_DIR             : ${SRC_DIR:-<none>}"
    echo -e "PKG_JSON            : ${PKG_JSON:-<none>}"
    echo -e "SCRIPT_ABSOLUTE_PATH: ${SCRIPT_ABSOLUTE_PATH}"
    echo -e "SHELL_PARAM         : ($# total) arg=$*"
    echo ""
    echo "================================================="
}

# ========================================================
# 主流程
# ========================================================
do_echo_menu "$@"

if [ "$ACTION" = "uninstall" ]; then
    do_uninstall
else
    do_install || exit 1
    show_version
fi

exit $?
