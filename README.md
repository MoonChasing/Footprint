```
  _____ ___   ___ _____ ____  ____  ___ _   _ _____
 |  ___/ _ \ / _ \_   _|  _ \|  _ \|_ _| \ | |_   _|
 | |_ | | | | | | || | | |_) | |_) || ||  \| | | |
 |  _|| |_| | |_| || | |  __/|  _ < | || |\  | | |
 |_|   \___/ \___/ |_| |_|   |_| \_\___|_| \_| |_|
```

<p align="center">
  <strong>你在编辑器里的每一秒，都值得被铭记。</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Engine-VSCode%20%5E1.85.0-007ACC?style=flat-square&logo=visual-studio-code" />
  <img src="https://img.shields.io/badge/Storage-SQLite%20(better--sqlite3%20%2B%20WAL)-003B57?style=flat-square&logo=sqlite" />
  <img src="https://img.shields.io/badge/Language-TypeScript-3178C6?style=flat-square&logo=typescript" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" />
  <img src="https://img.shields.io/badge/Env-Local%20%7C%20SSH%20%7C%20WSL%20%7C%20DevContainer-orange?style=flat-square" />
</p>

---

## `> whoami`

**Footprint** 是一个运行在 VS Code 内部的时间追踪引擎。不需要云服务、不需要注册账号、不需要打开浏览器——它就住在你的编辑器里，沉默地记录你的每一次心跳。

> _"If you can't measure it, you can't improve it."_ — Peter Drucker
> _"如果你测量不了它，那不如在本地搞个 SQLite。"_ — 某位匿名极客

---

## `> cat /proc/features`

```text
┌────────────────────────────────────────────────────────────────┐
│  FEATURE                        │  STATUS                      │
├────────────────────────────────────────────────────────────────┤
│  File-level session tracking    │  ✓ per-file granularity      │
│  Idle detection (FSM)           │  ✓ ACTIVE → IDLE → UNFOCUSED │
│  Line change counting           │  ✓ write-through, no buffer  │
│  Multi-env support              │  ✓ Local/SSH/WSL/Container   │
│  Crash recovery                 │  ✓ orphaned session cleanup  │
│  Multi-window safe              │  ✓ SQLite WAL cross-process  │
│  Webview dashboard (Chart.js)   │  ✓ timeline + breakdown      │
│  Data export (JSON)             │  ✓ full dump                 │
│  Accurate duration              │  ✓ clamped to last activity  │
│  UTC+8 day boundaries           │  ✓ host TZ independent       │
│  Cross-machine data unification │  ✓ single ~/.timetrack/data.db│
└────────────────────────────────────────────────────────────────┘
```

---

## `> arch --verbose`

```
                    ┌──────────────────────────┐
                    │     VS Code Extension    │
                    │  (extensionKind: ["ui"]) │
                    └────────────┬─────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
              ▼                  ▼                  ▼
   ┌──────────────────┐ ┌──────────────┐ ┌──────────────────┐
   │ ActivityTracker  │ │  StatusBar   │ │   ReportPanel    │
   │ (State Machine)  │ │  Controller  │ │  (Webview+Chart) │
   └────────┬─────────┘ └──────────────┘ └──────────────────┘
            │
     ┌──────┼─────────┐
     │      │         │
     ▼      ▼         ▼
┌────────┐┌────────┐┌────────────────┐
│  Idle  ││  Line  ││  Environment   │
│Detector││ Change ││    Info        │
│(10s ck)││Counter ││(SSH/WSL/Local) │
└────────┘└───┬────┘└────────────────┘
              │
              ▼ write-through (every edit)
    ┌─────────────────────┐
    │  better-sqlite3     │
    │  + WAL mode         │
    │  ~/.timetrack/      │
    │     data.db         │
    │                     │
    │ ┌─────────────┐     │
    │ │  sessions   │     │
    │ │ line_changes│     │
    │ └─────────────┘     │
    └─────────────────────┘
```

### State Machine: `TrackerState`

```
          window.focus          recordActivity()
              │                       │
              ▼                       ▼
 ┌──────────────────┐  idleTimeout  ┌──────────┐
 │     ACTIVE       │──────────────▶│   IDLE   │
 │  (session open)  │◀──────────────│(no write)│
 └────────┬─────────┘  activity     └──────────┘
          │
          │ window.blur
          ▼
 ┌──────────────────┐
 │    UNFOCUSED     │
 │ (session closed) │
 └──────────────────┘
```

会话关闭时的 `end_time` 会被 clamp 到 `IdleDetector.lastActivity`——而不是简单地用 `Date.now()`。这样从最后一次击键到被判定为 idle 的那段"幻影时间"（最多约一个 `idleTimeout`）不会再被错算成工作时长。

---

## `> lsblk --storage`

数据全部存储在 **`~/.timetrack/data.db`** — 一个纯本地 SQLite 数据库。

### 选用 `better-sqlite3` 而非 `sql.js`

