# CLI 统计准确性改进 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 参考 ccusage 项目的优秀实现，修复 CLI 扫描和费用计算中的四个关键问题：数据路径缺失、Fast 模式未处理、costUSD 字段未使用、阶梯定价未实现。

**Architecture:** 改动集中在两个层面：(1) CLI 扫描层 — claude.ts 和 report.ts 中的数据路径发现和 JSONL 字段解析；(2) 费用计算层 — report.ts 中的 calculateBreakdownCost 和 worker pricing.ts。不改变数据库 schema 或 API 接口。

**Tech Stack:** TypeScript, Node.js fs/path API

---

### Task 1: Claude 数据目录多路径支持

**Why:** Claude Code 已将日志目录从 `~/.claude` 迁移到 `~/.config/claude`，当前仅读旧路径，可能漏掉全部数据。ccusage 支持双路径 + `CLAUDE_CONFIG_DIR` 环境变量。

**Files:**
- Modify: `packages/cli/src/scanners/claude.ts:39-78` — `scanClaudeDates()` 函数
- Modify: `packages/cli/src/report.ts:266-301` — `discoverClaudeDates()` 函数

**Step 1: 修改 claude.ts — scanClaudeDates 支持多路径**

当前代码 (Line 57):
```typescript
const baseDir = claudeDir ?? join(homedir(), '.claude', 'projects');
```

改为扫描多个目录：
```typescript
function getClaudeProjectDirs(claudeDir?: string): string[] {
  if (claudeDir) return [claudeDir];

  const envVar = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (envVar) {
    return envVar.split(',').map(p => p.trim()).filter(Boolean).map(p => join(p, 'projects'));
  }

  const home = homedir();
  return [
    join(home, '.config', 'claude', 'projects'),  // 新路径优先
    join(home, '.claude', 'projects'),              // 旧路径兜底
  ];
}
```

在 `scanClaudeDates()` 中，将单个 baseDir 的扫描循环改为遍历所有 baseDirs，用已有的 deduped Map 天然去重。

**Step 2: 修改 report.ts — discoverClaudeDates 支持多路径**

当前代码 (Line 267):
```typescript
const baseDir = join(homedir(), '.claude', 'projects');
```

改为同样扫描两个路径：
```typescript
const home = homedir();
const baseDirs = [
  join(home, '.config', 'claude', 'projects'),
  join(home, '.claude', 'projects'),
];
```

遍历 baseDirs，合并发现的日期。

**Step 3: 验证**

运行 `npx tsx packages/cli/src/cli.ts scan --date $(date +%Y-%m-%d) --json` 确认扫描正常。

**Step 4: Commit**

```
✨ feat(cli): 支持 ~/.config/claude 新数据目录和 CLAUDE_CONFIG_DIR 环境变量
```

---

### Task 2: Claude Scanner 解析 costUSD 字段

**Why:** JSONL 中的 costUSD 是 Claude Code 预算的官方费用。ccusage 默认优先使用此值。我们应采集此字段，在后续费用计算中作为可选参考。

**Files:**
- Modify: `packages/cli/src/scanners/claude.ts:7-27,29-37` — ClaudeRecord 和 DeduplicatedUsage 接口
- Modify: `packages/cli/src/scanners/claude.ts:88-141` — 解析逻辑
- Modify: `packages/cli/src/scanners/claude.ts:145-178` — 聚合逻辑
- Modify: `packages/shared/src/types.ts` — IngestBreakdown 增加 costUSD 字段

**Step 1: 扩展 ClaudeRecord 接口**

在 `ClaudeRecord` 中添加:
```typescript
costUSD?: number;
```

在 `DeduplicatedUsage` 中添加:
```typescript
costUSD: number;  // 累加
```

**Step 2: 扩展 IngestBreakdown**

在 `packages/shared/src/types.ts` 的 `IngestBreakdown` 中添加:
```typescript
costUSD?: number;  // Claude Code 预算的原始费用
```

**Step 3: 在解析循环中提取 costUSD**

在 Line 108 之后:
```typescript
const costUSD = record.costUSD ?? 0;
```

在 dedup 逻辑中累加（不是 max，因为每个 request 的 costUSD 是独立的；但同一 requestId 流式场景仍取 max）:
```typescript
existing.costUSD = Math.max(existing.costUSD, costUSD);
```

**Step 4: 聚合时传递 costUSD**

在 grouped 聚合时累加 costUSD。

**Step 5: Commit**

```
✨ feat(cli): Claude scanner 采集 JSONL 中的 costUSD 字段
```

---

### Task 3: Claude Scanner 解析 speed 字段并分离 Fast 模式

**Why:** Fast 模式 token 费用是标准模式的 ~6x。ccusage 将 fast 模式记录标记为 `{model}-fast` 单独聚合。我们也应分离。

