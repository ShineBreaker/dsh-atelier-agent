// SPDX-FileCopyrightText: 2026 BrokenShine <xchai404@gmail.com>
//
// SPDX-License-Identifier: MIT

/**
 * 冒烟测试：协调器注册面与文件契约。
 * 运行：node test/smoke.js（纯本地，不依赖 mux/外部 CLI）。
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as plugin from "../index.js";
import { definition } from "../tools/peer.js";
import { hostSession } from "../core/session.ts";
import { getSubagentsDir } from "../runtime/launcher.ts";
import { recoverOrphans } from "../runtime/recovery.ts";

let failed = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`ok    ${label}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${label}\n      ${err.message}`);
  }
}

// ── 契约：apply 经假 ctx 注册，definition 符合 ToolDefinition 形状 ──

const registeredNames = [];
const listeners = new Map();
const fakeCtx = {
  tools: {
    register(def) {
      registeredNames.push(def.name);
      return () => {};
    },
  },
  on(ev, fn) {
    if (!listeners.has(ev)) listeners.set(ev, []);
    listeners.get(ev).push(fn);
    return () => {};
  },
  logger: { info: () => {}, warn: () => {}, error: () => {} },
};

await check("apply 只注册 peer 工具并交还反注册函数", () => {
  const dispose = plugin.apply(fakeCtx, {});
  assert.deepEqual(registeredNames, ["peer"]);
  assert.equal(typeof dispose, "function");
  dispose();
});

await check("definition 契约形状", () => {
  assert.equal(definition.name, "peer");
  assert.ok(definition.description.length > 0);
  assert.equal(definition.parameters.type, "object");
  assert.ok(definition.parameters.properties.action.enum.includes("send"));
  assert.ok(definition.parameters.properties.action.enum.includes("list"));
  assert.deepEqual(definition.output.render({}, "hello"), [
    { type: "text", text: "hello" },
  ]);
});

await check("enabled:false 不注册", () => {
  registeredNames.length = 0;
  plugin.apply(fakeCtx, { enabled: false });
  assert.equal(registeredNames.length, 0);
});

await check("无参数调用返回参数提示而非崩溃", async () => {
  const out = await definition.execute({}, { agent: { id: "a" } });
  assert.match(out, /参数无效/);
});

// ── 会话锚点 ──

await check("agent/created 锚定 hostSession.id", async () => {
  const handlers = listeners.get("agent/created") ?? [];
  assert.ok(handlers.length > 0);
  for (const h of handlers) {
    await h({ agent: { id: "a1", session: { header: { id: "sess-smoke" } } } });
  }
  assert.equal(hostSession.id, "sess-smoke");
});

// ── 崩溃恢复：pane 已死 + status 卡 running ──

await check("孤儿 peer 被标死并代写终态", async () => {
  const dir = path.join(getSubagentsDir(), "sa-smoke-orphan01");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "peer.json"),
    JSON.stringify({
      peerId: "sa-smoke-orphan01",
      paneId: "w0:p1999",
      agent: "scout",
      harness: "pi",
      alive: true,
      msgSeq: 1,
      sessionId: "sess-smoke",
    }),
  );
  fs.writeFileSync(
    path.join(dir, "status.json"),
    JSON.stringify({ status: "running", msgSeq: 1 }),
  );

  const report = recoverOrphans(Date.now(), { paneAlive: () => false });
  const peer = JSON.parse(fs.readFileSync(path.join(dir, "peer.json"), "utf-8"));
  const status = JSON.parse(fs.readFileSync(path.join(dir, "status.json"), "utf-8"));

  assert.equal(report.recovered, 1);
  assert.equal(report.settled, 1);
  assert.equal(peer.alive, false);
  assert.equal(peer.lastStatus, "orphan");
  assert.equal(status.status, "failed");
  assert.match(status.error, /orphan/);

  fs.rmSync(dir, { recursive: true, force: true });
});

await check("pane 仍活的 peer 不被误伤", () => {
  const dir = path.join(getSubagentsDir(), "sa-smoke-alive01");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "peer.json"),
    JSON.stringify({
      peerId: "sa-smoke-alive01",
      paneId: "w0:p1998",
      agent: "scout",
      harness: "pi",
      alive: true,
      msgSeq: 1,
    }),
  );
  fs.writeFileSync(
    path.join(dir, "status.json"),
    JSON.stringify({ status: "running", msgSeq: 1 }),
  );

  recoverOrphans(Date.now(), { paneAlive: () => true });
  const peer = JSON.parse(fs.readFileSync(path.join(dir, "peer.json"), "utf-8"));
  assert.equal(peer.alive, true);

  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
