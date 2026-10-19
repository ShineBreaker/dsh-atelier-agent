// SPDX-FileCopyrightText: 2026 BrokenShine <xchai404@gmail.com>
//
// SPDX-License-Identifier: MIT

/**
 * 协调器 hooks — 只做两件事：
 *
 *   1. 会话锚点：把宿主 session id 记进 hostSession，供 peer.json 归属。
 *   2. 崩溃恢复：启动时按 status/peer 文件重建索引，并在 session 就绪后
 *      认领上一进程留下的孤儿 peer（一次）。
 *
 * 主会话角色注入、plan review gate、视觉移交都不属于跨 CLI 协调，
 * 已移除。
 */

import { isSubagent } from "./lib/message.js";
import { hostSession } from "./core/session.ts";
import { detectBackend } from "./runtime/multiplexer/detect.ts";
import { orphanRecovery } from "./registry/orphan-recovery.ts";
import { rebuildFromStatusFiles } from "./registry/registry.ts";

export const name = "atelier-hooks";

export function apply(ctx, cfg) {
  if (cfg.enabled === false) return;

  // ── 启动重建索引（best-effort）─────────────────────────────────────
  let registryOk = false;
  try {
    const report = rebuildFromStatusFiles();
    registryOk = true;
    if (report.indexed > 0) {
      ctx.logger.info(
        `[atelier:registry] indexed ${report.indexed} runs from status.json`,
      );
    }
  } catch (err) {
    ctx.logger.warn(
      `[atelier:registry] init failed, continuing without index: ${String(err)}`,
    );
  }

  // ── 孤儿认领（每次进程一次）────────────────────────────────────────
  let orphanDone = false;
  const runOrphanRecoveryOnce = () => {
    if (orphanDone || !registryOk) return;
    orphanDone = true;
    try {
      let probes;
      try {
        const backend = detectBackend();
        probes = {
          paneAlive: (id) => backend.isAlive(id),
          agentStatus: (id) => backend.agentStatus?.(id) ?? null,
          agentSession: (id) => backend.agentSession?.(id) ?? null,
        };
      } catch {
        probes = undefined;
      }
      const r = orphanRecovery(Date.now(), probes);
      if (r.recovered + r.settled > 0) {
        ctx.logger.info(
          `[atelier:registry] orphan recovery: ${r.recovered} 孤儿收尾, ${r.settled} 代写终态` +
            `（session ${hostSession.id?.slice(0, 8)}…）`,
        );
      }
    } catch (err) {
      ctx.logger.warn(`[atelier:registry] orphan recovery failed: ${String(err)}`);
    }
  };

  const disposers = [
    ctx.on("agent/created", ({ agent }) => {
      if (isSubagent(agent)) return;
      if (!hostSession.id && agent?.session?.header?.id) {
        hostSession.id = agent.session.header.id;
        runOrphanRecoveryOnce();
      }
    }),
    ctx.on("agent/disposed", ({ agent }) => {
      if (isSubagent(agent)) return;
      hostSession.id = null;
    }),
  ];

  return () => {
    for (const d of disposers) d?.();
  };
}
