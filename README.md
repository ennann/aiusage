<p align="center"><code>npm i -g @aiusage/cli</code></p>

<p align="center">
  <strong>AIUsage</strong> tracks token usage and costs across all your AI tools and devices,<br>
  syncs to your own Cloudflare Worker, and visualizes everything on a public dashboard.
</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> | English
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@aiusage/cli"><img src="https://img.shields.io/npm/v/@aiusage/cli?label=npm&color=cb0000&logo=npm" alt="npm" /></a>
  <a href="https://workers.cloudflare.com"><img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Workers" /></a>
  <a href="https://developers.cloudflare.com/d1"><img src="https://img.shields.io/badge/Cloudflare-D1-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare D1" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
</p>

<p align="center">
  <a href="https://aiusage.yizhe.me"><strong>Live Demo</strong></a>
</p>

---

## What is AIUsage?

A self-hosted, privacy-first system for tracking how much you spend on AI coding tools — across every device you own.

### Supported Tools

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-D97757?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude Code" />
  <img src="https://img.shields.io/badge/Codex_CLI-6BA539?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0yMi4yODIgOS44MjFhNS45ODUgNS45ODUgMCAwIDAtLjUxNi00LjkxIDYuMDQ2IDYuMDQ2IDAgMCAwLTYuNTEtMi45QTYuMDY1IDYuMDY1IDAgMCAwIDQuOTgxIDQuMThhNS45ODUgNS45ODUgMCAwIDAtMy45OTggMi45IDYuMDQ2IDYuMDQ2IDAgMCAwIC43NDMgNy4wOTcgNS45OCA1Ljk4IDAgMCAwIC41MSA0LjkxMSA2LjA1MSA2LjA1MSAwIDAgMCA2LjUxNSAyLjlBNS45ODUgNS45ODUgMCAwIDAgMTMuMjYgMjRhNi4wNTYgNi4wNTYgMCAwIDAgNS43NzItNC4yMDYgNS45OSA1Ljk5IDAgMCAwIDMuOTk3LTIuOSA2LjA1NiA2LjA1NiAwIDAgMC0uNzQ3LTcuMDczek0xMy4yNiAyMi40M2E0LjQ3NiA0LjQ3NiAwIDAgMS0yLjg3Ni0xLjA0bC4xNDEtLjA4MSA0Ljc3OS0yLjc1OGEuNzk1Ljc5NSAwIDAgMCAuMzkyLS42ODF2LTYuNzM3bDIuMDIgMS4xNjhhLjA3MS4wNzEgMCAwIDEgLjAzOC4wNTJ2NS41ODNhNC41MDQgNC41MDQgMCAwIDEtNC40OTQgNC40OTR6TTMuNiAxOC4zMDRhNC40NyA0LjQ3IDAgMCAxLS41MzUtMy4wMTRsLjE0Mi4wODUgNC43ODMgMi43NTlhLjc3MS43NzEgMCAwIDAgLjc4IDBsNS44NDMtMy4zNjl2Mi4zMzJhLjA4LjA4IDAgMCAxLS4wMzMuMDYyTDkuNzQgMTkuOTVhNC41IDQuNSAwIDAgMS02LjE0LTEuNjQ2ek0yLjM0IDcuODk2YTQuNDg1IDQuNDg1IDAgMCAxIDIuMzY2LTEuOTczVjExLjZhLjc2Ni43NjYgMCAwIDAgLjM4OC42NzZsNS44MTUgMy4zNTUtMi4wMiAxLjE2OGEuMDc2LjA3NiAwIDAgMS0uMDcxIDBsLTQuODMtMi43ODZBNC41MDQgNC41MDQgMCAwIDEgMi4zNCA3Ljg3MnptMTYuNTk3IDMuODU1bC01LjgzMy0zLjM4N0wxNS4xMTkgNy4yYS4wNzYuMDc2IDAgMCAxIC4wNzEgMGw0LjgzIDIuNzkxYTQuNDk0IDQuNDk0IDAgMCAxLS42NzYgOC4xMDV2LTUuNjc4YS43OS43OSAwIDAgMC0uNDA3LS42Njd6bTIuMDEtMy4wMjNsLS4xNDEtLjA4NS00Ljc3NC0yLjc4MmEuNzc2Ljc3NiAwIDAgMC0uNzg1IDBMOS40MDkgOS4yM1Y2Ljg5N2EuMDY2LjA2NiAwIDAgMSAuMDI4LS4wNjFsNC44My0yLjc4N2E0LjUgNC41IDAgMCAxIDYuNjggNC42NnptLTEyLjY0IDQuMTM1bC0yLjAyLTEuMTY0YS4wOC4wOCAwIDAgMS0uMDM4LS4wNTdWNi4wNzVhNC41IDQuNSAwIDAgMSA3LjM3NS0zLjQ1M2wtLjE0Mi4wOEw4LjcwNCA1LjQ2YS43OTUuNzk1IDAgMCAwLS4zOTMuNjgxem0xLjA5Ny0yLjM2NWwyLjYwMi0xLjUgMi42MDcgMS41djIuOTk5bC0yLjU5NyAxLjUtMi42MDctMS41eiIvPjwvc3ZnPgo=&logoColor=white" alt="Codex CLI" />
  <img src="https://img.shields.io/badge/Cursor-111827?style=for-the-badge&logo=cursor&logoColor=white" alt="Cursor" />
  <img src="https://img.shields.io/badge/Copilot_CLI-000?style=for-the-badge&logo=githubcopilot&logoColor=white" alt="Copilot CLI" />
  <img src="https://img.shields.io/badge/Copilot_VS_Code-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="Copilot for VS Code" />
  <img src="https://img.shields.io/badge/Gemini_CLI-8E75B2?style=for-the-badge&logo=googlegemini&logoColor=white" alt="Gemini CLI" />
  <img src="https://img.shields.io/badge/Antigravity-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Antigravity" />
  <img src="https://img.shields.io/badge/Amp-FF4F00?style=for-the-badge&logo=sourcegraph&logoColor=white" alt="Amp" />
