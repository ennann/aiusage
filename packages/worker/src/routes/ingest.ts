import type { IngestPayload, CostStatus } from '@aiusage/shared';
import { jsonOk, jsonError } from '../utils/response.js';
import { verifyDeviceToken } from '../utils/token.js';
import { calculateCost, getWorstCostStatus } from '../utils/pricing.js';
import type { Env } from '../types.js';

export async function handleIngest(request: Request, env: Env): Promise<Response> {
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
      const cost = calculateCost(b.provider, b.product, b.model, {
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
      breakdownsWithCost.push({ breakdown: b, cost, cacheWrite5mTokens, cacheWrite1hTokens });
    }

    const dayCostStatus = getWorstCostStatus(costStatuses);

    // 先写入父记录，避免 breakdown 外键约束失败
    await env.DB.prepare(`
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
        'pending', 0,
        'pending', 0,
        now, now,
      )
      .run();

    for (const { breakdown: b, cost, cacheWrite5mTokens, cacheWrite1hTokens } of breakdownsWithCost) {
      const rawProject = b.project || 'unknown';
      const isFullPath = rawProject.startsWith('/') || /^[A-Z]:\\/i.test(rawProject);
      const projectDisplay = b.projectDisplay ?? (isFullPath ? rawProject.split('/').filter(Boolean).pop() || 'unknown' : rawProject);
      const projectAlias = b.projectAlias ?? null;

      await env.DB.prepare(`
        INSERT INTO daily_usage_breakdown
          (device_id, usage_date, provider, product, channel, model, project,
           project_display, project_alias,
           event_count, input_tokens, cached_input_tokens, cache_write_tokens,
           output_tokens, reasoning_output_tokens, estimated_cost_usd, cost_status,
           pricing_version, extra_metrics_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (device_id, usage_date, provider, product, channel, model, project)
        DO UPDATE SET
          project_display = excluded.project_display,
          project_alias = excluded.project_alias,
          event_count = excluded.event_count,
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
          b.provider, b.product, b.channel, b.model || 'unknown', rawProject,
          projectDisplay, projectAlias,
          b.eventCount, b.inputTokens, b.cachedInputTokens, b.cacheWriteTokens,
          b.outputTokens, b.reasoningOutputTokens,
          cost.estimatedCostUsd, cost.costStatus, cost.pricingVersion,
          JSON.stringify({
            cache_write_5m_tokens: cacheWrite5mTokens,
            cache_write_1h_tokens: cacheWrite1hTokens,
          }),
          now, now,
        )
        .run();
    }

    // 计算 top project / model 并回填 daily_usage
    const topProject = await env.DB.prepare(`
      SELECT COALESCE(project_alias, project_display) as project, SUM(estimated_cost_usd) as total_cost
      FROM daily_usage_breakdown
      WHERE device_id = ? AND usage_date = ?
      GROUP BY COALESCE(project_alias, project_display) ORDER BY total_cost DESC LIMIT 1
    `).bind(tokenPayload.deviceId, day.usageDate)
      .first<{ project: string; total_cost: number }>();

    const topModel = await env.DB.prepare(`
      SELECT model, SUM(estimated_cost_usd) as total_cost
      FROM daily_usage_breakdown
      WHERE device_id = ? AND usage_date = ?
      GROUP BY model ORDER BY total_cost DESC LIMIT 1
    `).bind(tokenPayload.deviceId, day.usageDate)
      .first<{ model: string; total_cost: number }>();

    await env.DB.prepare(`
      UPDATE daily_usage
      SET top_project_by_cost = ?, top_project_cost_usd = ?,
          top_model_by_cost = ?, top_model_cost_usd = ?,
          updated_at = ?
      WHERE device_id = ? AND usage_date = ?
    `)
      .bind(
        topProject?.project ?? 'unknown', topProject?.total_cost ?? 0,
        topModel?.model ?? 'unknown', topModel?.total_cost ?? 0,
        now,
        tokenPayload.deviceId, day.usageDate,
      )
      .run();

    costSummary[day.usageDate] = {
      estimatedCostUsd: Math.round(dayTotalCost * 10000) / 10000,
      costStatus: dayCostStatus,
    };
  }

  // 更新 last_seen_at + 别名（sync 时自动同步本地别名）
  await env.DB.prepare(
    'UPDATE devices SET last_seen_at = ?, app_version = ?, public_label = COALESCE(?, public_label) WHERE device_id = ?',
  )
    .bind(now, body.device.appVersion, body.device.deviceAlias ?? null, tokenPayload.deviceId)
    .run();

  return jsonOk({ daysProcessed: body.days.length, costSummary });
}
