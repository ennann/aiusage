# @aiusage/cli

`@aiusage/cli` is the AIUsage command-line tool for:

- discovering and managing projects across AI tools
- scanning local Claude Code, Codex, Cursor, Copilot CLI, Copilot for VS Code, Gemini CLI, and Antigravity usage
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

Scans data directories for Claude Code, Codex, Cursor, Copilot CLI, Copilot for VS Code, Gemini CLI, and Antigravity, listing discovered projects with their aliases and sources.

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

Reads data from local tool data directories including `~/.claude/projects` (Claude Code), `~/.codex` (Codex), Cursor local state plus usage export, VS Code Copilot Chat logs, and `~/.gemini/antigravity` (Antigravity).

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

Upload usage data to the Worker. Covers the last 7 closed days by default.

```bash
aiusage sync
aiusage sync --today           # include today's live data
aiusage sync --date 2026-03-31
aiusage sync --lookback 14
```

Use `--today` to upload the current (incomplete) day. The server upserts, so partial data is updated on next sync.

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
aiusage config set device.alias "MacBook Pro 工作机"
aiusage config set privacy.projectVisibility masked
aiusage config set project.alias MyApp "我的应用"  # prefer: aiusage project alias
```

CLI flags (`--lang`, `--no-emoji`) override config values for a single run.

## Configuration

Config file: `~/.aiusage/config.json`

Sync log (when scheduled): `~/.aiusage/sync.log`

## License

MIT
