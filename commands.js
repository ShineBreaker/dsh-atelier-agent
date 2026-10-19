// SPDX-FileCopyrightText: 2026 BrokenShine <xchai404@gmail.com>
//
// SPDX-License-Identifier: MIT

/**
 * /atelier — 人在环管理命令。
 *
 * 模型走 peer 工具；人需要的是同一份状态的直接入口：看有哪些 peer、
 * 读实时输出、把 pane 拉到前台、直接追加指令、退役。只有一个命令，
 * 不做 /<agent> 之类的角色注入（角色属于 agent preset）。
 */

import { discoverAgents } from "./core/discovery.ts";
import {
  listAvailableHarnesses,
  resolveRouteChain,
} from "./runtime/harness/resolve.ts";
import {
  closePeer,
  focusPeer,
  getPeer,
  listPeers,
  peerBusy,
  readPeer,
  sendToPeer,
} from "./runtime/peer.ts";
import { readDefaultModelFromSettings } from "./runtime/runner.ts";
import { recoverOrphans } from "./runtime/recovery.ts";
import { detectBackend } from "./runtime/multiplexer/detect.ts";

export const name = "atelier-commands";
export const inject = ["commands"];

const HELP = [
  "用法：",
  "  /atelier                 存活 peer 列表",
  "  /atelier list            可用 agent / harness 清单",
  "  /atelier read <id> [n]   读 peer 实时输出（默认 60 行）",
  "  /atelier focus <id>      把 peer 的 pane 所在页拉到前台",
  "  /atelier send <id> <文本> 直接给 peer 追加指令",
  "  /atelier close <id>      退役 peer",
  "  /atelier recover         立即扫描并收尾孤儿 peer",
].join("\n");

function peersTable() {
  const peers = listPeers();
  if (peers.length === 0) {
    return "无存活 peer。模型侧用 peer({agent,task}) 派发。";
  }
  const lines = peers.map(
    (p) =>
      `| ${p.peerId} | ${p.agent} | ${p.harness} | ${p.paneId} | ` +
      `${peerBusy(p) ? `busy(msg#${p.msgSeq})` : "idle"} | ` +
      `${p.nativeSessionId ? "resume" : "replay"} |`,
  );
  return [
    "## Peers",
    "| PeerId | Agent | Harness | Pane | State | Recover |",
    "|--------|-------|---------|------|-------|---------|",
    ...lines,
    "",
    "操作：/atelier read|focus|send|close <id>",
  ].join("\n");
}

function agentsTable(config) {
  const agents = discoverAgents();
  const agentLines = agents.map((a) => {
    const tier = a.tier ?? config.defaultTier;
    const routes =
      tier === "inherit"
        ? [`pi/${readDefaultModelFromSettings()[0] ?? "(inherit)"}`]
        : resolveRouteChain(a, config).map(
            (r) => `${r.harness}${r.model ? `/${r.model}` : ""}`,
          );
    return `| ${a.name} | ${tier} | ${routes.join(" → ") || "(no route)"} | ${a.description.slice(0, 40)} |`;
  });
  const harnessLines = listAvailableHarnesses().map(
    (h) =>
      `- **${h.id}** (\`${h.binaries[0]}\`)` +
      `${h.resumeCommand ? " ·resume" : " ·replay-only"}`,
  );
  return [
    "## Agents",
    "| Name | Tier | Route | Description |",
    "|------|------|-------|-------------|",
    agentLines.join("\n") || "| (none) | | | |",
    "",
    "## Harnesses",
    harnessLines.join("\n") || "(none detected)",
  ].join("\n");
}

export function apply(ctx, cfg) {
  if (cfg.enabled === false) return;
  const config = cfg.atelier;
  return ctx.commands.register({
    definitionId: "dsh-atelier-agent.manage",
    name: "atelier",
    description:
      "管理外部 agent CLI 协调器：peers / list / read / focus / send / close / recover",
    handler: async (invocation) => {
      const parts = invocation.rawInput.trim().split(/\s+/).filter(Boolean);
      const sub = parts[0] ?? "peers";
      const id = parts[1];

      if (sub === "peers") {
        return { kind: "success", text: peersTable() };
      }
      if (sub === "list") {
        return { kind: "success", text: agentsTable(config) };
      }
      if (sub === "help") {
        return { kind: "success", text: HELP };
      }

      if (sub === "read") {
        if (!id) return { kind: "error", text: "用法: /atelier read <id> [lines]" };
        const peer = getPeer(id);
        if (!peer) return { kind: "error", text: `peer "${id}" 不存在或已关闭` };
        const lines = Number.parseInt(parts[2] ?? "60", 10);
        return {
          kind: "success",
          text: readPeer(peer, Number.isFinite(lines) ? lines : 60) || "(no output)",
        };
      }

      if (sub === "focus") {
        if (!id) return { kind: "error", text: "用法: /atelier focus <id>" };
        const peer = getPeer(id);
        if (!peer) return { kind: "error", text: `peer "${id}" 不存在或已关闭` };
        return focusPeer(peer)
          ? { kind: "success", text: `peer ${id} 已拉到前台（pane=${peer.paneId}）` }
          : { kind: "error", text: `peer ${id} 聚焦失败（后端不支持或 pane 已消失）` };
      }

      if (sub === "send") {
        const text = invocation.rawInput
          .trim()
          .slice(`send ${id ?? ""}`.length)
          .trim();
        if (!id || !text) {
          return { kind: "error", text: "用法: /atelier send <id> <文本>" };
        }
        const peer = getPeer(id);
        if (!peer) return { kind: "error", text: `peer "${id}" 不存在或已关闭` };
        await sendToPeer(peer, text);
        return {
          kind: "success",
          text: `已发送到 peer ${id}（msg#${peer.msgSeq}）`,
        };
      }

      if (sub === "close") {
        if (!id) return { kind: "error", text: "用法: /atelier close <id>" };
        const peer = getPeer(id);
        if (!peer) return { kind: "error", text: `peer "${id}" 不存在或已关闭` };
        closePeer(peer);
        return { kind: "success", text: `peer ${id} 已退役（send 可恢复）` };
      }

      if (sub === "recover") {
        let probes;
        try {
          const backend = detectBackend();
          probes = {
            paneAlive: (paneId) => backend.isAlive(paneId),
            agentSession: (paneId) => backend.agentSession?.(paneId) ?? null,
          };
        } catch {
          probes = undefined;
        }
        const report = recoverOrphans(Date.now(), probes);
        return {
          kind: "success",
          text:
            `扫描 ${report.scanned} 个 peer：${report.recovered} 个孤儿标死，` +
            `${report.settled} 个终态代写`,
        };
      }

      return { kind: "error", text: `未知子命令 "${sub}"。\n\n${HELP}` };
    },
  });
}
