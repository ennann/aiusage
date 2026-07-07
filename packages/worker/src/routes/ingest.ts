import type { IngestActivityItem, IngestPayload, CostStatus } from '@aiusage/shared';
import { jsonOk, jsonError } from '../utils/response.js';
import { verifyDeviceToken } from '../utils/token.js';
import { calculateCost, getWorstCostStatus } from '../utils/pricing.js';
import type { Env } from '../types.js';

export async function handleIngest(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  // 校验 DEVICE_TOKEN
  const auth = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!auth) return jsonError(401, 'INVALID_TOKEN', 'Missing authorization');

  const tokenPayload = await verifyDeviceToken(auth, env.DEVICE_TOKEN_SECRET);
  if (!tokenPayload) return jsonError(401, 'INVALID_TOKEN', 'Invalid device token');

  const body = await request.json<IngestPayload>();

  // 校验一致性
  if (body.siteId !== tokenPayload.siteId) {
    return jsonError(403, 'SITE_ID_MISMATCH', 'Site ID mismatch');
  }
  if (body.device.deviceId !== tokenPayload.deviceId) {
    return jsonError(403, 'DEVICE_ID_MISMATCH', 'Device ID mismatch');
  }

  // 校验设备状态与 token_version
  const device = await env.DB.prepare('SELECT status, token_version FROM devices WHERE device_id = ?')
    .bind(tokenPayload.deviceId)
    .first<{ status: string; token_version: number }>();

  if (!device) return jsonError(401, 'INVALID_TOKEN', 'Device not found');
  if (device.status !== 'active') return jsonError(403, 'DEVICE_DISABLED', 'Device has been disabled');
  if (device.token_version !== tokenPayload.tokenVersion) {
    return jsonError(401, 'TOKEN_VERSION_MISMATCH', 'Token version mismatch');
  }

  const now = new Date().toISOString();
  const costSummary: Record<string, { estimatedCostUsd: number; costStatus: CostStatus }> = {};

  for (const day of body.days) {
    const costStatuses: CostStatus[] = [];
    const breakdownsWithCost = [];
    const projectCosts = new Map<string, number>();
    const modelCosts = new Map<string, number>();
    let dayTotalCost = 0;
    let dayTotalEvents = 0;
    let dayTotalInput = 0;
    let dayTotalCachedInput = 0;
    let dayTotalCacheWrite = 0;
    let dayTotalOutput = 0;
    let dayTotalReasoning = 0;

    // 按 breakdown 写入
    for (const b of day.breakdowns) {
      const cacheWrite5mTokens = b.cacheWrite5mTokens ?? b.cacheWriteTokens;
      const cacheWrite1hTokens = b.cacheWrite1hTokens ?? 0;
      // 优先使用 CLI 预算的费用（如 Kiro 积分计费、Codex JSONL 自带 costUSD），
      // 这类来源本地无 token 数据，服务端按 token 计费会得到 0。
      const cost =
        typeof b.costUSD === 'number' && b.costUSD > 0
          ? {
              estimatedCostUsd: Math.round(b.costUSD * 10000) / 10000,
              costStatus: 'estimated' as CostStatus,
              pricingVersion: 'client-supplied',
            }
          : calculateCost(b.provider, b.product, b.model, {
              inputTokens: b.inputTokens,
              cachedInputTokens: b.cachedInputTokens,
              cacheWriteTokens: b.cacheWriteTokens,
              cacheWrite5mTokens,
              cacheWrite1hTokens,
              outputTokens: b.outputTokens,
            });

      costStatuses.push(cost.costStatus);
      dayTotalCost += cost.estimatedCostUsd;
      dayTotalEvents += b.eventCount;
      dayTotalInput += b.inputTokens;
      dayTotalCachedInput += b.cachedInputTokens;
      dayTotalCacheWrite += b.cacheWriteTokens;
      dayTotalOutput += b.outputTokens;
      dayTotalReasoning += b.reasoningOutputTokens;

      const rawProject = b.project || 'unknown';
      const isFullPath = rawProject.startsWith('/') || /^[A-Z]:\\/i.test(rawProject);
      const projectDisplay = b.projectDisplay ?? (isFullPath ? rawProject.split('/').filter(Boolean).pop() || 'unknown' : rawProject);
      const projectAlias = b.projectAlias ?? null;
      const model = b.model || 'unknown';
      const projectKey = projectAlias ?? projectDisplay;

      projectCosts.set(projectKey, (projectCosts.get(projectKey) ?? 0) + cost.estimatedCostUsd);
      modelCosts.set(model, (modelCosts.get(model) ?? 0) + cost.estimatedCostUsd);
      breakdownsWithCost.push({
        breakdown: b,
        cost,
        cacheWrite5mTokens,
        cacheWrite1hTokens,
        rawProject,
        projectDisplay,
        projectAlias,
        model,
      });
    }

    const dayCostStatus = getWorstCostStatus(costStatuses);
    const topProject = topCostEntry(projectCosts);
    const topModel = topCostEntry(modelCosts);

    const statements = [
      // 先写入父记录，避免 breakdown 外键约束失败
      env.DB.prepare(`
      INSERT INTO daily_usage
        (device_id, usage_date, event_count, input_tokens, cached_input_tokens,
         cache_write_tokens, output_tokens, reasoning_output_tokens,
         estimated_cost_usd, cost_status, pricing_version,
         top_project_by_cost, top_project_cost_usd, top_model_by_cost, top_model_cost_usd,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (device_id, usage_date)
      DO UPDATE SET
        event_count = excluded.event_count,
        input_tokens = excluded.input_tokens,
        cached_input_tokens = excluded.cached_input_tokens,
        cache_write_tokens = excluded.cache_write_tokens,
        output_tokens = excluded.output_tokens,
        reasoning_output_tokens = excluded.reasoning_output_tokens,
        estimated_cost_usd = excluded.estimated_cost_usd,
        cost_status = excluded.cost_status,
        pricing_version = excluded.pricing_version,
        top_project_by_cost = excluded.top_project_by_cost,
        top_project_cost_usd = excluded.top_project_cost_usd,
        top_model_by_cost = excluded.top_model_by_cost,
        top_model_cost_usd = excluded.top_model_cost_usd,
        updated_at = excluded.updated_at
    `)
        .bind(
        tokenPayload.deviceId, day.usageDate,
        dayTotalEvents, dayTotalInput, dayTotalCachedInput, dayTotalCacheWrite,
        dayTotalOutput, dayTotalReasoning,
        Math.round(dayTotalCost * 10000) / 10000, dayCostStatus, 'current',
        topProject.key, topProject.cost,
        topModel.key, topModel.cost,
        now, now,
        ),

      env.DB.prepare(`
      DELETE FROM daily_usage_breakdown
      WHERE device_id = ? AND usage_date = ?
    `)
        .bind(tokenPayload.deviceId, day.usageDate),
    ];

    for (const { breakdown: b, cost, cacheWrite5mTokens, cacheWrite1hTokens, rawProject, projectDisplay, projectAlias, model } of breakdownsWithCost) {
      statements.push(env.DB.prepare(`
        INSERT INTO daily_usage_breakdown
          (device_id, usage_date, provider, product, channel, model, project,
           project_display, project_alias,
           event_count, session_count, input_tokens, cached_input_tokens, cache_write_tokens,
           output_tokens, reasoning_output_tokens, estimated_cost_usd, cost_status,
           pricing_version, extra_metrics_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (device_id, usage_date, provider, product, channel, model, project)
        DO UPDATE SET
          project_display = excluded.project_display,
          project_alias = excluded.project_alias,
          event_count = excluded.event_count,
          session_count = excluded.session_count,
          input_tokens = excluded.input_tokens,
          cached_input_tokens = excluded.cached_input_tokens,
          cache_write_tokens = excluded.cache_write_tokens,
          output_tokens = excluded.output_tokens,
          reasoning_output_tokens = excluded.reasoning_output_tokens,
          estimated_cost_usd = excluded.estimated_cost_usd,
          cost_status = excluded.cost_status,
          pricing_version = excluded.pricing_version,
          extra_metrics_json = excluded.extra_metrics_json,
          updated_at = excluded.updated_at
      `)
        .bind(
          tokenPayload.deviceId, day.usageDate,
          b.provider, b.product, b.channel, model, rawProject,
          projectDisplay, projectAlias,
          b.eventCount, b.sessionCount ?? 0, b.inputTokens, b.cachedInputTokens, b.cacheWriteTokens,
          b.outputTokens, b.reasoningOutputTokens,
          cost.estimatedCostUsd, cost.costStatus, cost.pricingVersion,
          JSON.stringify({
            cache_write_5m_tokens: cacheWrite5mTokens,
            cache_write_1h_tokens: cacheWrite1hTokens,
          }),
          now, now,
        ));
    }

    await env.DB.batch(statements);
    await replaceActivityMetrics(env, tokenPayload.deviceId, day.usageDate, day.activity?.items ?? [], now);

    costSummary[day.usageDate] = {
      estimatedCostUsd: Math.round(dayTotalCost * 10000) / 10000,
      costStatus: dayCostStatus,
    };
  }

  // 更新 last_seen_at + 别名（sync 时自动同步本地别名）。这不是用量写入的关键路径，
  // 所以作为后台 best-effort 任务，避免 D1 暂时抖动让已写成功的上传返回 500。
  const deviceTouch = env.DB.prepare(
    'UPDATE devices SET last_seen_at = ?, app_version = ?, public_label = COALESCE(?, public_label) WHERE device_id = ?',
  )
    .bind(now, body.device.appVersion, body.device.deviceAlias ?? null, tokenPayload.deviceId)
    .run()
    .catch(err => {
      console.warn('Failed to update device last_seen_at after ingest', err);
    });

  if (ctx) {
    ctx.waitUntil(deviceTouch);
  } else {
    await deviceTouch;
  }

  return jsonOk({ daysProcessed: body.days.length, costSummary });
}

