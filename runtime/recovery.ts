// SPDX-FileCopyrightText: 2026 BrokenShine <xchai404@gmail.com>
//
// SPDX-License-Identifier: MIT

/**
 * 崩溃恢复 — 扫描 peer 目录，按 pane 存活与 status.json 收尾。
 *
 * 文件契约是唯一真相源：不维护数据库索引。进程启动、宿主 session 就绪后
 * 跑一次，处理上一进程留下的记录：
 *
 *   - pane 已死（或 pane id 被复用、原生 session 对不上）且 peer.json 仍写
 *     alive=true → 标 alive=false，lastStatus=orphan
 *   - 对应 status.json 仍卡 running → 代写 failed + error，避免下一条
 *     wait 一直等到超时
 *   - pane 仍活 → 不碰（可能是另一个存活会话的 peer，或消息 watcher 正在收尾）
 *
 * 无探针（不在 mux 内）时保守放行，返回零报告。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getSubagentsDir } from "./launcher.ts";

export interface RecoveryProbes {
  paneAlive(paneId: string): boolean;
  agentSession?(paneId: string): string | null;
}

export interface RecoveryReport {
  scanned: number;
  recovered: number;
  settled: number;
}

export function recoverOrphans(
  now = Date.now(),
  probes?: RecoveryProbes,
): RecoveryReport {
  const report: RecoveryReport = { scanned: 0, recovered: 0, settled: 0 };
  if (!probes) return report;
  const root = getSubagentsDir();
  if (!fs.existsSync(root)) return report;

  for (const entry of fs.readdirSync(root)) {
    const dir = path.join(root, entry);
    const peerPath = path.join(dir, "peer.json");
    if (!fs.existsSync(peerPath)) continue;

    let peer;
    try {
      peer = JSON.parse(fs.readFileSync(peerPath, "utf-8"));
    } catch {
      continue;
    }
    if (!peer?.paneId) continue;
    report.scanned++;

    let alive = false;
    try {
      alive = probes.paneAlive(peer.paneId);
    } catch {
      alive = false;
    }

    // pane id 被复用：原生 session 与记录不符 = 旧 peer 已死、pane 换了主人
    let sessionMismatch = false;
    if (alive && peer.nativeSessionId) {
      try {
        const session = probes.agentSession?.(peer.paneId) ?? null;
        sessionMismatch = session !== null && session !== peer.nativeSessionId;
      } catch {
        sessionMismatch = false;
      }
    }

    const orphan = !alive || sessionMismatch;
    if (!orphan) continue;

    if (peer.alive !== false) {
      peer.alive = false;
      peer.lastStatus = "orphan";
      try {
        fs.writeFileSync(peerPath, JSON.stringify(peer, null, 2), "utf-8");
        report.recovered++;
      } catch {
        continue;
      }
    }

    const statusPath = path.join(dir, "status.json");
    try {
      const status = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
      if (status.status === "running") {
        fs.writeFileSync(
          statusPath,
          JSON.stringify({
            ...status,
            status: "failed",
            finishedAt: now,
            error: sessionMismatch
              ? "orphan: pane session mismatch"
              : "orphan: pane gone",
          }),
          "utf-8",
        );
        report.settled++;
      }
    } catch {
      /* status.json 不存在/损坏 → 无需收尾 */
    }
  }

  return report;
}
