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
import * as commands from "./commands.js";
import * as hooks from "./hooks.js";
import { loadConfig } from "./core/config.ts";
import { RPC_CHANNEL, createRpcHandler } from "./runtime/rpc.ts";

export const name = "dsh-atelier-agent";

/** 聚合各半边需要的服务（hooks 只用事件，不需要额外服务）。 */
export const inject = ["tools", "commands"];

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
    commands.apply(ctx, cfg),
    hooks.apply(ctx, cfg),
  ];

  // 可选半边：只有 Web / Electron 宿主有 connection 服务。TUI/headless
  // 不满足依赖，回调永不执行，也不阻塞其余注册。
  if (typeof ctx.inject === "function") {
    ctx.inject(["connection"], (scoped) => {
      const rpc = scoped.connection?.rpc;
      if (typeof rpc?.handle !== "function") return;
      try {
        // 路由由 connection 自己的 owner fiber 持有（handle 内部 effect），
        // 不要把它作为本 inject 回调的返回值——那会被 scope 立即回收。
        rpc.handle(RPC_CHANNEL, createRpcHandler(atelierConfig));
        ctx.logger?.info?.(`[atelier:rpc] registered ${RPC_CHANNEL}`);
      } catch (err) {
        // connection 缺 webServer 注入时 rpc.handle 会抛；Web/Desktop 的
        // profile 需要给 connection 行补 `inject: [webStartup, webServer]`。
        ctx.logger?.warn?.(`[atelier:rpc] register failed: ${String(err)}`);
      }
    });
  }
  return () => {
    for (const d of disposers) d?.();
  };
}
