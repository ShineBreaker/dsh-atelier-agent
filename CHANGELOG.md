# Changelog

本文件采用 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。
版本号语义：patch=不改行为（可攒批）、minor=新能力/行为变化、高危走 -rc.n。

## [0.4.0] - 2026-10-20

定位收敛为 **DSH ↔ 外部 Agent CLI 协调器**（见 `docs/POSITIONING.md`）：
只保留发现、派发、对话、回收、恢复、可见六件事。

### Changed

- 删除不属于协调器边界的模块（约 -3900 行）：主会话角色注入 / plan
  gate / 视觉移交 hooks、17 个 `/<agent>` `/<prompt>` 命令、
  checkpoint/workflow/resume 持久化、SQLite registry 与 completion
  gate、模型时段调度、workfile/session-log 重复落盘、herdr 通用工具。
- 崩溃恢复改为扫描 peer 目录（`runtime/recovery.ts`）：pane 死亡或
  session 不匹配就标死并代写终态，不再维护第二套索引。
- 命令面收敛为单一 `/atelier`（peers/list/read/focus/send/close/recover）。
- `peer` 工具的 `status` 动作统一按 peerId 读 peer 元数据与 status.json。

### Added

- 无原生 session 的 harness（hermes/mcode 等）也能空闲回收：`send` 时
  用上下文重放恢复（新 peer 读取旧 brief/result 文件），旧 peer.json
  记录 `replayedAs`。
- 桌面端（Web / Electron）Peers 面板：`/dsh-atelier` 宿主 RPC +
  `client.js` 的 conversation.view 页（列表、实时输出、舵手发送、
  聚焦、退役、孤儿回收）。
- 真实 `test/e2e-drive.mjs`（`dsh --profile` 真派发 + 文件契约断言）、
  `test/tui-smoke.sh`（TUI 冷启动 + `/atelier list`）；CI 增加 test job。

### Fixed

- `closePeer` 用磁盘 peer 列表判断同页兄弟，不再误杀；关闭时把卡在
  running 的 status.json 收尾为 failed，避免 reopen 后忙碌误判。
- `openPeer` / `reopenPeer` 启动失败时回收 pane 与 peer.json，不再泄漏；
  `ensurePeer` 并发 reopen 去重。
- 后台 watcher 随会话销毁退出，不再向死会话推送；批次推送同样检查。
- herdr `promptAgent` 的 `Atomics.wait` 改为异步等待，外部命令加 10s
  超时，不再冻结宿主事件循环。
- `cleanupOldRuns` 保留所有带 peer.json 的目录，已关闭 peer 仍可恢复。

## [0.3.0] - 2026-10-19

### Changed

- 包名（分发身份）`dsh-atelier` → `dsh-atelier-agent`：npm 上原名已被第三方
  无关项目占用（hurricant/aidenli，0.3.4）。同步改名：`package.json` name、
  `cordis.patch.yml` 挂载行、`index.js` name 导出、命令 definitionId 前缀、
  durable log source kind（`plugin:dsh-atelier-agent`）。
- XDG 数据路径不变（`~/.config/dsh-atelier`、`$XDG_CACHE/dsh-atelier/
  subagents`、registry db），既有配置与 run 状态继续生效。
- 兼容性声明收敛：删除无人读取的 `dsh.engines` 字段（dsh 实际只读顶层
  `peerDependencies["@deepseek-ai/dsh"]`），补顶层 `engines.node >=23.6`
  （`.ts` 迁移层靠 Node type stripping 直跑）。
- 已装 profile 需把 dependencies 与 `dsh.profile.bundles` 里的 `dsh-atelier`
  改为 `dsh-atelier-agent`（link: 路径不变），否则 bundle 解析不到。

### Added

- npm 分发：包改为可发布状态（去 `private`、`publishConfig.access: public`、
  补 `repository` 字段——Trusted Publishing 与 provenance 的硬性要求）；
  安装方式新增 `dsh plugin --profile <name> add dsh-atelier-agent@<version>`。
- CI：`release.yml` 的 tag 触发链路扩为「npm 发布（OIDC Trusted Publishing，
  无长效 token）→ GitHub Release」；registry 已存在该版本时跳过发布，
  重复推 tag 幂等。

