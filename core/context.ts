// SPDX-FileCopyrightText: 2026 BrokenShine <xchai404@gmail.com>
//
// SPDX-License-Identifier: MIT

/**
 * Agent prompt 路径与标记工具。
 *
 * agent .md 源文件在插件内置 context/agents/，用户可在
 * ~/.config/dsh-atelier/agents/（→ pi 旧根回退）覆盖/扩展。
 * 文件里的 `<!-- @atelier:subagent -->` 标记只用于让派生 prompt 完整包含
 * 实现细节，启动 peer 时去掉注释标记本身，避免污染模型上下文。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { userAgentDirs } from "../lib/paths.js";

const SUBAGENT_START = /<!--\s*@atelier:subagent\s*-->/;
const SUBAGENT_END = /<!--\s*\/@atelier:subagent\s*-->/;

/** 解析插件内置资源根目录（atelier/）。 */
export function getPluginRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

/** agent .md 候选目录：插件内置优先，用户自定义次之。 */
export function getAgentDirs(): string[] {
  return [path.join(getPluginRoot(), "context", "agents"), ...userAgentDirs()];
}

/** 按优先级查找 agent .md；全部不存在返回 null。 */
export function resolveAgentFile(agentName: string): string | null {
  for (const dir of getAgentDirs()) {
    const candidate = path.join(dir, `${agentName}.md`);
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* 试下一个候选 */
    }
  }
  return null;
}

/** 去掉 subagent-only 标记本身，保留全部内容。 */
export function removeSubagentOnlyMarkers(content: string): string {
  return content
    .split("\n")
    .filter((line) => !SUBAGENT_START.test(line) && !SUBAGENT_END.test(line))
    .join("\n");
}
