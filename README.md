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
  <img src="https://img.shields.io/badge/Storage-SQLite%20(sql.js%20WASM)-003B57?style=flat-square&logo=sqlite" />
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
│  Line change counting           │  ✓ +added / -deleted         │
│  Multi-env support              │  ✓ Local/SSH/WSL/Container   │
│  Crash recovery                 │  ✓ orphaned session cleanup  │
│  Webview dashboard (Chart.js)   │  ✓ timeline + breakdown      │
│  Data export (JSON)             │  ✓ full dump                 │
│  Zero-dependency runtime        │  ✓ sql.js WASM, no native    │
│  Cross-machine data unification │  ✓ single ~/.timetrack/data.db│
└────────────────────────────────────────────────────────────────┘
```

---

## `> arch --verbose`

```
                    ┌──────────────────────────┐
                    │     VS Code Extension    │
                    │      (activation: *)     │
                    └────────────┬─────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                   │
              ▼                  ▼                   ▼
   ┌──────────────────┐ ┌──────────────┐ ┌──────────────────┐
   │ ActivityTracker   │ │ StatusBar    │ │  ReportPanel     │
   │ (State Machine)   │ │ Controller   │ │  (Webview+Chart) │
   └───────┬──────────┘ └──────────────┘ └──────────────────┘
           │
     ┌─────┼─────────┐
     │     │         │
     ▼     ▼         ▼
┌────────┐┌────────┐┌────────────────┐
│  Idle  ││  Line  ││  Environment   │
│Detector││ Change ││    Info        │
│(10s ck)││Counter ││(SSH/WSL/Local) │
└────────┘└───┬────┘└────────────────┘
              │
              ▼
    ┌───────────────────┐
    │   sql.js (WASM)   │
    │  ~/.timetrack/    │
    │    data.db        │
    │                   │
    │ ┌─────────────┐   │
    │ │  sessions   │   │
    │ │ line_changes│   │
    │ └─────────────┘   │
    └───────────────────┘
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

---

## `> lsblk --storage`

数据全部存储在 **`~/.timetrack/data.db`** — 一个纯本地 SQLite 数据库。

选用 **sql.js (WASM)** 而非 `better-sqlite3` 的理由：

| | `better-sqlite3` | `sql.js` (WASM) |
|---|---|---|
| Native addon | ✓ (需要 node-gyp 编译) | ✗ |
| Remote 兼容性 | ✗ (SSH/WSL 需要对应 arch) | ✓ (纯 JS + WASM) |
| 部署复杂度 | 高 | 零 |
| 性能 | ~10x faster | 足够用 |

数据写入采用 **dirty-flag + 30s flush** 策略，原子写入（write-tmp → rename）防止断电丢数据。

### Schema

```sql
sessions (
    id, start_time, end_time, machine_name, remote_type,
    remote_host, project_path, project_name, file_path,
    file_name, language_id, window_id, is_active
)

line_changes (
    id, timestamp, machine_name, remote_type, remote_host,
    project_path, file_path, lines_added, lines_deleted
)
```

---

## `> quick-start.sh`

```bash
# Clone
git clone git@github.com:MoonChasing/Footprint.git
cd Footprint

# Install deps
npm install

# Dev mode (watch + auto-rebuild)
npm run watch

# Then press F5 in VS Code to launch Extension Development Host
```

### Build & Package

```bash
# Production build (minified, tree-shaken)
npm run build:prod

# Package as .vsix
npm run package
# → timetrack-0.1.0.vsix

# Install locally
code --install-extension timetrack-0.1.0.vsix
```

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

- **心跳频率**: 默认 30s，session 的 `end_time` 每次心跳更新
- **时间精度**: 最大误差 = `heartbeatInterval` (30s)
- **Idle 检测**: 10s polling，O(1) timestamp 比较
- **Line change flush**: 60s 节流 + 文件切换时立即 flush

### Memory Footprint

- 运行时内存: sql.js WASM ~2MB + DB in-memory
- Line changes: `Map<filePath, {added, deleted}>` — 稀疏存储，仅 dirty files
- 无后台进程、无 daemon、无 network I/O

### Crash Safety

```typescript
// 启动时自动清理上次崩溃遗留的 orphaned sessions
closeOrphanedSessions(db, currentWindowId);
// → UPDATE sessions SET is_active = 0, end_time = start_time + 60000
//   WHERE is_active = 1 AND window_id != ?
```

---

## `> uname -a --environments`

Footprint 对 VS Code 的全部远程开发场景提供一等公民支持：

```
┌─────────────┬──────────────────────────────────┐
│ Environment │ Detection Method                 │
├─────────────┼──────────────────────────────────┤
│ Local       │ vscode.env.remoteName === undef  │
│ SSH Remote  │ remoteName === 'ssh-remote'      │
│ WSL         │ remoteName === 'wsl'             │
│ Dev Container│ remoteName === 'dev-container'  │
│ Codespaces  │ remoteName === 'codespaces'      │
└─────────────┴──────────────────────────────────┘
```

所有环境的数据统一写入本地机器的 `~/.timetrack/data.db`，通过 `machine_name` + `remote_type` + `remote_host` 三元组区分来源。**一个 DB 文件，一份完整轨迹。**

---

## `> tree --tech-stack`

```
src/
├── extension.ts              # 入口：activate/deactivate lifecycle
├── config.ts                 # 配置读取 + glob 排除逻辑
├── types.ts                  # 全局类型定义（zero-runtime-cost）
├── tracker/
│   ├── ActivityTracker.ts    # 核心状态机 + 事件编排
│   ├── IdleDetector.ts       # 10s-poll idle 检测器
│   └── LineChangeCounter.ts  # 行变更累加器（内存 → DB flush）
├── database/
│   ├── Database.ts           # sql.js 初始化 + dirty-flush 机制
│   ├── queries.ts            # 全部 SQL 查询（pure functions）
│   └── migrations.ts         # Schema versioning
├── env/
│   └── EnvironmentInfo.ts    # 远程环境嗅探
├── ui/
│   ├── StatusBarController.ts# 状态栏 UI
│   └── ReportPanel.ts        # Webview 宿主
└── webview/
    └── main.ts               # Chart.js 仪表盘前端
```

---

## `> cat /etc/design-decisions`

| 决策 | 理由 |
|------|------|
| sql.js WASM 替代 better-sqlite3 | 消除 native addon，完美兼容所有 remote 环境 |
| 单文件 DB (`~/.timetrack/data.db`) | 跨项目统一、便于备份、无 workspace 耦合 |
| Dirty-flag flush (30s) | 平衡写入性能与数据安全 |
| Atomic write (tmp → rename) | 防止 DB corruption |
| 状态机 (ACTIVE/IDLE/UNFOCUSED) | 明确的生命周期管理，避免重复 session |
| Line changes 内存累加 + 批量 flush | 避免高频写入拖慢编辑器 |
| `extensionKind: ["ui", "workspace"]` | 确保 remote 场景正确激活 |

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
# - database/: data layer (sql.js, no vscode deps)
# - ui/: presentation (vscode Webview/StatusBar)
# - env/: environment detection (vscode API only)
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
