# AIUsage Deployment Guide

This guide covers deploying the AIUsage server and connecting devices. For AI-assisted deployment, see the [skills/](../skills/) directory — each skill is in its own folder with YAML frontmatter.

## Overview

AIUsage has two components to set up:

1. **Server** — A Cloudflare Worker + D1 database that receives data and hosts the dashboard
2. **Controller** — A CLI tool installed on each device that scans AI tool logs and syncs data

```
Device 01 ──sync──▶ Cloudflare Worker ──▶ Dashboard
Device 02 ──sync──▶       + D1 DB
Device 03 ──sync──▶
```

## Part 1: Deploy the Server

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/)
- A [Cloudflare](https://dash.cloudflare.com/) account (free tier is enough)

### One-Click Setup

```bash
git clone https://github.com/ennann/aiusage.git
cd aiusage
pnpm install
npx wrangler login
pnpm setup
```

The setup wizard will:
1. Check prerequisites
2. Ask for Worker name, database name, and other options
3. Generate all required secrets (SITE_ID, ENROLL_TOKEN, etc.)
4. Create the D1 database and run migrations
5. Build the Dashboard and Worker
6. Deploy to Cloudflare Workers

After completion, you'll see:
- **Dashboard URL** — your public dashboard
- **SITE_ID** — your deployment identifier
- **ENROLL_TOKEN** — the secret for registering devices

Save these values. The wizard also writes them to `.credentials` in the repo root.

### Manual Setup

<details>
<summary>Click to expand manual steps</summary>

#### 1. Clone and install

```bash
git clone https://github.com/ennann/aiusage.git
cd aiusage
pnpm install
```

#### 2. Login to Cloudflare

```bash
npx wrangler login
```

#### 3. Create D1 database

```bash
npx wrangler d1 create aiusage-db
```

Copy the `database_id` from the output.

#### 4. Configure wrangler.jsonc

Copy the template and fill in your database ID:

```bash
cp packages/worker/wrangler.jsonc.example packages/worker/wrangler.jsonc
```

Edit `packages/worker/wrangler.jsonc`:
- Replace `your-worker-name` with your preferred name
- Replace `your-d1-database-id` with the UUID from step 3

#### 5. Set secrets

```bash
cd packages/worker
npx wrangler secret put SITE_ID              # e.g., site_a1b2c3d4
npx wrangler secret put ENROLL_TOKEN         # any strong random string
npx wrangler secret put DEVICE_TOKEN_SECRET  # a long random string (64+ chars)
npx wrangler secret put PROJECT_NAME_SALT    # any random string
```

#### 6. Run migration

```bash
npx wrangler d1 migrations apply aiusage-db --remote
```

#### 7. Build and deploy

```bash
cd <repo-root>
pnpm build
cd packages/worker
npx wrangler deploy
```

</details>

---

## Part 2: Connect Devices

### Install the controller

```bash
npm install -g @aiusage/cli
```

### Register the device

```bash
aiusage enroll \
  --server https://your-worker.example.com \
  --site-id <SITE_ID> \
  --enroll-token <ENROLL_TOKEN> \
  --device-name "My MacBook"
```

### Sync data

```bash
aiusage sync --today
```

### Enable auto-sync

```bash
aiusage schedule          # default: every 5 minutes
aiusage schedule on --every 1h   # custom interval
```

### Verify

```bash
aiusage doctor
```

Repeat on every machine you want to track.

---

## CLI Reference

| Command | Description |
|---------|-------------|
| `aiusage report [--range 7d\|1m\|3m\|all] [--json]` | Local usage report with cost estimates |
| `aiusage scan [--date YYYY-MM-DD] [--json]` | Scan a single day |
| `aiusage sync [--today] [--lookback N] [--date YYYY-MM-DD]` | Upload data to server |
| `aiusage schedule [on\|off\|status] [--every 5m]` | Manage auto-sync |
| `aiusage enroll --server URL --site-id ID --enroll-token TOKEN` | Register device |
| `aiusage init --server URL --site-id ID` | Initialize local config |
| `aiusage health` | Test server connectivity |
| `aiusage doctor` | Run diagnostic checks |
| `aiusage config set <key> <value>` | Update local settings |

### Config keys

| Key | Example | Description |
|-----|---------|-------------|
| `device.alias` | `"MacBook Pro"` | Device display name |
| `privacy.projectVisibility` | `masked` | `masked` / `hidden` / `plain` |
| `project.alias <path> <name>` | `/path/to/proj MyProj` | Map path to readable name |

---

## Privacy

Only aggregated token counts are uploaded — never conversation content.

Project names on the public dashboard support three modes:

| Mode | Behavior |
|------|----------|
| `masked` (default) | Stable pseudonyms like `Project A1F4` via HMAC |
| `hidden` | Project dimension not shown |
| `plain` | Real project names (private deployments only) |

Configure at two levels:
- **Server-wide**: `PUBLIC_PROJECT_VISIBILITY` in `wrangler.jsonc`
- **Per-device**: `aiusage config set privacy.projectVisibility <mode>`

---

## API Endpoints

### Device API (authenticated)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Connectivity check |
| POST | `/api/v1/enroll` | Register a new device |
| POST | `/api/v1/ingest/daily` | Upload daily usage data |

### Public API (read-only, CORS enabled)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/public/overview?range=7d` | Summary and daily trend |
| GET | `/api/v1/public/breakdowns?range=7d&limit=50` | Detailed breakdowns |

---

## Supported Tools

The controller automatically detects and scans all installed tools:

| Tool | Provider | Log Location |
|------|----------|-------------|
| Claude Code | Anthropic | `~/.claude/projects/` |
| Codex CLI | OpenAI | `~/.codex/sessions/` |
| Copilot CLI | GitHub | `~/.copilot/session-state/` |
| Gemini CLI | Google | `~/.gemini/tmp/` |
| Amp | Sourcegraph | `~/.local/share/amp/threads/` |
| Kimi Code | Moonshot | `~/.kimi/sessions/` |
| Qwen Code | Alibaba | `~/.qwen/tmp/` |
| Droid | — | `~/.factory/sessions/` |
| OpenCode | — | `~/.local/share/opencode/` |
| OpenClaw | — | `~/.openclaw/agents/` |
