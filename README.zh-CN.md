<p align="center"><code>npm i -g @aiusage/cli</code></p>

<p align="center">
  <strong>AIUsage</strong> 追踪所有 AI 工具在所有设备上的 Token 用量与成本，<br>
  同步到你自己的 Cloudflare Worker，通过公开看板可视化一切。
</p>

<p align="center">
  中文 | <a href="./README.md">English</a>
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

## AIUsage 是什么？

一套自托管、隐私优先的系统，用于追踪你在 AI 编程工具上的真实开销——跨所有设备。

### 支持的工具

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-D97757?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude Code" />
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

### 为什么选择 AIUsage？

- **本地扫描** — 读取 AI 工具的会话日志，提取 Token 用量，不触及对话内容
- **多设备同步** — 每台机器独立注册，各自持有安全令牌，数据汇聚到你的 Worker
- **成本可视化** — 公开看板展示趋势、模型分布、单次成本等
- **数据自主** — 部署到你自己的 Cloudflare 账户（免费套餐足够），不依赖任何第三方

### 架构

```mermaid
graph LR
  D1["<b>设备 01</b><br/>MacBook Pro"] -- sync --> W["<b>Cloudflare Worker</b><br/>+ D1 数据库"]
  D2["<b>设备 02</b><br/>Mac Mini"] -- sync --> W
  D3["<b>设备 03</b><br/>Linux 服务器"] -- sync --> W
  W -- 公开 API --> Dashboard["<b>看板</b><br/>只读 Web UI"]
```

## 快速开始

### 让 AI 代理帮你部署

复制以下提示词，粘贴给你的 AI 编程代理（Claude Code、Codex、Copilot、Gemini 等）：

```text
克隆 https://github.com/ennann/aiusage.git，阅读 skills/aiusage-server/aiusage-server.md，
帮我把 AIUsage 部署到我的 Cloudflare 账户。
部署完成后，按照 skills/aiusage-cli/aiusage-cli.md 把这台设备接入。
```

### 或手动部署

```bash
git clone https://github.com/ennann/aiusage.git
cd aiusage && pnpm install
npx wrangler login
pnpm setup
```

### 本地报告（无需服务端）

```bash
npm i -g @aiusage/cli
aiusage report --range 7d
```

## 保持更新

AIUsage 采用 **Fork 更新模式** — Fork 本仓库，将你的 Fork 连接到 Cloudflare Workers 的 Git 集成，后续更新自动部署。

1. **Fork** 本仓库到你的 GitHub 账户
2. **连接** 你的 Fork 到 Cloudflare Workers（Git 集成）
3. 通过 GitHub 的 "Sync fork" 按钮或 `git merge upstream/main` **同步**上游更新
4. Cloudflare 在每次推送到你的 Fork 时**自动重新部署**

CLI 更新需单独执行：`npm update -g @aiusage/cli`

详见 [**更新指南**](./docs/update-guide.md)，包含通过 GitHub Actions 实现全自动同步的方案。

## 文档

| 文档 | 说明 |
|------|------|
| [**部署指南**](./docs/deployment-guide.md) | 完整部署流程、CLI 参考、API 文档 |
| [**更新指南**](./docs/update-guide.md) | Fork 更新机制与自动部署设置 |
| [**CLI README**](./packages/cli/README.md) | CLI 工具详情与全部命令 |


## 许可证

[MIT](LICENSE)
