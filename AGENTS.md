# AGENTS.md — dsh-atelier-agent

DSH 与外部 Agent CLI 之间的**协调器**。`peer` 工具把任务派发到 herdr/tmux 分屏 pane 里的持久 harness 会话（hermes/pi/claude/codex/任意 TUI agent），文件契约（`brief-N/result-N/status.json`）回收结果，空闲回收后经 harness 原生 resume 或上下文重放恢复。与 dsh 原生 `subagent`（进程内子 agent）**互补共存**：轻量子任务走 subagent，跨 CLI/持久/可见的协调走 peer。

定位、职责边界与裁剪原则见 `docs/POSITIONING.md`；本文只记结构与约束。

## 结构

| 层 | 文件 | 职责 |
|---|---|---|
| 入口 | `index.js` | 组合 peer 工具 / `/atelier` 命令 / hooks + 配置装配 |
| 工具 | `tools/peer.js`、`core/schemas.js` | 派发（single/tasks/chain）与管理动作（list/peers/status/send/wait/read/focus/close） |
| 命令 | `commands.js` | 单一 `/atelier` 人在环管理命令 |
| hooks | `hooks.js` | 会话锚点（hostSession）+ 孤儿恢复触发 |
| 核心 | `runtime/{peer,monitor,runner,launcher,recovery}.ts` | peer 生命周期、消息等待、single/parallel/chain、路径、崩溃恢复 |
| harness | `runtime/harness/*` | spec 数据 → adapter、路由解析 |
| mux | `runtime/multiplexer/*` | herdr / tmux 原语（含 10s 命令超时） |
| 发现 | `core/{discovery,context,config,types}.ts` | agent .md 发现、路径、配置、类型 |
| 适配 | `lib/{message,paths,toml,define-tool}.js` | 宿主消息、XDG 路径、TOML、defineTool 复刻 |

## 关键约束（改动前必读）

- **禁 import `@deepseek-ai/*`**：link: 部署解析不到共享 fallback。`defineTool`、`createUserMessage` 等在 `lib/` 自持。
- **工具名 `peer`，不抢 `subagent`**：原生工具族原样保留，零冲突、零时机敏感。早期遮蔽方案的教训：own 层工具不能 restrict/unregister，只能 `layers.peek(agent).tools.data.delete`；若未来需要遮蔽，机制是 `agent/created`→`setImmediate`→`restrict(deny)`→`data.delete`→own 层注册。
- **文件契约是唯一真相源**：`peer.json` + `brief-N` + `result-N` + `status.json`。不引入 SQLite/第二种索引；崩溃恢复靠扫描 peer 目录（`runtime/recovery.ts`）。
- **跨 harness 差异只进 `context/harnesses.toml`**，不在运行时代码里写单 CLI 分支。
- **外部命令必须有 timeout**；禁止 `Atomics.wait` 之类阻塞事件循环的同步等待。
- **配置**：`~/.config/dsh-atelier/atelier.json` 优先，`~/.config/pi/atelier.json` 迁移回退；peer 目录 `$XDG_CACHE/dsh-atelier/subagents`。
- **source kind**：自投递消息带 `source:{kind:"plugin:dsh-atelier-agent"}`。
- **会话锚点**：`hostSession.id` 由 `agent/created` 的 `session.header.id` 写入，peer.json 据此记录归属。
- `.ts` 迁移层依赖 Node ≥23.6 type stripping，无构建。

## 验证

```bash
npm test                                                        # 零依赖契约/恢复冒烟
npm run test:live                                              # 真实 headless 派发 + 文件契约断言（需 HERDR_ENV + profile + 模型）
npm run test:tui                                               # 真实 TUI 冷启动 + /atelier list
node --check index.js hooks.js commands.js tools/*.js lib/*.js # 语法
```

`test/e2e-drive.mjs` 用 `dsh --profile <profile>` 发起真实会话，让模型调用 peer，轮询 `status.json` 终态后断言 brief/result 契约；不依赖 dsh 进程退出。环境不满足时 SKIP。CI 的 `test` job 只跑 `npm test`。

端到端判据：`$XDG_CACHE/dsh-atelier/subagents/<peerId>/` 出现 peer.json/brief-N/result-N/status.json；TUI 内 `/atelier list` 返回 Agents/Harnesses 表。

## 发布

npm + GitHub Release 双渠道，均由 tag 推送经 `.github/workflows/release.yml` 自动完成：npm 走 OIDC Trusted Publishing（无长效 token，自带 provenance），GitHub Release 的 notes 取 CHANGELOG 对应段。版本号 + `CHANGELOG.md` 同 commit，annotated tag 锚定该 commit，推送前核对指向并冷启动。

1. semver 定性：patch = 不改行为（可攒批），minor = 新能力或行为变化（单独发）。
2. `chore(release): 发布 vX.Y.Z`：版本号 + CHANGELOG 同 commit；manifest 类变更走独立 commit。
3. tag 推送前核对：`git log --oneline -1 <tag>` 是 release commit，且 `git branch -a --contains <tag>` 有输出。
4. **首发 bootstrap**（每个新包一次）：包须先在 npm 存在才能配 Trusted Publisher，故首发只能手工 `npm publish --access public`。首发成功后到包页 Settings → Trusted Publisher 配 GitHub Actions（Repository=ShineBreaker/dsh-atelier-agent，Workflow filename=release.yml）；**新配置 2 天内须有一次成功 OIDC 发布**，否则过期。
5. CI 幂等：registry 已存在该版本即跳过 npm 发布（name@version 永久不可复用），只建 GitHub Release。
6. cohort 同步抬：DSH 出新 cohort 时抬 `peerDependencies["@deepseek-ai/dsh"]` 下限，**必须保留 `-rc.x` 后缀**；`dsh.engines` 是死字段，勿再写。
