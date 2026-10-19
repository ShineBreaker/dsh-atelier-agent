// SPDX-FileCopyrightText: 2026 BrokenShine <xchai404@gmail.com>
//
// SPDX-License-Identifier: MIT

/**
 * atelier 命令半边 — pi registerCommand 块的 dsh 移植：
 *   - /<agent> <task>    — 空上下文注入 agent prompt；非空派发 peer（异步 + 推送）
 *   - /<prompt> <param>  — 按模板派发 single/parallel/chain（异步 + 推送）
 *
 * 差异：pi 的 ctx.ui.notify 只读回显 → dsh handler 返回 {kind,text}；
 * 派发类结果统一走 followup 推送（与工具异步语义一致，不阻塞命令）。
 */

import {
  createUserMessage,
  deliver,
  hasUserMessage,
  sessionCwd,
} from "./lib/message.js";
import { pendingContextInject } from "./lib/state.js";
import { discoverAgents, discoverPrompts } from "./core/discovery.ts";
import { ensureWorkfile } from "./runtime/workfile.ts";
import {
  executeWithFallback,
  runParallelBatches,
  runChain,
} from "./runtime/runner.ts";
import { formatResults } from "./runtime/formatting.ts";
import { appendSessionLog } from "./runtime/session-log.ts";

export const name = "atelier-commands";
export const inject = ["commands"];

/** 派发完成后投递结果摘要（async 派发路径的推送） */
function pushResults(agent, label, results) {
  const ok = results.filter((r) => r.status === "completed").length;
  deliver(
    agent,
    [
      `📬 [atelier 派发] ${label}: ${ok}/${results.length} 成功`,
      "",
      formatResults(results),
    ].join("\n"),
  );
}

export function apply(ctx, cfg) {
  if (cfg.enabled === false) return;
  const config = cfg.atelier;
  const disposers = [];

  // ── /<agent> <task> ──────────────────────────────────────────────────
  const agents = discoverAgents();
  for (const agent of agents) {
    disposers.push(
      ctx.commands.register({
        definitionId: `dsh-atelier-agent.agent.${agent.name}`,
        name: agent.name,
        description: `${agent.description}（/${agent.name} <任务描述>）`,
        handler: async (invocation) => {
          const task = invocation.rawInput.trim();
          if (!task) {
            return {
              kind: "error",
              text: `用法: /${agent.name} <任务描述>\n例: /${agent.name} 审查当前修改的代码`,
            };
          }
          const hostAgent = invocation.agent;
          const cwd = sessionCwd(hostAgent);

          // ── 空上下文：把 agent prompt 注入主会话 systemPrompt ──
          // pi 走 appendEntry 标记 + before_agent_start 消费；dsh 用
          // pendingContextInject（lib/state.js）由 systemPrompt section
          // 回调消费，然后 followup 投递任务。
          try {
            if (!hasUserMessage(hostAgent?.session)) {
              pendingContextInject.set(String(hostAgent.id), agent.name);
              hostAgent.followup(
                createUserMessage({
                  content: [{ type: "text", text: task }],
                  source: { kind: "user" },
                }),
              );
              return {
                kind: "success",
                text: `已以 ${agent.name} 身份注入任务（主会话直接执行）`,
              };
            }
          } catch {
            // session 读取失败 → 跳过注入，直接走 peer 派发
          }

          // ── 非空上下文：异步派发独立 peer（结果完成后推送） ──
          void (async () => {
            const startedAt = Date.now();
            const result = await executeWithFallback(
              agent,
              task,
              config,
              cwd,
              undefined, // explicitModel
              undefined, // signal —— 与 UI 请求解耦，命令返回后继续跑
              undefined, // topRowTargetPaneId
              50,
            );
            if (result.status === "completed") {
              ensureWorkfile(result, cwd, startedAt);
            }
            appendSessionLog("single", [result]);
            pushResults(hostAgent, `/${agent.name}`, [result]);
          })().catch((err) =>
            deliver(hostAgent, `❌ /${agent.name} 派发失败: ${err.message}`),
          );
          return {
            kind: "success",
            text: `⏳ ${agent.name} 派发中…（完成后自动推送结果）`,
          };
        },
      }),
    );
  }

  // ── /<prompt> <param> ────────────────────────────────────────────────
  const prompts = discoverPrompts();
  const agentNames = new Set(agents.map((a) => a.name));
  for (const prompt of prompts) {
    if (agentNames.has(prompt.name)) continue; // 与 agent 命令冲突，跳过
    disposers.push(
      ctx.commands.register({
        definitionId: `dsh-atelier-agent.prompt.${prompt.name}`,
        name: prompt.name,
        description: `${prompt.description}（/${prompt.name} <${prompt.param}>）`,
        handler: async (invocation) => {
          const paramValue = invocation.rawInput.trim();
          if (!paramValue) {
            return {
              kind: "error",
              text: `用法: /${prompt.name} <${prompt.param}>\n例: /${prompt.name} 重构认证模块`,
            };
          }
          const hostAgent = invocation.agent;
          const cwd = sessionCwd(hostAgent);
          const resolvedEntries = prompt.entries.map((e) => ({
            agent: e.agent,
            task: e.task.replaceAll(`{${prompt.param}}`, paramValue),
          }));

          void (async () => {
            let results;
            if (prompt.mode === "chain") {
              const chainEntries = resolvedEntries.map((e) => {
                const a = agents.find((x) => x.name === e.agent);
                if (!a) throw new Error(`未知 agent: ${e.agent}`);
                return { agent: a, task: e.task };
              });
              results = await runChain(chainEntries, config, cwd, paramValue);
              appendSessionLog("chain", results);
            } else if (prompt.mode === "parallel") {
              const taskEntries = resolvedEntries.map((e) => {
                const a = agents.find((x) => x.name === e.agent);
                if (!a) throw new Error(`未知 agent: ${e.agent}`);
                return { agent: a, task: e.task };
              });
              results = await runParallelBatches(taskEntries, config, cwd);
              appendSessionLog("parallel", results);
            } else {
              const e = resolvedEntries[0];
              const agentCfg = agents.find((x) => x.name === e.agent);
              if (!agentCfg) throw new Error(`未知 agent: ${e.agent}`);
              const singleResult = await executeWithFallback(
                agentCfg,
                e.task,
                config,
                cwd,
                undefined,
                undefined,
              );
              appendSessionLog("single", [singleResult]);
              results = [singleResult];
            }
            pushResults(hostAgent, `/${prompt.name}`, results);
          })().catch((err) =>
            deliver(hostAgent, `❌ /${prompt.name} 派发失败: ${err.message}`),
          );
          return {
            kind: "success",
            text: `⏳ ${prompt.name} 派发中…（完成后自动推送结果）`,
          };
        },
      }),
    );
  }

  return () => {
    for (const d of disposers) d?.();
  };
}
