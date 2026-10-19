// SPDX-FileCopyrightText: 2026 BrokenShine <xchai404@gmail.com>
//
// SPDX-License-Identifier: MIT

/**
 * dsh-atelier-agent 入口 — DSH 与外部 Agent CLI 的协调器 bundle。
 *
 * peer 工具派发到 herdr/tmux 分屏 pane 里的持久 harness 会话
 * （claude/codex/hermes/pi/…），文件契约（brief-N/result-N/status.json）
 * 回收结果，harness 原生 resume 或上下文重放恢复。
 *
 * 挂载：cordis.patch.yml 裸包名行（子路径行会静默跳过 dsh.client 声明）。
 *
 * 配置两层：atelier.json 文件配置（单一真相源，~/.config/dsh-atelier/
 * atelier.json → ~/.config/pi/atelier.json 迁移回退）+ cordis config 行
 * 覆盖（{atelier: {...字段覆盖}}、{enabled}）。字段同 SubagentConfig。
 */

import * as peerTool from "./tools/peer.js";
import * as hooks from "./hooks.js";
import { loadConfig } from "./core/config.ts";

export const name = "dsh-atelier-agent";

/** 聚合各半边需要的服务（hooks 只用事件，不需要额外服务）。 */
export const inject = ["tools"];

export function apply(ctx, config = {}) {
  if (config.enabled === false) return;

  // atelier.json 文件配置为真相源；cordis config 的 atelier 字段逐键覆盖
  // （config 行里未提供的字段不落默认值——文件层已带 DEFAULT_CONFIG）。
  const fileConfig = loadConfig();
  const atelierConfig = { ...fileConfig, ...(config.atelier ?? {}) };
  const cfg = { ...config, atelier: atelierConfig };

  // 工具半边内部各取所需：apply 返回的都是 disposer。
  const disposers = [
    peerTool.apply(ctx, cfg),
    hooks.apply(ctx, cfg),
  ];
  return () => {
    for (const d of disposers) d?.();
  };
}