项目早期用过 `sql.js` (WASM)，看似零依赖却带来一堆隐患：写入只能进内存，靠 30s 定时刷盘 + 跨进程合并维持持久化——崩溃丢数据、多窗口互相覆盖、合并失败一刀清盘等问题层出不穷。换回 `better-sqlite3` 后这些问题在架构层被根除。

| | `sql.js` (WASM)         | `better-sqlite3` ← 现在的选择 |
|---|------------------------|------------------------------|
| 写入持久性 | 内存缓冲 + 定时刷盘，断电丢失 | 每条 SQL 返回即落盘 |
| 多窗口并发 | 需要自实现合并刷盘，bug 多 | SQLite WAL 自带跨进程锁 |
| Native addon | ✗ | ✓ (需 `@electron/rebuild` 对齐 Electron ABI) |
| 性能 | 足够用 | ~10x faster，单 INSERT ≈ 0.1ms |
| 部署复杂度 | 零 | 打包阶段需 Python + MSVC，运行时无需 |

### 持久化策略

- **WAL 模式** (`journal_mode = WAL`) + `synchronous = NORMAL`：高吞吐的同时保留 COMMIT 边界的崩溃安全
- **`busy_timeout = 5s`**：多个 VSCode 窗口同时写入时自动等锁，不互相覆盖
- **write-through**：编辑事件、心跳更新、文件切换全部直接 SQL，不再有任何内存缓冲层

### Schema

```sql
sessions (
    id, start_time, end_time, machine_name, remote_type,
    remote_host, project_path, project_name, file_path,
    file_name, language_id, window_id, is_active
)

line_changes (
    id, timestamp, machine_name, remote_type, remote_host,
    project_path, file_path, lines_added, lines_deleted, window_id
)
```

---

## `> quick-start.sh`

```bash
# Clone
git clone git@github.com:MoonChasing/Footprint.git
cd Footprint

# Install deps (需要 Python 3.10+ 用于编译 native module；
# 如果系统 Python 太老，可以用 uv/venv 准备一个新的)
PYTHON="path/to/python.exe" npm install

# Dev mode (watch + auto-rebuild)
npm run watch

# Then press F5 in VS Code to launch Extension Development Host
```

### Build & Package

```bash
# Production build (minified, tree-shaken)
npm run build:prod

# Package as .vsix
# 自动用 @electron/rebuild 把 better-sqlite3 重编到 Electron 37.3.1 ABI，
# 输出针对当前 VSCode 内嵌 runtime 可用的 vsix
npm run package
# → timetrack-0.1.0.vsix

# Install locally
code --install-extension timetrack-0.1.0.vsix
```

如果 VSCode 升级到了新版（带新 Electron），改 `package.json` 里的 `rebuild:native` 脚本里的 `-v 37.3.1` 为对应 Electron 版本号即可。

---

## `> man timetrack`

### Commands

| Command | Keybinding | Description |
|---------|-----------|-------------|
| `TimeTrack: Show Report` | — | 打开 Webview 仪表盘 |
| `TimeTrack: Pause Tracking` | — | 手动暂停追踪 |
| `TimeTrack: Resume Tracking` | — | 恢复追踪 |
| `TimeTrack: Show Today's Summary` | — | 状态栏快速预览今日时长 |
| `TimeTrack: Export Data (JSON)` | — | 导出全量数据为 JSON |

### Configuration (`settings.json`)

```jsonc
{
  // 多少分钟无操作视为 idle（触发 session 关闭）
  "timetrack.idleTimeout": 2,          // min: 0.5, max: 30

  // 心跳间隔：每 N 秒更新一次 session.end_time
  "timetrack.heartbeatInterval": 30,   // min: 10, max: 120

  // 排除规则（glob）
  "timetrack.excludePatterns": [
    "**/.git/**",
    "**/node_modules/**"
  ],

  // 状态栏显示
  "timetrack.showStatusBar": true,

  // 是否追踪 untitled 文件
  "timetrack.trackUntitled": false
}
```

---

## `> htop --internals`

### Heartbeat & Precision

- **心跳频率**：默认 30s，session 的 `end_time` 每次心跳更新
- **End-time clamping**：写入时 `min(Date.now(), idleDetector.lastActivity)`，永不超过用户真实最后活动
- **时间精度**：最大误差 ≈ `heartbeatInterval` (30s)，且永远是**少算**而非多算
- **Idle 检测**：10s polling，O(1) timestamp 比较
- **Line change**：每个 `onDidChangeTextDocument` 事件立即 INSERT，无缓冲、无丢失窗口

### Memory Footprint

- 运行时常驻：单个 `better-sqlite3` 句柄 + WAL 文件
- 无内存累加器、无定时刷盘队列
- 无后台进程、无 daemon、无 network I/O

### Crash Safety