function topCostEntry(costs: Map<string, number>): { key: string; cost: number } {
  let topKey = 'unknown';
  let topCost = 0;

  for (const [key, cost] of costs.entries()) {
    if (cost > topCost) {
      topKey = key;
      topCost = cost;
    }
  }

  return { key: topKey, cost: Math.round(topCost * 10000) / 10000 };
}

async function replaceActivityMetrics(
  env: Env,
  deviceId: string,
  usageDate: string,
  items: IngestActivityItem[],
  now: string,
): Promise<void> {
  try {
    await env.DB.prepare('DELETE FROM daily_activity_breakdown WHERE device_id = ? AND usage_date = ?')
      .bind(deviceId, usageDate)
      .run();

    for (const item of items) {
      const count = Math.max(0, Math.floor(Number(item.count ?? 0)));
      if (count === 0) continue;
      const rawProject = item.project || 'unknown';
      const isFullPath = rawProject.startsWith('/') || /^[A-Z]:\\/i.test(rawProject);
      const projectDisplay = item.projectDisplay ?? (isFullPath ? rawProject.split('/').filter(Boolean).pop() || 'unknown' : rawProject);

      await env.DB.prepare(`
        INSERT INTO daily_activity_breakdown
          (device_id, usage_date, provider, product, source, project,
           project_display, project_alias, kind, name, confidence, event_count,
           created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .bind(
          deviceId,
          usageDate,
          item.provider || 'unknown',
          item.product || 'unknown',
          item.source || `${item.provider || 'unknown'}/${item.product || 'unknown'}`,
          rawProject,
          projectDisplay,
          item.projectAlias ?? null,
          item.kind || 'unknown',
          item.name || 'unknown',
          item.confidence === 'proxy' ? 'proxy' : 'exact',
          count,
          now,
          now,
        )
        .run();
    }
  } catch (error) {
    if (String(error).includes('daily_activity_breakdown')) return;
    throw error;
  }
}
