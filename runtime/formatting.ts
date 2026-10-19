// SPDX-FileCopyrightText: 2026 BrokenShine <xchai404@gmail.com>
//
// SPDX-License-Identifier: MIT

/**
 * 结果格式化 — 将 RunResult 数组转换为人类可读的汇总文本
 */

import type { RunResult } from "../core/types.ts";

/** 格式化单个 agent 的运行结果（Return Header 有则展示状态与摘要） */
export function formatResult(r: RunResult): string {
  const icon = r.status === "completed" ? "✓" : "✗";
  const header = r.returnHeader
    ? ` [${r.returnHeader.status}] ${r.returnHeader.summary}`
    : "";
  return `### [${r.agent}] ${icon} (${r.durationMs}ms)${header}\n\n${r.output}`;
}

/** 格式化多个 agent 运行结果的汇总 */
export function formatResults(results: RunResult[]): string {
  const success = results.filter((r) => r.status === "completed").length;
  return `${success}/${results.length} succeeded\n\n${results.map(formatResult).join("\n\n---\n\n")}`;
}
