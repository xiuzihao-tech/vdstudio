#!/bin/bash
# 双击检测 AI 接口：列出两个站的可用模型、自动选文案模型并实测、实测一条最便宜的 4 秒视频（会扣少量额度）
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.bun/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
node scripts/check-ai.mjs --video --write
echo; read -n 1 -s -r -p "按任意键关闭…"
