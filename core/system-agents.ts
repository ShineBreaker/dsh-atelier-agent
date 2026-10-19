// SPDX-FileCopyrightText: 2026 BrokenShine <xchai404@gmail.com>
//
// SPDX-License-Identifier: MIT

/**
 * 系统自带 agent 的命名约定。
 *
 * 早先的 PR-9 设想了一套 checkpoint-writer/dream/distill 系统子 agent，
 * 但至今没有代码启动它们，runId 生成/白名单查询也随之移除。当前只保留
 * 一个约定：`atelier-` 前缀的 agent 视为系统 agent，不参与用户任务的
 * 结果去重与展示。
 */
export function isSystemAgent(agentName: string): boolean {
  return agentName.startsWith("atelier-");
}
