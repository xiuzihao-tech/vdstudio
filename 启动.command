#!/bin/bash
# 双击启动 FIND AI × 大哲（本地试用，macOS）
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.bun/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
if ! command -v node >/dev/null 2>&1; then
  echo "没找到 Node.js。请到 https://nodejs.org 下载 LTS 版本安装，装好后再双击这个文件。"
  read -n 1 -s -r -p "按任意键关闭…"; exit 1
fi
echo "Node $(node -v)"
node scripts/local.mjs
echo; read -n 1 -s -r -p "已停止。按任意键关闭…"
