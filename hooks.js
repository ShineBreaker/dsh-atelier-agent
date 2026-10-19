// SPDX-FileCopyrightText: 2026 BrokenShine <xchai404@gmail.com>
//
// SPDX-License-Identifier: MIT

/**
 * 协调器 hooks — 只做两件事：
 *
 *   1. 会话锚点：把宿主 session id 记进 hostSession，供 peer.json 归属。
 *   2. 崩溃恢复：宿主 session 就绪后扫描 peer 目录，认领上一进程留下的
 *      孤儿 peer（一次）。
 *
 * 主会话角色注入、plan review gate、视觉移交都不属于跨 CLI 协调，
 * 已移除。
 */

import { isSubagent } from "./lib/message.js";
import { hostSession } from "./core/session.ts";
import { detectBackend } from "./runtime/multiplexer/detect.ts";
import { recoverOrphans } from "./runtime/recovery.ts";

export const name = "atelier-hooks";

export function apply(ctx, cfg) {
  if (cfg.enabled === false) return;

  // ── 孤儿认领（每次进程一次）────────────────────────────────────────
  let orphanDone = false;
  const runOrphanRecoveryOnce = () => {
    if (orphanDone) return;
    orphanDone = true;
    try {
      let probes;
      try {
        const backend = detectBackend();
        probes = {
          paneAlive: (id) => backend.isAlive(id),
          agentSession: (id) => backend.agentSession?.(id) ?? null,
        };
      } catch {
        probes = undefined;
      }
      const report = recoverOrphans(Date.now(), probes);
      if (report.recovered + report.settled > 0) {
        ctx.logger.info(
          `[atelier:recovery] ${report.recovered} 孤儿标死, ${report.settled} 终态代写` +
            `（session ${hostSession.id?.slice(0, 8)}…）`,
        );
      }
    } catch (err) {
      ctx.logger.warn(`[atelier:recovery] failed: ${String(err)}`);
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
