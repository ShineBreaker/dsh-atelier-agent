// SPDX-FileCopyrightText: 2026 BrokenShine <xchai404@gmail.com>
//
// SPDX-License-Identifier: MIT

/**
 * 真实 E2E：在真实 DSH 会话里让模型调用 peer，派发到外部 harness，
 * 然后断言文件契约（brief/result/status）。
 *
 *   HERDR_ENV=1 node test/e2e-drive.mjs [agent]
 *
 * 不依赖 dsh 进程退出：协调器的完成信号是 status.json，而不是客户端
 * 收尾速度。轮询到终态后即断言并回收 pane/进程。
 *
 * 依赖：
 *   - herdr server 在跑（或 TMUX 环境）
 *   - 一个装载了 dsh-atelier-agent 的 dsh profile（默认 atelier-headless，
 *     用 ATELIER_E2E_PROFILE 覆盖）
 *   - 该 profile 可用的模型凭据 + 至少一个外部 harness（默认 scout → hermes）
 *
 * 环境不满足时输出 SKIP 并以 0 退出，便于本地随手跑。
 */

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const SUBAGENTS = path.join(
  process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
  "dsh-atelier",
  "subagents",
);
const WAIT_MS = Number(process.env.ATELIER_E2E_TIMEOUT_MS ?? 300_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hasBinary(name) {
  try {
    execFileSync("which", [name], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function skip(reason) {
  console.log(`SKIP: ${reason}`);
  process.exit(0);
}

if (process.env.HERDR_ENV !== "1") skip("HERDR_ENV !== 1（不在 herdr 会话内）");
if (!hasBinary("herdr")) skip("herdr 不在 PATH");
if (!hasBinary("dsh")) skip("dsh 不在 PATH");

const profile = process.env.ATELIER_E2E_PROFILE ?? "atelier-headless";
const agent = process.argv[2] ?? process.env.ATELIER_E2E_AGENT ?? "scout";
const task =
  process.env.ATELIER_E2E_TASK ??
  "只回复 PONG 三个字母；不要读取或写入任何文件，不要执行命令。";
const prompt =
  `调用 peer 工具，参数 {"agent":"${agent}","task":${JSON.stringify(task)},"wait":true}。` +
  `把工具返回内容原样输出，不要总结。`;

const before = new Set(fs.existsSync(SUBAGENTS) ? fs.readdirSync(SUBAGENTS) : []);
console.log(`▶ profile=${profile} agent=${agent}`);

const startedAt = Date.now();
const child = spawn("dsh", ["--profile", profile, prompt], {
  cwd: os.tmpdir(),
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "";
let stderr = "";
child.stdout.on("data", (d) => (stdout += d));
child.stderr.on("data", (d) => (stderr += d));

let dir = null;
let status = null;
const deadline = Date.now() + WAIT_MS;
while (Date.now() < deadline) {
  const dirs = (fs.existsSync(SUBAGENTS) ? fs.readdirSync(SUBAGENTS) : [])
    .filter((d) => d.startsWith("sa-") && !before.has(d))
    .map((d) => path.join(SUBAGENTS, d));
  // 一次派发可能因 harness 启动失败被模型重试，产生多个新 peer：只认
  // 最终 completed 的那个；全失败则继续等，超时后统一报错。
  for (const d of dirs) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(d, "status.json"), "utf-8"));
      if (s.status === "completed") {
        dir = d;
        status = s;
        break;
      }
    } catch {
      /* 尚未落盘 */
    }
  }
  if (dir) break;
  await sleep(2000);
}

// 协调器已完成（或超时）：回收 dsh 进程与 pane
try {
  child.kill("SIGTERM");
  await sleep(1500);
  child.kill("SIGKILL");
} catch {
  /* 已退出 */
}

if (!dir) {
  console.error(stderr.slice(-2000));
  console.error(`FAIL: ${WAIT_MS}ms 内没有 peer 终态；stdout=${stdout.slice(-500)}`);
  process.exit(1);
}
console.log(`peerDir: ${dir}`);

const peer = JSON.parse(fs.readFileSync(path.join(dir, "peer.json"), "utf-8"));
assert.ok(peer.peerId, "peer.json 缺 peerId");
assert.ok(["herdr", "tmux"].includes(peer.mux), `未知 mux: ${peer.mux}`);

const brief = fs.readFileSync(path.join(dir, "brief-1.md"), "utf-8");
assert.match(brief, /atelier 执行契约/, "brief 缺执行契约");
assert.ok(brief.includes(task), "brief 缺任务原文");

assert.ok(fs.existsSync(path.join(dir, "result-1.md")), "缺 result-1.md");
assert.equal(status.msgSeq, 1, `status.msgSeq=${status.msgSeq}`);
assert.equal(status.status, "completed", `status=${status.status}`);

const result = fs.readFileSync(path.join(dir, "result-1.md"), "utf-8");
assert.match(result, /PONG/i, `result 里没有 PONG：${result.slice(0, 300)}`);
// Return Header 是契约建议而非硬门槛：模型偶尔只写裸结果，协调器仍按
// status.json 收尾。这里记录而不判失败，避免 E2E 被模型风格波动搞红。
if (!/\*\*Status\*\*/i.test(result)) {
  console.warn("WARN: result 缺 Return Header（status.json 仍有效）");
}

console.log(
  `PASS: ${peer.peerId} ${peer.agent}@${peer.harness} ${status.status} ` +
    `(${Math.round((Date.now() - startedAt) / 1000)}s)`,
);

// 清理 pane（保留 peerDir 供排查）
try {
  execFileSync("herdr", ["pane", "close", peer.paneId], {
    stdio: "ignore",
    timeout: 5000,
  });
} catch {
  /* pane 可能已自行退出 */
}
