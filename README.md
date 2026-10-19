# dsh-atelier-agent

DSH 与外部 Agent CLI 之间的**协调器**：让 DSH 主会话发现本机的
hermes / pi / claude / codex 等 CLI，把任务派发到持久会话，持续追问、
纠偏，结构化收回结果，并在空闲后恢复会话。定位、职责边界与裁剪
原则见 [docs/POSITIONING.md](docs/POSITIONING.md)。

`peer` 工具把任务派发到分屏 pane 里的持久 harness 会话，文件契约
（`brief-N.md`/`result-N.md`/`status.json`）结构化回收结果；peer 空闲
超时自动回收 pane，`send` 时经 harness 原生 resume 或上下文重放恢复。
与 dsh 原生 `subagent`（进程内子 agent）**互补共存**：轻量子任务走
`subagent`，跨 CLI 厂商/持久交互/人工可见的协调走 `peer`。

## 安装

```sh
# npm
dsh plugin --profile <name> add dsh-atelier-agent@<version>
# 开发期：本地仓库
dsh plugin --profile <name> add git+file:///path/to/dsh-atelier-agent
```

装完在 profile 的 `cordis.patch.yml` 加挂载行（裸包名，勿用子路径）：

```yaml
- insert:
    - id: dsh-atelier-agent
      name: 'dsh-atelier-agent'
```

本包的 `dsh.bundle.patch` 自带同样一行，经 `dsh plugin add` 会自动并入
profile manifest；手改 patch 时才需要上面这步。

## 使用

### `peer` 工具（模型可见）

**派发**

| 参数 | 语义 |
|---|---|
| `{agent, task}` | 单发。默认异步：立即返回 peerId，完成后推送结果 |
| `{tasks: [...]}` | 并行，每个任务一个 peer |
| `{chain: [...]}` | 串行链；`{previous}` / `{task}` 占位符；同 agent + 同 harness 复用同一 peer |
| `wait: true` | 就地阻塞到本条消息完成（仅在后续工具强依赖结果时用） |

**管理**（`action`）

| action | 语义 |
|---|---|
| `list` | 可用 agent / harness 清单 |
| `peers` | 存活 peer 池 |
| `status` | peer 元数据 + 当前 status.json |
| `send` | 追加指令：忙碌=舵手纠偏，空闲=新任务，已回收=resume/重放恢复 |
| `wait` | 收某 peer 当前消息结果 |
| `read` | 读 peer 实时 transcript |
| `focus` | 把 peer 的 pane 所在页拉到前台 |
| `close` | 退役 peer |

### `/atelier` 命令（人可见）

```
/atelier                 存活 peer 列表
/atelier list            可用 agent / harness 清单
/atelier read <id> [n]   读实时输出
/atelier focus <id>      拉到前台
/atelier send <id> <文本> 直接追加指令
/atelier close <id>      退役
/atelier recover         立即扫描并收尾孤儿
```

### 配置

`~/.config/dsh-atelier/atelier.json`（优先）或 `~/.config/pi/atelier.json`
（迁移回退）；cordis config 行 `{atelier: {...}}` 可覆盖。主要字段：

| 字段 | 默认 | 说明 |
|---|---|---|
| `tiers` / `defaultTier` | `{}` / `pro` | tier → harness/model 路由链 |
| `peerApproval` | `full` | harness 自治级别（full/safe/off） |
| `autoClose` / `idleGraceMs` | `true` / `120000` | 完成后空闲回收与追问宽限期 |
| `maxPeers` | `8` | 存活 peer 上限 |
| `peerReadyTimeoutMs` | `30000` | TUI 就绪等待上限 |
| `maxTasks` / `maxConcurrency` | `8` / `4` | 并行批次上限 |
| `harnessArgs` | `{}` | per-harness 追加参数 |
| `timeoutMs` | `1800000` | 单条消息等待上限 |

agent 角色在 `context/agents/*.md`，用户可在
`~/.config/dsh-atelier/agents/` 覆盖；harness 能力声明在
`context/harnesses.toml`。

## 开发

```sh
npm test                                                        # 契约/恢复冒烟
npm run test:live                                               # 真实 headless 派发（需 herdr + profile + 模型）
npm run test:tui                                                # 真实 TUI 冷启动 + /atelier list
node --check index.js hooks.js commands.js tools/*.js lib/*.js  # 语法
node --input-type=module -e "await import('./index.js')"        # 模块图
```

环境管理沿用仓库根的 direnv 约定（.envrc）；本包纯 Node 内置能力，
`.ts` 迁移层靠 Node ≥23.6 type stripping 直跑，不需要构建。

## 设计约束（改动前必读）

1. **零 `@deepseek-ai` import**。dsh 核心家族只在 CLI 启动器的 pnpm
   虚拟树里；`defineTool` 用手搓等价物（lib/define-tool.js），宿主
   API 全经 ctx 服务与事件获取。
2. **零依赖、零构建**。纯 ESM。
3. **挂载行必须裸包名**。子路径行会让 `dsh.client` 声明被静默跳过。
4. **文件契约是唯一真相源**。不引入第二种状态库。
5. **工具名 `peer` 不抢 `subagent`**——互补设计的历史决策与遮蔽
   机制存档见 AGENTS.md。

## 桌面端

Web / Electron 桌面共用同一套客户端插件机制。装进 Web profile 后，
会话视图会多一个 **Peers** 页：存活 peer 列表、实时输出、舵手发送、
聚焦 pane、退役与孤儿回收。宿主侧 RPC 走 `ctx.inject(["connection"])`
动态注册，TUI/headless 没有该服务时自动跳过。

Web/Desktop profile 还需要给 `connection` 行补 `webServer` 注入
（`rpc.handle` 内部访问 `owner.webServer`；`inject` 是整表替换，
`webStartup` 必须复述）：

```yaml
- id: connection
  inject: [ webStartup, webServer ]
```

没有这一行时 `/atelier` 与 peer 派发仍正常，只是面板报
“cannot get property webServer without inject”。

## License

MIT
