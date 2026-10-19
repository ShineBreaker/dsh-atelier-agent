// SPDX-FileCopyrightText: 2026 BrokenShine <xchai404@gmail.com>
//
// SPDX-License-Identifier: MIT

/**
 * 宿主 ↔ 客户端 RPC —— Web / Electron 桌面共用。
 *
 * 客户端只读协调器状态并触发人操作（send/close/focus），所有真相仍在
 * 文件契约与 runtime/peer；这里不做任何缓存或第二套状态。
 *
 * 只在宿主提供 `connection` 服务时注册（index.js 用 ctx.inject 动态等），
 * TUI/headless 没有该服务，不受影响。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { SubagentConfig } from "../core/types.ts";
import { discoverAgents } from "../core/discovery.ts";
import {
  closePeer,
  focusPeer,
  getPeer,
  listPeers,
  peerBusy,
  readPeer,
  sendToPeer,
} from "./peer.ts";
import { recoverOrphans } from "./recovery.ts";
import { detectBackend } from "./multiplexer/detect.ts";

export const RPC_CHANNEL = "/dsh-atelier";

type RpcReply =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string } };

const ok = (value: unknown): RpcReply => ({ ok: true, value });
const fail = (code: string, message: string): RpcReply => ({
  ok: false,
  error: { code, message },
});

function peerStatus(peerId: string): unknown {
  const peer = getPeer(peerId);
  if (!peer) return null;
  try {
    return JSON.parse(
      fs.readFileSync(path.join(peer.peerDir, "status.json"), "utf-8"),
    );
  } catch {
    return null;
  }
}

export function createRpcHandler(config: SubagentConfig) {
  return async (endpoint: string, payload: Record<string, unknown> = {}): Promise<RpcReply> => {
    try {
      if (endpoint === "peers") {
        const peers = listPeers().map((p) => ({
          peerId: p.peerId,
          agent: p.agent,
          harness: p.harness,
          paneId: p.paneId,
          busy: peerBusy(p),
          msgSeq: p.msgSeq,
          createdAt: p.createdAt,
          nativeSessionId: p.nativeSessionId ?? null,
          recover: p.nativeSessionId ? "resume" : "replay",
        }));
        const agents = discoverAgents().map((a) => ({
          name: a.name,
          description: a.description,
          tier: a.tier ?? config.defaultTier,
        }));
        return ok({ peers, agents });
      }

      const id = typeof payload.id === "string" ? payload.id : "";

      if (endpoint === "tail") {
        if (!id) return fail("bad_request", "tail 需要 id");
        const peer = getPeer(id);
        if (!peer) return fail("not_found", `peer "${id}" 不存在或已关闭`);
        const lines = Number(payload.lines);
        return ok({
          peerId: id,
          output: readPeer(peer, Number.isFinite(lines) ? lines : 80),
          status: peerStatus(id),
          busy: peerBusy(peer),
        });
      }

      if (endpoint === "send") {
        const text = typeof payload.text === "string" ? payload.text.trim() : "";
        if (!id || !text) return fail("bad_request", "send 需要 id 与 text");
        const peer = getPeer(id);
        if (!peer) return fail("not_found", `peer "${id}" 不存在或已关闭`);
        const sent = await sendToPeer(peer, text);
        return ok({ peerId: id, seq: sent.seq, isNewTask: sent.isNewTask });
      }

      if (endpoint === "close") {
        if (!id) return fail("bad_request", "close 需要 id");
        const peer = getPeer(id);
        if (!peer) return fail("not_found", `peer "${id}" 不存在或已关闭`);
        closePeer(peer);
        return ok({ peerId: id, closed: true });
      }

      if (endpoint === "focus") {
        if (!id) return fail("bad_request", "focus 需要 id");
        const peer = getPeer(id);
        if (!peer) return fail("not_found", `peer "${id}" 不存在或已关闭`);
        return ok({ peerId: id, focused: focusPeer(peer) });
      }

      if (endpoint === "recover") {
        let probes;
        try {
          const backend = detectBackend();
          probes = {
            paneAlive: (paneId: string) => backend.isAlive(paneId),
            agentSession: (paneId: string) => backend.agentSession?.(paneId) ?? null,
          };
        } catch {
          probes = undefined;
        }
        return ok(recoverOrphans(Date.now(), probes));
      }

      return fail("unknown_endpoint", `未知 endpoint: ${endpoint}`);
    } catch (err) {
      return fail("internal", (err as Error)?.message ?? String(err));
    }
  };
}