### Verified

- node v24.18.0：`node --check` 全量 + 模块图导入通过；冒烟 11/11；
  E2E 注册面用例全通过（真实 peer 派发用例需 pi CLI 在 PATH，发版机
  缺失未复跑）。
- `npm pack --dry-run` 核对 tarball 含 `cordis.patch.yml` 与全部源码目录。

## [0.2.0] - 2026-10-19

peer 编排半边落地：`peer` 工具把任务派发到 herdr/tmux 分屏 pane 里的持久
harness 会话（pi/hermes/claude/codex），文件契约回收结果，harness 原生
resume 无损恢复；与 dsh 原生 `subagent` 互补共存。

### Added

- `peer` 工具：`{agent, task}` 单发、`tasks:[...]` 并行、`chain:[...]` 串行
  链；默认异步派发，完成后自动推送回主会话；管理动作
  `send/wait/read/peers/close/list/status`。
- 迁移层（`core/ runtime/ registry/ lifecycle/ context/`）：pi atelier
  逻辑机械搬迁，`.ts` 经 Node ≥23.6 type stripping 直跑，零构建；
  `bun:sqlite` 已换 `node:sqlite`。
- 命令：`/<agent> <task>`、`/<prompt> <param>`（scout-and-plan /
  implement / implement-and-review / research-and-implement /
  parallel-research / parallel-workers / design-review-implement 七个
  模板）、`/atelier-resume`、`/atelier-workflow`。
- hooks：systemPrompt 注入 8 个内置 agent 提示词 + 命令标记 + plan-mode
  优先级提示；`exit_plan_mode` plan gate；`agent/pre-step` 视觉移交
  （模型无视觉能力时转 visual peer）；session 锚点 + 孤儿认领。
- harness 适配层：herdr/tmux 双复用器探测；`{provider}` 占位符与 mcode
  适配（hermes 的 provider/model 复合名拆参）。
- 配置三层：`~/.config/dsh-atelier/atelier.json`（优先）→
  `~/.config/pi/atelier.json`（迁移回退）→ cordis config 行覆盖。
- 测试：`test/smoke.js`（契约 + 真实 herdr 只读冒烟，11 例）、
  `test/e2e-drive.mjs`（headless E2E，fake ctx 捕获注册面）。
- 文档：README（安装/使用/设计约束）、AGENTS.md（结构/验证/发布约束）、
  `docs/dsh-port-plan.md`（移植计划归档）。

### Fixed

- agent 消息提交改用 `promptAgent`，修 hermes peer 不提交输入的问题。

### Verified

- node v24.18.0：`node --check` 全量 + 模块图导入通过；冒烟 11/11。
- E2E 注册面用例全通过（list/注入/plan gate/视觉移交/workflow/resume/
  孤儿认领/registry 持久化）；真实 peer 派发用例（wait/tasks/chain/
  peers/focus）需 pi CLI 在 PATH，发版机缺失未复跑。

## [0.1.0] - 2026-10-15

首个可用版本：dsh 宿主内调用 herdr 的白名单工具面。

### Added

- `herdr` 工具：status/workspaces/panes/agents/read/split/send 七个动作；
  list 类输出投影为摘要行；split 解析新 pane id 并可在其中执行 command。
- `lib/define-tool.js`：defineTool 手搓等价物（零 @deepseek-ai import 约束
  下的产物，README「设计约束」第 1 条）。
- `lib/herdr.js`：execFileSync 封装，失败返回结构化结果不抛异常。
- `test/smoke.js`：契约测试 + 真实 herdr 只读调用冒烟（11 例）。

### Verified

- herdr 0.9.4 端到端人工验证：workspace create → pane split(--pane,
  --direction down) → pane run → pane read → pane send-text → pane close
  → workspace close，全链路通过；pane id 形状 result.pane.pane_id 与
  parsePaneId 兼容。
- 冒烟测试 11/11 通过（node v24.18.0）。

### Known limits

- 未装进真实 profile 跑宿主加载（沙箱写入受限，见提交说明）；
  `dsh plugin --profile <name> add` + 会话内实调待用户环境放行后补验。
- 无浏览器半边（dsh.client）；无 Config schema（enabled 单字段手写默认）。
