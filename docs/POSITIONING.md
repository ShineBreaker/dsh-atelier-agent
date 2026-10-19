# 定位：DSH ↔ 外部 Agent CLI 协调器

## 一句话

`dsh-atelier-agent` 让 DSH 主会话把工作交给本机其他 Agent CLI
（hermes / pi / claude / codex / 任意 TUI agent），并持续与它们对话：
**发现、派发、追问、收回结果、恢复会话、让人看见**。

它只做跨进程边界上的协调，不复制 DSH 宿主已有的能力。

## 不是什么

| 容易混淆的能力 | 归属 | 本插件为何不做 |
|---|---|---|
| 进程内子 agent（spawn/fork） | DSH 原生 `subagent` | 同进程、更快，没有跨 CLI 的边界要协调 |
| 多 agent workflow / 持久化编排 | DSH 原生 `workflow` | 协调器只负责"把一条消息送到另一个进程并收回来" |
| agent 角色库、persona、plan gate、视觉路由 | agent preset / 主会话 hook | 角色与计划评审是 agent 配置，不是跨 CLI 通信 |
| herdr/tmux 的完整控制面 | herdr 自身 | 协调器只需 pane 的创建、写入、读取、存活四件事 |

## 六个职责（第一性原理）

1. **发现**：本机有哪些外部 CLI 可用、各自支持什么（交互/resume/自治 flag）。
2. **派发**：把任务送到持久外部会话；支持单发、并行、串行链。
3. **对话**：会话不因一条任务结束而销毁；可追问、纠偏、解堵。
4. **回收**：以文件契约（`brief-N.md` / `result-N.md` / `status.json`）
   结构化收回结果，并异步推送给主会话。
5. **恢复**：空闲回收后仍能无损（或显式有损）恢复会话；崩溃后可认领孤儿。
6. **可见**：人能在 TUI / 桌面端看到有哪些 peer、在做什么、实时输出是什么。

这六件事之外的功能，默认不做；新增前先回答"它服务于哪个职责"。

## 设计约束

1. **文件契约是唯一真相源**。peer 目录里的 `peer.json` + `brief-N` +
   `result-N` + `status.json` 足够恢复一切；不引入第二种数据库。
2. **跨 harness 差异收敛到 spec 数据**（`context/harnesses.toml`），
   不为单个 CLI 写特殊分支。
3. **失败必须显式**：不吞错、不把"没有可用 harness"当成成功。
4. **零依赖、零构建**：纯 ESM，Node ≥23.6 type stripping。
5. **工具名 `peer` 不抢 `subagent`**：与原生工具族互补共存。
6. **不阻塞宿主事件循环**：所有外部命令都必须有超时。

## 裁剪清单（相对 pi atelier 移植版）

以下模块属于 pi 全家桶或未实现的设计，已从本插件移除：

| 模块 | 行数 | 理由 |
|---|---|---|
| `hooks.js`（plan gate / 视觉移交 / 主会话角色注入） | ~300 | agent 配置与计划评审，不是跨 CLI 协调 |
| `commands.js` 的角色/模板命令 | ~200 | 模型可直接调用 `peer`，无需 17 个斜杠命令 |
| `lifecycle/`（checkpoint / resume / workflow） | ~555 | 与 DSH 原生 workflow 重复 |
| `registry/`（SQLite 索引 + completion gate） | ~950 | 文件契约已能表达状态；索引是第二种真相源 |
| `core/schedule.ts`（模型时段限制） | ~224 | 与协调无关 |
| `runtime/workfile.ts` / `session-log.ts` | ~220 | 与 `result-N.md` 重复的落盘 |
| `registry/return-header.ts` | ~183 | 解析结果只写入无人读取的索引 |
| `tools/herdr.js` | ~220 | 模型已有 `peer`，不需要第二套 pane 控制面 |

保留并收敛的核心：`runtime/{peer,monitor,runner,launcher,multiplexer,harness}`、
`tools/peer.js`、`core/{config,discovery,types,schemas,context}`、`lib/`。

## 需要补强的缺口

1. **人在环命令**：单一 `/atelier` 命令（peers / read / focus / send / close）。
2. **通用恢复**：harness 无原生 session id 时，用历史 `brief/result` 重放上下文。
3. **真实 E2E**：headless 真派发 + 文件契约断言 + TUI 冷启动，进 CI。
4. **桌面端**：peer 列表、实时输出、派发结果推送的 client 面板。
5. **可观测性**：失败原因结构化（harness 缺失 / 启动超时 / blocked / 契约超时）。
