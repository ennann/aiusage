---
name: setup-controller
description: Set up the AIUsage CLI controller on a device to scan local AI tool usage and sync data to the AIUsage server.
trigger: when the user asks to connect a device, set up the CLI, or install the controller
tools:
  - Bash
  - Read
---

# AIUsage Controller Setup Skill

You are setting up the AIUsage controller CLI on the user's device so it can scan local AI tool usage and sync data to their AIUsage server.

## Prerequisites

1. **Node.js >= 18** — run `node --version`
2. **An AIUsage server already deployed** — you need the dashboard URL, SITE_ID, and ENROLL_TOKEN (see `skills/deploy-server/deploy-server.md` if not yet deployed)
3. **At least one AI coding tool installed** — Claude Code, Codex, Copilot CLI, Gemini CLI, etc.

## Step 1: Install the controller

```bash
npm install -g @aiusage/cli
```

Verify:

```bash
aiusage --version
```

## Step 2: Enroll this device

Replace the placeholders with the actual values from the server deployment:

```bash
aiusage enroll \
  --server <DASHBOARD_URL> \
  --site-id <SITE_ID> \
  --enroll-token <ENROLL_TOKEN> \
  --device-name "<descriptive name for this machine>"
```

This registers the device and stores a secure device token at `~/.aiusage/config.json`.

Expected output: JSON with `siteId`, `deviceId`, `issuedAt`, and `configPath`.

## Step 3: Test sync

```bash
aiusage sync --today
```

This scans all installed AI tools and uploads token usage to the server. `--today` includes the current (incomplete) day.

Expected output: list of uploaded dates, days processed count, and cost summary per date.

## Step 4: Enable auto-sync

```bash
aiusage schedule
```

This enables automatic sync every 5 minutes (including today's live data). Uses `launchd` on macOS, `cron` on Linux.

To customize the interval:

```bash
aiusage schedule on --every 30m    # every 30 minutes
aiusage schedule on --every 1h     # every hour
```

## Step 5: Verify

```bash
aiusage doctor
```

All checks should show `✓`. The dashboard URL should now display data.

## Supported Tools (auto-detected)

The controller automatically scans all installed tools. No configuration needed:

| Tool | Log Location |
|------|-------------|
| Claude Code | `~/.claude/projects/` |
| Codex CLI | `~/.codex/sessions/` |
| Copilot CLI | `~/.copilot/session-state/` |
| Gemini CLI | `~/.gemini/tmp/` |
| Amp | `~/.local/share/amp/threads/` |
| Kimi Code | `~/.kimi/sessions/` |
| Qwen Code | `~/.qwen/tmp/` |
| Droid | `~/.factory/sessions/` |
| OpenCode | `~/.local/share/opencode/` |
| OpenClaw | `~/.openclaw/agents/` |

## Optional Configuration

### Project name aliases

Map cryptic paths to readable names:

```bash
aiusage config set project.alias /Users/me/Projects/MyApp MyApp
```

### Privacy

Control how project names appear on the public dashboard:

```bash
aiusage config set privacy.projectVisibility masked   # default: stable pseudonyms
aiusage config set privacy.projectVisibility hidden   # hide project dimension
aiusage config set privacy.projectVisibility plain    # real names (private deployments only)
```

## Useful Commands

| Command | Description |
|---------|-------------|
| `aiusage report --range 7d` | Local usage report (no server needed) |
| `aiusage scan --date 2026-04-01` | Scan a specific day |
| `aiusage sync --lookback 30` | Sync last 30 days |
| `aiusage schedule status` | Check auto-sync status |
| `aiusage schedule off` | Disable auto-sync |
| `aiusage doctor` | Run diagnostic checks |

## Troubleshooting

- **"缺少 siteId"** → Run `aiusage enroll` first with server URL and credentials
- **"缺少 deviceToken"** → Enrollment failed or config lost; re-run `aiusage enroll`
- **"请求失败 (401)"** → ENROLL_TOKEN mismatch or device was disabled; verify with server admin
- **"检测到通过 npx 运行"** → Schedule requires global install: `npm i -g @aiusage/cli`
- **No data after sync** → Check `aiusage scan` locally first; verify tool log directories exist