**Files:**
- Modify: `packages/cli/src/scanners/claude.ts:7-27` — ClaudeRecord.message.usage 添加 speed 字段
- Modify: `packages/cli/src/scanners/claude.ts:108-110` — model 名称附加 -fast 后缀

**Step 1: 扩展 usage 接口**

在 ClaudeRecord.message.usage 中添加:
```typescript
speed?: 'standard' | 'fast';
```

**Step 2: model 名拼接 fast 后缀**

Line 109 改为:
```typescript
let model = normalizeModelName(message.model ?? 'unknown');
if (usage.speed === 'fast') model = `${model}-fast`;
```

这样后续按 model 聚合时，fast 模式自然成为独立条目。

**Step 3: Commit**

```
✨ feat(cli): 分离 Claude Code Fast 模式为独立统计条目
```

---

### Task 4: 费用计算 — 支持 Fast 模式定价

**Why:** Fast 模式 model 名为 `claude-sonnet-4-6-fast` 格式，需要在定价表中匹配并乘以倍率。

**Files:**
- Modify: `packages/cli/src/report.ts:541-558` — calculateBreakdownCost 中 Claude 分支
- Modify: `packages/worker/src/utils/pricing.ts:602-626,634-678` — resolveModelPricing 和 calculateCost

**Step 1: report.ts 中处理 fast model**

在 `calculateBreakdownCost()` Claude 分支中，检测 `-fast` 后缀:
```typescript
const isFast = breakdown.model.endsWith('-fast');
const baseModel = isFast ? breakdown.model.replace(/-fast$/, '') : breakdown.model;
const resolved = resolveModel(baseModel, CLAUDE_PRICING);
// ... 正常计算后:
const baseCost = ...;
return isFast ? baseCost * 6 : baseCost;
```

**Step 2: worker pricing.ts 中同样处理**

在 `calculateCost()` 中，检测 fast 后缀:
```typescript
const isFast = model.endsWith('-fast');
const baseModel = isFast ? model.replace(/-fast$/, '') : model;
// ... resolve baseModel ...
const cost = ... ;
return { ..., estimatedCostUsd: Math.round((isFast ? cost * 6 : cost) * 10000) / 10000 };
```

定义 `FAST_MULTIPLIER = 6` 常量。

**Step 3: Commit**

```
✨ feat(cli): Fast 模式按 6 倍费率计算
```

---

### Task 5: 费用计算 — costUSD 优先模式

**Why:** 参考 ccusage 的 `auto` 模式：有 costUSD 时直接使用，无 costUSD 时再按 token 计算。可避免我们的定价表过时导致的偏差。

**Files:**
- Modify: `packages/cli/src/report.ts:522-539` — toBreakdownTotals
- Modify: `packages/cli/src/report.ts:541-598` — calculateBreakdownCost

**Step 1: 修改 calculateBreakdownCost**

在函数开头添加 costUSD 优先逻辑:
```typescript
function calculateBreakdownCost(breakdown: IngestBreakdown, warnings: Set<string>): number {
  // 优先使用 Claude Code 预算的费用
  if (breakdown.costUSD != null && breakdown.costUSD > 0) {
    return breakdown.costUSD;
  }
  // 原有逻辑...
}
```

**Step 2: Commit**

```
✨ feat(cli): 费用计算优先使用 JSONL 中的 costUSD 字段
```

---

### Task 6: 阶梯定价 — 支持 200k token 阈值

**Why:** Claude 1M 上下文窗口模型在 200k token 以上按更高价计费。长对话场景下我们会低估费用。

注意：此功能影响 worker 端定价，但 CLI 本地 report 中的 CLAUDE_PRICING 表没有阶梯信息。考虑到实现复杂度和实际影响（大部分单次请求不超过 200k），此任务暂标记为 **低优先级/后续迭代**。当前 CLI report 中不实现阶梯定价，worker 端也暂不改动。在 report.ts 的定价警告中加一条提示即可。

**Files:**
- Modify: `packages/cli/src/report.ts:541-558`

**Step 1: 添加阶梯定价提示**

在 Claude 分支计算完成后，如果 inputTokens 超过 200k，添加警告:
```typescript
const totalInput = breakdown.inputTokens + breakdown.cachedInputTokens + (breakdown.cacheWrite5mTokens ?? breakdown.cacheWriteTokens ?? 0);
if (totalInput > 200_000) {
  warnings.add(`${breakdown.model} 单次聚合 token 数超过 200k，实际费用可能因阶梯定价而偏高。`);
}
```

**Step 2: Commit**

```
📝 docs(cli): 添加 200k 阶梯定价提示警告
```

---

## 执行顺序

1. Task 1 (数据路径) — 影响最大，最优先
2. Task 3 (speed 字段) — 为 Task 4 做准备
3. Task 4 (fast 定价) — 依赖 Task 3
4. Task 2 (costUSD 采集) — 为 Task 5 做准备
5. Task 5 (costUSD 优先) — 依赖 Task 2
6. Task 6 (阶梯定价提示) — 低优先级
