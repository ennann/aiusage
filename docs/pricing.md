# 定价目录（pricing catalog）

AIUsage 把所有模型定价数据集中维护在 **`@aiusage/shared/pricing`**，CLI 端与 Worker 端共用同一份；两端不再有独立副本。

```
packages/shared/src/pricing/
├── types.ts          # ModelPricing / PricingTier / PricingCatalog 等类型
├── catalog.ts        # 总目录：version + fx + aliases + providers
├── calculate.ts      # calculateCost / getWorstCostStatus
├── index.ts          # 对外导出
└── data/
    ├── anthropic.ts
    ├── openai.ts
    ├── google.ts
    ├── moonshot.ts      (Kimi K2.x / Moonshot V1)
    ├── alibaba.ts       (Qwen / 通义千问)
    ├── deepseek.ts
    ├── zhipu.ts         (GLM)
    ├── github.ts        (Copilot — 影子价)
    ├── sourcegraph.ts   (Amp — 影子价)
    └── placeholders.ts  (inflection / cursor / droid / opencode — 空表)
```

## 范围约定

按维护成本与影响面分三档：

| 档位 | 范围 | 维护责任 |
|---|---|---|
| **核心** | scanner 实际采集的 provider/product + 该 provider 最近 12 个月主力模型 | 必须保证准确，由 maintainer 定期核对 |
| **扩展** | 主流 provider 全部历史模型 + 主流中文模型（Kimi / Qwen / DeepSeek / GLM） | 社区 PR best-effort，发现错误即修 |
| **不收** | EOL > 1 年的模型；同一模型多 region 价差；私有部署 / 套餐价 | 显式拒绝 |

## 数据字段

`ModelPricing` 关键字段（详见 `types.ts`）：

| 字段 | 说明 |
|---|---|
| `currency: 'USD' \| 'CNY'` | 价格币种。Worker 端结算时按 `catalog.fx` 折算到 USD |
| `input_per_million` / `output_per_million` | 基础单价 / 1M tokens |
| `cached_input_per_million` | cache hit 价（Anthropic 叫 cache_read，Kimi 叫缓存命中） |
| `cache_write_5m_per_million` / `cache_write_1h_per_million` | Anthropic 风格 prompt caching write |
| `tiers?: PricingTier[]` | 阶梯定价：按 input token 数命中不同档位（Qwen / Gemini 2.5 Pro / GLM 等） |
| `effective_from` / `effective_to` | 价格生效区间（审计用） |
| `notes` | 备注（如 `deprecated`、`75% off promo until ...`） |

## 别名 (aliases)

`catalog.aliases` 是**显式声明**的等价名映射，命中后视为 `exact`：

```ts
'claude-opus-4-7-20260201': 'claude-opus-4-7'  // 带日期后缀的版本号
'codex-auto-review': 'gpt-5.4'                  // 工具内部模型 → 实际推理模型
```

`alias` 与 **前缀回退** 是两种不同机制：

- alias 命中 → `costStatus: 'exact'`（你显式说"这两个名字等价"）
- 前缀回退（找不到精确匹配，按最长前缀降级到同 family 旧版本）→ `costStatus: 'estimated'`

## 折算汇率

`catalog.fx` 集中维护，避免散落到各文件：

```ts
fx: { CNY: 7.2 }  // 1 USD = N CNY
```

Worker 启动时可通过 env 覆盖（暂未实现，规划中）。

## 阶梯定价

`tiers` 数组按 input token 升序排列，命中条件是 `totalInputTokens <= threshold`；最后一档不写 threshold 表示 +∞：

```ts
tiers: [
  { threshold: 32_000,  input_per_million: 4,  output_per_million: 16 },
  { threshold: 128_000, input_per_million: 6,  output_per_million: 24 },
  { threshold: 256_000, input_per_million: 10, output_per_million: 40 },
  {                     input_per_million: 20, output_per_million: 200 },
]
```

> **限制**：Gemini 2.5 Flash 等模型还按 **output** 长度分档；GLM-4.7 同样有 input × output 双维度。当前实现只按 input 命中，output 分档暂用保守取低档（标了 `notes`）。

## 贡献新模型 / 修订单价

1. 找到对应 `packages/shared/src/pricing/data/<provider>.ts`，新增或更新条目
2. 价格务必从**官方文档**取，注释里注明 `最近核对：YYYY-MM-DD` 与来源 URL
3. 已下架模型不要删除，仅在 `notes` 加 `deprecated` 标注（保证历史数据可重算）
4. 在 `catalog.ts` 的 `PRICING_VERSION` 加日期版本号（如 `2026-06-01-v2`），便于审计追溯
5. 跑 `pnpm --filter @aiusage/shared test` —— CI 测试会校验关键模型可解析
6. 若新增 provider，记得在 `catalog.ts` 的 `providers` 与 `pricing.test.ts` 的 `required` 数组里同步登记

## 已知影子价（非真实结算价）

- **GitHub Copilot**（`github/copilot-cli`、`copilot-vscode`）按 "premium request" 套餐计费，不公开 per-token 单价。代码里的单价是按底层模型（OpenAI / Anthropic）官方价复制的"影子价"，仅作 token 用量估算
- **Sourcegraph Amp**（`sourcegraph/amp`）按打包月费 / 请求计费，同理

未来若有需要，可在 `ModelPricing` 加 `is_shadow_price: true`，让 calculateCost 自动把 `costStatus` 标为 `estimated`。

## 测试

- `pnpm --filter @aiusage/shared test` — 校验关键模型可解析、阶梯命中、币种折算
- `pnpm --filter @aiusage/worker test` — Worker 端 calculateCost 行为回归
- `pnpm --filter @aiusage/cli test` — CLI report 集成测试