```typescript
// 启动时自动清理上次崩溃遗留的 orphaned sessions
closeOrphanedSessions(db, currentWindowId);
// → UPDATE sessions SET is_active = 0
//   WHERE is_active = 1 AND window_id != ?
//
// end_time 保留为最后一次心跳写入的值——已经是真实工作时长的下界，
// 不会人为补算。
```

WAL 模式 + `synchronous=NORMAL` 保证每个 COMMIT 边界的数据都已落盘，硬重启/断电最多丢失最近一次心跳（≤30s）的 end_time 更新，绝不丢整条 session。

---

## `> uname -a --environments`

Footprint 对 VS Code 的全部远程开发场景提供一等公民支持：

```
┌──────────────┬──────────────────────────────────┐
│ Environment  │ Detection Method                 │
├──────────────┼──────────────────────────────────┤
│ Local        │ vscode.env.remoteName === undef  │
│ SSH Remote   │ remoteName === 'ssh-remote'      │
│ WSL          │ remoteName === 'wsl'             │
│ Dev Container│ remoteName === 'dev-container'   │
│ Codespaces   │ remoteName === 'codespaces'      │
└──────────────┴──────────────────────────────────┘
```

插件以 `extensionKind: ["ui"]` 运行——只装在本地 VS Code 里，但能监听本地 / SSH / WSL / 容器项目的全部文件事件，**所有数据汇总到本机一份 `~/.timetrack/data.db`**。一个 DB 文件，一份完整轨迹。

Report 里的"Projects"图表会用真正的远程主机名（`ssh-remote` 的 `remoteHost` / `wsl` 的发行版名 / 容器名）作为标签后缀，本地项目则不带后缀。

---

## `> tree --tech-stack`

```
src/
├── extension.ts              # 入口：activate/deactivate lifecycle
├── config.ts                 # 配置读取 + glob 排除逻辑
├── types.ts                  # 全局类型定义
├── tracker/
│   ├── ActivityTracker.ts    # 核心状态机 + 事件编排 + end_time clamping
│   ├── IdleDetector.ts       # 10s-poll idle 检测器，暴露 lastActivity
│   └── LineChangeCounter.ts  # 行变更 write-through 计数器
├── database/
│   ├── Database.ts           # better-sqlite3 句柄 + WAL pragma
│   ├── queries.ts            # 全部 SQL 查询（pure functions）
│   └── migrations.ts         # Schema versioning
├── env/
│   └── EnvironmentInfo.ts    # 远程环境嗅探
├── ui/
│   ├── StatusBarController.ts# 状态栏 UI
│   └── ReportPanel.ts        # Webview 宿主
├── utils/
│   └── tz.ts                 # UTC+8 日界 helpers（与宿主时区解耦）
└── webview/
    └── main.ts               # Chart.js 仪表盘前端
```

---

## `> cat /etc/design-decisions`

| 决策 | 理由 |
|------|------|
| `better-sqlite3` + WAL 模式 | 写即落盘 + 跨进程锁，根除 sql.js 时代的丢数据/多窗口冲突问题 |
| `extensionKind: ["ui"]` | 插件只装本地一份，跨 SSH/WSL/容器项目统一落到本机 DB |
| 单文件 DB (`~/.timetrack/data.db`) | 跨项目统一、便于备份、无 workspace 耦合 |
| Line change write-through | 删除内存缓冲层，每次编辑事件立即 INSERT |
| `end_time = min(Date.now(), lastActivity)` | 防止 idle/blur 把"未操作的等待期"计入工时 |
| UTC+8 日界统一 (`src/utils/tz.ts`) | Remote SSH 远程机的时区不再扰动 Report 显示 |
| `npm run package` 自动重编 native module | 避免 vsix 安装时 NODE_MODULE_VERSION 不匹配 |
| 状态机 (ACTIVE/IDLE/UNFOCUSED) | 明确的生命周期管理，避免重复 session |

---

## `> diff HEAD~0 --roadmap`

- [ ] 📊 更丰富的可视化（语言分布饼图、热力图）
- [ ] 🔄 多机器数据同步（可选 Git-backed sync）
- [ ] 🏷️ 项目标签 & 分类统计
- [ ] ⌨️ 击键统计模块
- [ ] 📱 Daily digest 通知
- [ ] 🧪 更完善的测试覆盖

---

## `> contributing`

```bash
# Run tests
npm test

# Type check
npm run lint

# The codebase follows a strict separation:
# - tracker/: pure state logic (testable without vscode)
# - database/: data layer (better-sqlite3, no vscode deps)
# - ui/: presentation (vscode Webview/StatusBar)
# - env/: environment detection (vscode API only)
# - utils/: pure helpers (tz/format)
```

PRs welcome. 保持代码简洁，保持架构清晰。

---

## `> license`

MIT — 拿走，改造，用到你的项目里。

---

<p align="center">
  <sub>Built with ☕ and an unhealthy obsession with knowing exactly where my time goes.</sub>
</p>

<p align="center">
  <code>echo "Every keystroke leaves a footprint." | wall</code>
</p>
