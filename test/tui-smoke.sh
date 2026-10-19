#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 BrokenShine <xchai404@gmail.com>
#
# SPDX-License-Identifier: MIT
#
# 真实 TUI 冒烟：冷启动 dsh TUI，执行 /atelier list，确认命令确实注册。
# 用法：bash test/tui-smoke.sh
# 环境：ATELIER_E2E_PROFILE（默认 atelier-dev）, ATELIER_TUI_BOOT_SECONDS（默认 12）
set -euo pipefail

profile="${ATELIER_E2E_PROFILE:-atelier-dev}"
session="atelier-tui-smoke-$$"

cleanup() {
  tmux kill-session -t "$session" 2>/dev/null || true
}
trap cleanup EXIT

command -v tmux >/dev/null 2>&1 || { echo "SKIP: tmux 不在 PATH"; exit 0; }
command -v dsh >/dev/null 2>&1 || { echo "SKIP: dsh 不在 PATH"; exit 0; }

tmux new-session -d -s "$session" -x 160 -y 45 "dsh --profile $profile; sleep 30"
sleep "${ATELIER_TUI_BOOT_SECONDS:-12}"

# 斜杠命令可能先弹候选，两次 Enter 确保提交
tmux send-keys -t "$session" '/atelier list' Enter
sleep 2
tmux send-keys -t "$session" Enter
sleep 3

out="$(tmux capture-pane -p -t "$session" -S -200 || true)"
if ! grep -q "## Agents" <<<"$out"; then
  echo "$out" | tail -40
  echo "FAIL: /atelier list 没有输出 Agents 表"
  exit 1
fi

echo "PASS: TUI 冷启动 + /atelier list"
