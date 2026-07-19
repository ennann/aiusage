# @aiusage/cli

`@aiusage/cli` 是 AIUsage 命令行工具，用于：

- 发现和管理本机 AI 工具项目
- 扫描本地 AI 编程工具的 Token 用量（Claude Code、Codex、Cursor、Copilot CLI、Copilot VS Code、Gemini CLI、Antigravity、Amp、Kimi Code、Qwen Code、Droid、OpenCode、Pi、Trae）
- 通过 Anthropic Admin API 导入历史用量
- 生成本地用量报告（最近 7 天、30 天、90 天、180 天或全部历史）
- 定时自动同步数据到 AIUsage Worker
- 诊断配置与连接问题

Kimi 同时支持旧版 Kimi CLI 的 `~/.kimi/sessions/` 与新版 Kimi Code 的
`$KIMI_CODE_HOME/sessions/`（默认 `~/.kimi-code/sessions/`）。扫描器仅读取
`wire.jsonl` 中的 Token 计数与会话元数据，不上传对话正文；新版格式参考了
[tokscale](https://github.com/junhoyeo/tokscale) 的 MIT 开源实现。

Trae CN 通过 `aiusage trae sync --edition cn` 调用 Trae 自己的本地 `ai-agent`
接口读取历史 Token 计数，缓存到 `~/.aiusage/trae-cache/sessions/`；不会直接破解
加密数据库。国际版通过 `--edition intl` 在本机读取 Trae IDE 或 Trae Solo 的登录
信息（旧版直接读取、新版在本机解密），并调用官方账号用量 API；实现和缓存解析均与
[tokscale](https://github.com/junhoyeo/tokscale) 的 MIT 开源实现交叉校验。

## 安装

```bash
npm install -g @aiusage/cli
```

或通过 `npx` 直接运行：

```bash
npx @aiusage/cli --help
```

安装后：

```bash
aiusage --help
```

## 命令

### project

发现和管理本机项目。

```bash
aiusage project                         # 列出所有发现的项目（默认）
aiusage project list                    # 同上
aiusage project alias myapp "我的应用"   # 设置项目别名
aiusage project alias                   # 查看所有已配置的别名
aiusage project alias --remove myapp    # 移除别名
```

扫描所有已支持 AI 工具的数据目录，列出发现的项目及其别名和来源。

项目别名在上传前本地解析。两台设备对各自项目目录设置相同的别名，服务端会将其合并为一个项目。

### report

本地用量报告，无需服务端。

```bash
aiusage report                          # 默认: 最近 7 天 + 今天，英文，紧凑模式
aiusage report --range 1m               # 最近 30 天
aiusage report --range 3m               # 最近 90 天
aiusage report --range 6m               # 最近 180 天
aiusage report --range all              # 全部历史
aiusage report --tool trae-cn --range all    # 仅 Trae CN
aiusage report --tool trae-intl --range 6m   # 仅 Trae 国际版
aiusage report --tool trae --range all       # 两个版本合计
aiusage report --detail                 # 展示全部列、热门模型、定价说明
aiusage report --lang zh                # 中文输出
aiusage report --no-emoji               # 禁用标题 emoji
aiusage report --json                   # JSON 输出
```

**紧凑模式**（默认）显示来源和每日汇总表，合并缓存列，保留 2 位小数成本。**详细模式**（`--detail`）展开所有列（CacheRead、CacheWrite、Reasoning），增加热门模型和定价说明，显示 4 位小数成本。

### trae sync

按版本同步 Trae 历史用量，再运行常规报告或看板上传：

```bash
aiusage trae sync --edition cn           # 默认值；Trae CN 本地历史
aiusage trae sync --edition intl --since 180  # 国际版账号最近 180 天
aiusage trae sync --edition all --since 180   # 两边都尝试，任一成功即可

aiusage report --tool trae-cn --range all
aiusage report --tool trae-intl --range 6m
aiusage report --tool trae --range all   # CN + 国际版 + 兼容旧数据
```

如果 Trae CN 未运行，AIUsage 会用仅限本机的调试端口临时启动它，读取官方
`ai-agent` 会话接口，完成后自动退出。如果 Trae 已经在运行但没有开启该端口，
请先退出 Trae 再重试。也可以通过 `--port 9230 --no-launch` 连接自行启动的实例。

Trae 国际版 IDE 与 Trae Solo 共用账号级用量，只会通过第一个可用凭据请求一次，不会
重复统计。AIUsage 会在本机读取或解密 `storage.json` 中的登录信息，并以 `0600` 权限保存到
`~/.aiusage/trae-cache/intl/credentials-{ide,solo}.json`；凭据和对话正文都不会上传。
官方 API 返回的会话级 Token/费用缓存位于
`~/.aiusage/trae-cache/intl/sessions/usage.json`。现有
`~/.config/tokscale/trae-cache/sessions/*.json` 仍会读取，并按会话保留最新快照，避免双算。

报告筛选值为 `trae-cn`、`trae-intl`；`trae` 是两者合计的稳定别名。常规 `sync`
始终按完整日期汇总上传，因此不接受 `--tool`，避免把局部结果当成整日统计。

### 统一日期参数

`scan`、`report`、`sync` 使用同一套日期参数：

```bash
aiusage scan --today                    # 仅今天
aiusage report --date 2026-03-31        # 指定日期
aiusage sync --range 1m                 # 最近 30 天
aiusage report --range 6m               # 最近 180 天
aiusage sync --lookback 14              # 最近 14 天 + 今天
aiusage scan --from 2025-01-01 --to 2026-04-05
```

使用 `--range 1m`，不要写成 `range -1m`。`scan`、`report`、`sync` 支持 `--range 6m`；`report` 额外支持 `--range all`。`scan` 和 `sync` 如需更长历史范围，请明确使用 `--from/--to`。

### scan

扫描本地用量数据并打印明细。

```bash
aiusage scan                            # 昨天
aiusage scan --date 2026-03-31          # 指定日期
aiusage scan --range 1m                 # 最近 30 天
aiusage scan --tool trae-cn --range 6m  # 仅 Trae CN 最近 180 天
aiusage scan --date 2026-03-31 --json   # JSON 输出
```

省略 `--date` 时默认扫描昨天。

### sync

上传用量数据到 Worker。默认：最近 7 天 + 今天。

```bash
aiusage sync                   # 最近 7 天 + 今天
aiusage sync --today           # 仅今天
aiusage sync --date 2026-03-31 # 指定日期
aiusage sync --range 1m        # 最近 30 天
aiusage sync --lookback 14     # 最近 14 天 + 今天
aiusage sync --from 2025-01-01 --to 2026-04-05  # 指定日期范围
```

服务端使用 upsert，重复同步相同日期会安全更新已有数据。

### import

通过 Anthropic Admin API 导入历史 Claude 用量。适用于本地 JSONL 日志已被清理或删除的时间段。

```bash
aiusage import --start 2025-06-01 --end 2025-09-15
aiusage import --key sk-ant-admin... --start 2025-06-01 --end 2025-09-15
```

需要 **Admin API 密钥**（`sk-ant-admin...`），而非普通 API 密钥。前往 [console.anthropic.com](https://console.anthropic.com) → Settings → Admin Keys 获取。

保存密钥（一次性）：

```bash
aiusage config set anthropic-admin-key sk-ant-admin...
```

**注意：** 不要对已有本地扫描数据的日期使用 `import`，否则会重复计数。

### init

初始化本地配置。

```bash
aiusage init --server https://your-worker.example.com --site-id your-site-id
```

### health

测试与 Worker 的连通性。

```bash
aiusage health
```

### enroll

将本设备注册到 Worker。

```bash
aiusage enroll \
  --server https://your-worker.example.com \
  --site-id your-site-id \
  --enroll-token your-enroll-token \
  --device-name "MacBook Pro"
```

### schedule

管理定时同步。macOS 使用 `launchd`，Linux 使用 `cron`。

```bash
aiusage schedule on             # 启用，默认每 5 分钟
aiusage schedule on --every 30m # 自定义间隔
aiusage schedule off            # 关闭
aiusage schedule status         # 查看当前状态
```

支持间隔：`5m` – `1d`。定时同步始终包含今日实时数据，确保看板数据及时更新。

### doctor

运行诊断检查，包括配置、服务端连通性、扫描目录和定时任务状态。

```bash
aiusage doctor
```

### config set

管理本地设置。

```bash
aiusage config set lang zh                              # 默认语言: en 或 zh
aiusage config set emoji false                          # 禁用报告标题 emoji
aiusage config set device.alias "MacBook Pro 工作机"      # Dashboard 上显示的设备名称
aiusage config set privacy.projectVisibility masked     # hidden | masked | plain
aiusage config set project.alias MyApp "我的应用"        # 推荐用 aiusage project alias
aiusage config set anthropic-admin-key sk-ant-admin...  # 用于 aiusage import
```

**设备别名**会在 Dashboard 上显示，用于区分多台设备。建议设置为容易辨认的名称：

```bash
aiusage config set device.alias "💻 MacBook Pro"
aiusage config set device.alias "🖥️ iMac Studio"
```

CLI 标志（`--lang`、`--no-emoji`）会覆盖配置值（仅当次生效）。

## 配置

配置文件：`~/.aiusage/config.json`

同步日志（定时任务启用时）：`~/.aiusage/sync.log`

## 许可证

MIT
