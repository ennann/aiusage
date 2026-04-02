<p align="center"><code>npm i -g @aiusage/controller</code></p>

<p align="center">
  <strong>AIUsage</strong> tracks token usage and costs across all your AI tools and devices,<br>
  syncs to your own Cloudflare Worker, and visualizes everything on a public dashboard.
</p>

<p align="center">
  <a href="./README.zh-CN.md">中文</a> | English
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@aiusage/controller"><img src="https://img.shields.io/npm/v/@aiusage/controller?label=npm&color=cb0000&logo=npm" alt="npm" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
  <a href="https://workers.cloudflare.com"><img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Workers" /></a>
  <a href="https://developers.cloudflare.com/d1"><img src="https://img.shields.io/badge/Cloudflare-D1-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare D1" /></a>
  <a href="https://react.dev"><img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white" alt="React" /></a>
  <a href="https://pnpm.io"><img src="https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white" alt="pnpm" /></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript" /></a>
</p>

---

## What is AIUsage?

A self-hosted, privacy-first system for tracking how much you spend on AI coding tools — across every device you own.

- **Scans locally** — reads token usage from AI tool session logs (Claude Code, Codex, Copilot CLI, Gemini CLI, Amp, Kimi Code, Qwen Code, Droid, OpenCode, OpenClaw), never touches conversation content
- **Syncs across devices** — every machine enrolls with its own secure token, data merges on your Worker
- **Visualizes costs** — public dashboard with trends, model breakdowns, cost per session, and more
- **You own the data** — deploys to your Cloudflare account (free tier is enough), no third-party services

```
┌─────────────┐         ┌──────────────────────┐
│  Controller  │── sync ──▶  Cloudflare Worker  │
│   (device)   │         │  + D1 Database       │
└─────────────┘         └──────────┬───────────┘
                                   │
┌─────────────┐              public API
│  Controller  │── sync ──▶        │
│   (device)   │         ┌─────────▼──────────┐
└─────────────┘         │     Dashboard       │
                        │  (read-only web UI) │
                        └─────────────────────┘
```

## Quickstart

### Local reports (no server needed)

```bash
npm i -g @aiusage/controller

aiusage report --range 7d
```

### Deploy your own server

Prerequisites: [Node.js](https://nodejs.org/) >= 18, [pnpm](https://pnpm.io/), a [Cloudflare](https://dash.cloudflare.com/) account

```bash
git clone https://github.com/ennann/aiusage.git
cd aiusage && pnpm install
npx wrangler login
pnpm setup
```

`pnpm setup` walks you through everything — creates the D1 database, generates secrets, builds, and deploys. At the end it prints your dashboard URL, `SITE_ID`, and `ENROLL_TOKEN`.

<details>
<summary>Manual deployment</summary>

```bash
npx wrangler d1 create aiusage-db
# Copy database_id into packages/worker/wrangler.jsonc

npx wrangler d1 migrations apply aiusage-db --remote

npx wrangler secret put SITE_ID
npx wrangler secret put ENROLL_TOKEN
npx wrangler secret put DEVICE_TOKEN_SECRET
npx wrangler secret put PROJECT_NAME_SALT

pnpm build
cd packages/worker && npx wrangler deploy
```

See `packages/worker/wrangler.jsonc.example` for the config template.
</details>

### Connect a device

```bash
npm i -g @aiusage/controller

aiusage enroll \
  --server https://your-worker.example.com \
  --site-id <SITE_ID> \
  --enroll-token <ENROLL_TOKEN> \
  --device-name "My MacBook"

aiusage sync --today
aiusage schedule        # auto-sync every 5 min
```

Repeat on every machine. Each device gets its own secure token.

## CLI

| Command | Description |
|---------|-------------|
| `aiusage report [--range 7d\|1m\|3m\|all]` | Local usage report with cost estimates |
| `aiusage scan [--date YYYY-MM-DD]` | Scan a single day |
| `aiusage sync [--today] [--lookback N]` | Upload data to server |
| `aiusage schedule [on\|off\|status]` | Auto-sync (default every 5 min) |
| `aiusage enroll` | Register this device |
| `aiusage doctor` | Diagnostic checks |
| `aiusage config set <key> <value>` | Update local settings |

## Privacy

Only aggregated token counts are uploaded — never conversation content. Project names on the public dashboard can be:

| Mode | Behavior |
|------|----------|
| `masked` (default) | Stable pseudonyms like `Project A1F4` via HMAC |
| `hidden` | Project dimension not shown |
| `plain` | Real names (private deployments only) |

## Project Structure

```
aiusage/
├── packages/
│   ├── controller/    # CLI tool (@aiusage/controller on npm)
│   ├── worker/        # Cloudflare Worker + D1 API
│   ├── dashboard/     # React SPA analytics UI
│   └── shared/        # Shared types and constants
├── scripts/
│   └── setup.mjs      # One-click deployment wizard
└── docs/
    └── technical-design.md
```

## Docs

- [**Technical Design**](./docs/design-docs/technical-design.md)
- [**Controller README**](./packages/controller/README.md)

## Development

```bash
pnpm install
pnpm build
pnpm lint

cd packages/worker
npx wrangler d1 migrations apply aiusage-db --local
npx wrangler dev
```

## License

[MIT](LICENSE)
