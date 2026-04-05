# @aiusage/cli

`@aiusage/cli` is the AIUsage command-line tool for:

- discovering and managing projects across AI tools
- scanning local Claude Code, Codex, Copilot CLI, and Gemini CLI token usage
- importing historical usage from Anthropic Admin API
- printing local usage summaries for the last 7 days, 30 days, 90 days, or all history
- scheduling automatic sync to an AIUsage Worker
- diagnosing configuration and connectivity issues

## Install

```bash
npm install -g @aiusage/cli
```

Or run it directly with `npx`:

```bash
npx @aiusage/cli --help
```

After installation:

```bash
aiusage --help
```

## Commands

### project

Discover and manage projects on this machine.

```bash
aiusage project                         # list all discovered projects (default)
aiusage project list                    # same as above
aiusage project alias myapp "我的应用"   # set alias for a project
aiusage project alias                   # list all configured aliases
aiusage project alias --remove myapp    # remove alias
```

Scans data directories for Claude Code, Codex, Copilot CLI, and Gemini CLI, listing discovered projects with their aliases and sources.

Project aliases are applied locally before upload. If two devices set the same alias for their respective project directories, the server merges them into one project.

### report

Local usage report. No cloud upload required.

```bash
aiusage report                          # default: last 7 days, English, compact
aiusage report --range 1m               # last 30 days
aiusage report --range 3m               # last 90 days
aiusage report --range all              # all history
aiusage report --detail                 # show all columns, top models, pricing notes
aiusage report --lang zh                # Chinese output
aiusage report --no-emoji               # disable emoji in title
aiusage report --json                   # JSON output
```

Reads data from `~/.claude/projects` (Claude Code) and `~/.codex` (Codex).

**Compact mode** (default) shows Sources and Daily tables with merged Cache column and 2-decimal cost. **Detail mode** (`--detail`) expands all columns (CacheRead, CacheWrite, Reasoning), adds Top Models and Pricing Notes sections, and shows 4-decimal cost.

### scan

Scan a single day and print the breakdown.

```bash
aiusage scan --date 2026-03-31
aiusage scan --date 2026-03-31 --json
```

Defaults to yesterday when `--date` is omitted.

### init

Initialize local configuration.

```bash
aiusage init --server https://your-worker.example.com --site-id your-site-id
```

### health

Test connectivity to the Worker.

```bash
aiusage health
```

### enroll

Register this device with the Worker.

```bash
aiusage enroll \
  --server https://your-worker.example.com \
  --site-id your-site-id \
  --enroll-token your-enroll-token \
  --device-name "MacBook Pro"
```

### sync

Upload usage data to the Worker. Default: last 7 days + today.

```bash
aiusage sync                   # last 7 days + today
aiusage sync --today           # today only
aiusage sync --date 2026-03-31 # specific date
aiusage sync --lookback 14     # last 14 days + today
aiusage sync --from 2025-01-01 --to 2026-04-05  # date range
```

The server upserts, so re-syncing the same dates safely updates existing data.

### import

Import historical Claude usage from the Anthropic Admin API. Useful for recovering data from periods where local JSONL logs were rotated or deleted.

```bash
aiusage import --start 2025-06-01 --end 2025-09-15
aiusage import --key sk-ant-admin... --start 2025-06-01 --end 2025-09-15
```

Requires an **Admin API key** (`sk-ant-admin...`), not a regular API key. Get one at [console.anthropic.com](https://console.anthropic.com) → Settings → Admin Keys.

Save the key once:

```bash
aiusage config set anthropic-admin-key sk-ant-admin...
```

**Important:** Do not use `import` for dates already covered by local scan data — it will double-count.

### schedule

Manage automatic sync. Uses `launchd` on macOS and `cron` on Linux.

```bash
aiusage schedule            # enable, default every 5 minutes
aiusage schedule on         # same as above
aiusage schedule on --every 30m
aiusage schedule off        # disable
aiusage schedule status     # show current status
```

Supported intervals: `5m` – `1d`. Scheduled sync always includes today's live data (`--today`), so your dashboard stays current.

### doctor

Run diagnostic checks on configuration, server connectivity, scanner directories, and schedule status.

```bash
aiusage doctor
```

### config set

Manage local settings.

```bash
aiusage config set lang zh                              # default language: en or zh
aiusage config set emoji false                          # disable emoji in report title
aiusage config set device.alias "MacBook Pro 工作机"      # device display name on dashboard
aiusage config set privacy.projectVisibility masked     # hidden | masked | plain
aiusage config set project.alias MyApp "我的应用"        # prefer: aiusage project alias
aiusage config set anthropic-admin-key sk-ant-admin...  # for aiusage import
```

**Device alias** is shown on the dashboard to distinguish multiple devices. Set it to something recognizable (e.g. your machine name or emoji):

```bash
aiusage config set device.alias "💻 MacBook Pro"
aiusage config set device.alias "🖥️ iMac Studio"
```

CLI flags (`--lang`, `--no-emoji`) override config values for a single run.

## Configuration

Config file: `~/.aiusage/config.json`

Sync log (when scheduled): `~/.aiusage/sync.log`

## License

MIT