</p>
<p align="center">
  <img src="https://img.shields.io/badge/Kimi_Code-4A6CF7?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjEwIi8+PC9zdmc+&logoColor=white" alt="Kimi Code" />
  <img src="https://img.shields.io/badge/Qwen_Code-5A29E4?style=for-the-badge&logo=alibabacloud&logoColor=white" alt="Qwen Code" />
  <img src="https://img.shields.io/badge/Droid-2C3E50?style=for-the-badge&logo=android&logoColor=white" alt="Droid" />
  <img src="https://img.shields.io/badge/OpenCode-16A34A?style=for-the-badge&logo=go&logoColor=white" alt="OpenCode" />
  <img src="https://img.shields.io/badge/Pi-6C47FF?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjx0ZXh0IHg9IjUiIHk9IjE4IiBmb250LXNpemU9IjE2IiBmb250LWZhbWlseT0ic2VyaWYiPsO/PC90ZXh0Pjwvc3ZnPg==&logoColor=white" alt="Pi" />
</p>

### Why AIUsage?

- **Scans locally** — reads token usage from session logs, never touches conversation content
- **Syncs across devices** — every machine enrolls with its own secure token, data merges on your Worker
- **Visualizes costs** — public dashboard with trends, model breakdowns, cost per session, and more
- **You own the data** — deploys to your Cloudflare account (free tier is enough), no third-party services

### Architecture

```mermaid
graph LR
  D1["<b>Device 01</b><br/>MacBook Pro"] -- sync --> W["<b>Cloudflare Worker</b><br/>+ D1 Database"]
  D2["<b>Device 02</b><br/>Mac Mini"] -- sync --> W
  D3["<b>Device 03</b><br/>Linux Server"] -- sync --> W
  W -- public API --> Dashboard["<b>Dashboard</b><br/>read-only web UI"]
```

## Quickstart

### Deploy with your AI agent

Copy this prompt, paste it into your AI coding agent (Claude Code, Codex, Copilot, Gemini, etc.):

```text
Clone https://github.com/ennann/aiusage.git, read skills/aiusage-server/aiusage-server.md,
and help me deploy AIUsage to my Cloudflare account.
After the server is up, follow skills/aiusage-cli/aiusage-cli.md to connect this device.
```

### Or deploy manually

```bash
git clone https://github.com/ennann/aiusage.git
cd aiusage && pnpm install
npx wrangler login
pnpm setup
```

### Local reports (no server needed)

```bash
npm i -g @aiusage/cli
aiusage report --range 7d
```

## Staying Up to Date

AIUsage uses a **fork-based update model** — fork this repo, connect your fork to Cloudflare Workers via Git integration, and updates flow automatically.

1. **Fork** this repository to your GitHub account
2. **Connect** your fork to Cloudflare Workers (Git integration)
3. **Sync** upstream updates via GitHub's "Sync fork" button or `git merge upstream/main`
4. Cloudflare **auto-redeploys** on every push to your fork

CLI updates are separate: `npm update -g @aiusage/cli`

See the [**Update Guide**](./docs/update-guide.md) for detailed instructions, including fully automatic sync via GitHub Actions.

## Docs

| Document | Description |
|----------|-------------|
| [**Deployment Guide**](./docs/deployment-guide.md) | Full setup walkthrough, CLI reference, API docs |
| [**Update Guide**](./docs/update-guide.md) | Fork-based update mechanism and auto-deploy setup |
| [**CLI README**](./packages/cli/README.md) | CLI tool details and all commands |


## License

[MIT](LICENSE)
