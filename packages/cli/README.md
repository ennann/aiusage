# @aiusage/cli

`@aiusage/cli` is the AIUsage command-line tool for:

- scanning local Claude Code and Codex token usage
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

### report

Local usage report. No cloud upload required.

```bash
aiusage report --range 7d
aiusage report --range 1m
aiusage report --range 3m
aiusage report --range all
aiusage report --range 7d --json
```

Reads data from `~/.claude/projects` (Claude Code) and `~/.codex` (Codex).

The report includes events, token breakdowns (input / cache read / cache write / output / reasoning), grouped totals by source, daily trend, top models, and estimated USD cost based on public pricing.

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
aiusage config set device.alias "MacBook Pro 工作机"
aiusage config set privacy.projectVisibility masked
aiusage config set project.alias /Users/me/Projects/MyApp MyApp
```

## Configuration

Config file: `~/.aiusage/config.json`

Sync log (when scheduled): `~/.aiusage/sync.log`

## License

MIT
