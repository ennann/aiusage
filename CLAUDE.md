# CLAUDE.md

## 项目概述

AIUsage — 跨设备 AI 工具用量统计平台。Monorepo 结构，pnpm workspace + Turborepo 管理。

| 包 | 职责 | 技术栈 |
|---|---|---|
| `@aiusage/cli` | 本地扫描 AI 工具用量并上报 | Node 18+, esbuild, ESM |
| `@aiusage/dashboard` | 数据可视化前端 | React 18, Vite, Tailwind CSS |
| `@aiusage/worker` | API 后端 + 静态资源宿主 | Cloudflare Workers, D1 (SQLite) |
| `@aiusage/shared` | 共享类型与常量 | TypeScript 5 |

依赖关系：`cli → shared`，`dashboard → shared`，`worker → dashboard + shared`。

## 目录约定

- `docs/` — 面向用户的文档（部署指南、更新指南等）

## 常用命令

```bash
pnpm install                          # 安装依赖
pnpm --filter @aiusage/cli build      # 构建 CLI
pnpm --filter @aiusage/cli test       # 测试 CLI（vitest）
pnpm --filter @aiusage/dashboard dev  # Dashboard 开发服务器
pnpm --filter @aiusage/dashboard build # 构建 Dashboard
pnpm --filter @aiusage/worker deploy  # 部署 Worker（含预编译）
```

## 代码规范

### Commit 格式

`<emoji> <type>(scope): <中文简短描述>`

可用类型与 emoji：`✨ feat` / `🐛 fix` / `📝 docs` / `♻️ refactor` / `🎨 style` / `⚡ perf` / `🌐 i18n` / `🔧 chore` / `🔧 ci` / `✅ test` / `⬆️ deps` / `🔖 release` / `🚧 wip`

- 中文描述，陈述式，每个 commit 只描述一个主要变更
- 避免"修复了""实现了"等冗余表述

### TypeScript

- 全包启用 `strict` 模式，ESM 格式
- Target: ES2022, moduleResolution: bundler
- 项目无 ESLint/Prettier 配置，保持现有代码风格即可

## 测试

- 框架：vitest 4.x
- 测试文件位置：`src/__tests__/` 或 `src/scanners/__tests__/`
- 时间戳使用 UTC 中午时段（如 `T12:00:00Z`）避免时区跨天问题
- CI 环境为 UTC，本地开发可能是其他时区，测试必须时区无关

## 数据库迁移

- 路径：`packages/worker/migrations/`
- 命名：`NNNN_description.sql`（4 位递增数字前缀）
- 执行：`npx wrangler d1 execute aiusage-db --remote --file=migrations/NNNN_xxx.sql`
- 新增迁移前检查现有编号，避免编号冲突
- `wrangler.jsonc` 不包含 `database_id`，执行远程迁移时需临时写入再删除

## Scanner 开发

CLI 扫描器位于 `packages/cli/src/scanners/`，每个 AI 工具一个文件。

新增 scanner 需同步更新：
1. `scanners/` 下新增扫描器文件及测试
2. `scan.ts` — 导入并注册
3. `project.ts` — 项目发现逻辑
4. `doctor.ts` — 诊断检查
5. `report.ts` — 本地报告（如需）

共享类型定义在 `packages/shared/src/types.ts`，新增字段需同步更新 worker 的 ingest 路由。

## 部署

### Dashboard + Worker

CI 自动部署（push to main）：Dashboard 构建 → 静态资源复制到 worker/public/ → wrangler deploy。

需要的 GitHub Secrets：`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`。

### CLI 发布

CI 自动发布（push to main 且版本号变更）：构建 → npm publish。

需要的 GitHub Secret：`NPM_TOKEN`。

发布前更新 `packages/cli/package.json` 中的版本号。
