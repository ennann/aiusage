<p align="center"><code>npm i -g @aiusage/cli</code></p>

<p align="center">
  <strong>AIUsage</strong> tracks token usage and costs across all your AI tools and devices,<br>
  syncs to your own Cloudflare Worker, and visualizes everything on a public dashboard.
</p>

<p align="center">
  <a href="./README.zh-CN.md">中文</a> | English
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@aiusage/cli"><img src="https://img.shields.io/npm/v/@aiusage/cli?label=npm&color=cb0000&logo=npm" alt="npm" /></a>
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

### Supported Tools

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-191919?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude Code" />
  <img src="https://img.shields.io/badge/Codex_CLI-412991?style=for-the-badge&logo=openai&logoColor=white" alt="Codex CLI" />
  <img src="https://img.shields.io/badge/Copilot_CLI-000?style=for-the-badge&logo=githubcopilot&logoColor=white" alt="Copilot CLI" />
  <img src="https://img.shields.io/badge/Gemini_CLI-8E75B2?style=for-the-badge&logo=googlegemini&logoColor=white" alt="Gemini CLI" />
  <img src="https://img.shields.io/badge/Amp-FF4F00?style=for-the-badge&logo=sourcegraph&logoColor=white" alt="Amp" />
</p>
<p align="center">
  <img src="https://img.shields.io/badge/Kimi_Code-4A6CF7?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjEwIi8+PC9zdmc+&logoColor=white" alt="Kimi Code" />
  <img src="https://img.shields.io/badge/Qwen_Code-5A29E4?style=for-the-badge&logo=alibabacloud&logoColor=white" alt="Qwen Code" />
  <img src="https://img.shields.io/badge/Droid-2C3E50?style=for-the-badge&logo=android&logoColor=white" alt="Droid" />
  <img src="https://img.shields.io/badge/OpenCode-16A34A?style=for-the-badge&logo=go&logoColor=white" alt="OpenCode" />
  <img src="https://img.shields.io/badge/OpenClaw-EF4444?style=for-the-badge&logo=codeium&logoColor=white" alt="OpenClaw" />
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
Clone https://github.com/ennann/aiusage.git, read skills/deploy-server.md,
and help me deploy AIUsage to my Cloudflare account.
After the server is up, follow skills/setup-controller.md to connect this device.
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

## Docs

| Document | Description |
|----------|-------------|
| [**Deployment Guide**](./docs/deployment-guide.md) | Full setup walkthrough, CLI reference, API docs |
| [**CLI README**](./packages/cli/README.md) | CLI tool details and all commands |


## License

[MIT](LICENSE)
