# AIUsage Update Guide

This guide explains how to keep your AIUsage deployment up to date with the latest features, bug fixes, and new tool support.

## Overview

AIUsage uses a **fork-based update model**: you fork the repository to your own GitHub account, connect it to Cloudflare Workers via Git integration, and then pull upstream updates whenever a new version is released. Once set up, updates flow automatically — no manual re-deployment needed.

```
ennann/aiusage (upstream)
     │
     │  fork
     ▼
you/aiusage (your fork)
     │
     │  Cloudflare Git integration
     ▼
Cloudflare Worker (auto-deploy on push)
```

## Initial Setup (One-Time)

### Step 1: Fork the repository

Go to [github.com/ennann/aiusage](https://github.com/ennann/aiusage) and click **Fork** to create a copy under your GitHub account.

### Step 2: Connect to Cloudflare Workers

1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Go to **Workers & Pages** > **Create**
3. Select **Import a repository** (or connect via Git)
4. Choose your forked `aiusage` repository
5. Configure the build settings:
   - **Build command**: `pnpm install && pnpm build`
   - **Build output directory**: `packages/worker/dist`
   - **Root directory**: `/` (repository root)
6. Add your environment variables / secrets:
   - `SITE_ID`
   - `ENROLL_TOKEN`
   - `DEVICE_TOKEN_SECRET`
   - `PROJECT_NAME_SALT`
   - `MAX_DEVICES` (optional, default: 10)
   - `PUBLIC_PROJECT_VISIBILITY` (optional, default: `masked`)
   - `DEFAULT_TIMEZONE` (optional, default: `UTC`)
7. Click **Deploy**

Once connected, Cloudflare will automatically rebuild and deploy your Worker every time the `main` branch of your fork receives a push.

### Step 3: Set up D1 database

If you haven't already created the D1 database:

```bash
npx wrangler d1 create aiusage-db
npx wrangler d1 migrations apply aiusage-db --remote
```

Make sure your `wrangler.jsonc` has the correct `database_id`.

## Pulling Upstream Updates

When the upstream repository (`ennann/aiusage`) releases new features or fixes, sync them to your fork:

### Option A: Via GitHub Web UI (Easiest)

1. Go to your fork on GitHub
2. You'll see a banner: **"This branch is X commits behind ennann:main"**
3. Click **Sync fork** > **Update branch**
4. Cloudflare automatically picks up the new commits and redeploys

### Option B: Via Git CLI

```bash
# Add upstream remote (one-time)
git remote add upstream https://github.com/ennann/aiusage.git

# Fetch and merge upstream changes
git fetch upstream
git merge upstream/main

# Push to your fork — triggers Cloudflare auto-deploy
git push origin main
```

### Option C: Via GitHub Actions (Fully Automatic)

Create `.github/workflows/sync-upstream.yml` in your fork:

```yaml
name: Sync Upstream

on:
  schedule:
    - cron: '0 8 * * 1'   # every Monday at 08:00 UTC
  workflow_dispatch:        # allow manual trigger

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Sync upstream
        run: |
          git remote add upstream https://github.com/ennann/aiusage.git
          git fetch upstream
          git merge upstream/main --no-edit
          git push
```

This checks for updates weekly and merges them automatically. Cloudflare then redeploys on the push.

## Updating the CLI

The CLI tool (`@aiusage/cli`) is published to npm independently. Update it on each device:

```bash
npm update -g @aiusage/cli
```

Or install a specific version:

```bash
npm install -g @aiusage/cli@latest
```

The CLI and server are backwards-compatible — a newer CLI works with an older server and vice versa, as long as the `schemaVersion` matches.

## Database Migrations

When an update includes database schema changes (new migration files in `packages/worker/migrations/`), you need to apply them:

```bash
cd packages/worker
npx wrangler d1 migrations apply aiusage-db --remote
```

Migration files are numbered sequentially (e.g., `0001_init.sql`, `0002_add_index.sql`). D1 tracks which migrations have been applied, so it's always safe to run the command — it only applies new ones.

> **Tip**: If you use Cloudflare Git integration, consider adding migration commands to your build pipeline or running them manually after each sync.

## What Gets Updated

| Component | Update Method | Automatic? |
|-----------|--------------|------------|
| **Worker API** | Fork sync → Cloudflare redeploy | Yes (with Git integration) |
| **Dashboard UI** | Fork sync → Cloudflare redeploy | Yes (with Git integration) |
| **CLI tool** | `npm update -g @aiusage/cli` | No (manual per device) |
| **D1 Schema** | `wrangler d1 migrations apply` | No (manual when needed) |
| **Pricing catalog** | Bundled in Worker, updated via fork sync | Yes (with Git integration) |
| **New tool scanners** | Bundled in CLI, updated via npm | No (manual per device) |

## Troubleshooting

- **Merge conflicts after sync** — If you've customized your fork (e.g., modified `wrangler.jsonc`), you may hit merge conflicts. Resolve them locally and push.
- **Build fails after update** — Check the Cloudflare build logs. Usually caused by a Node.js version mismatch. Ensure your build environment uses Node.js >= 18.
- **Missing new features after sync** — Verify the Cloudflare deployment completed. Check **Workers & Pages** > your worker > **Deployments**.
- **CLI version mismatch** — Run `aiusage --version` and compare with the latest on [npm](https://www.npmjs.com/package/@aiusage/cli). Update if behind.
