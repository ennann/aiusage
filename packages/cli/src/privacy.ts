import { createHash } from 'node:crypto';
import type { IngestBreakdown } from '@aiusage/shared';

export type ProjectVisibility = 'hidden' | 'masked' | 'plain';
export interface ProjectPrivacyFields {
  project: string;
  projectDisplay?: string;
  projectAlias?: string;
}

const DEFAULT_VISIBILITY: ProjectVisibility = 'masked';

/**
 * 把 IngestBreakdown[] 里的 project / projectDisplay / projectAlias 按隐私策略脱敏。
 * 原始绝对路径（含 /Users/<name>/... 或 C:\Users\<name>\...）永远不应离开本机。
 *
 * - hidden：project 与 projectDisplay 都替换为 `_redacted_`；alias 也清空
 * - masked：保留项目"basename + 8 字符短哈希"作为稳定不可逆标识；alias 清空
 * - plain：仅去掉绝对路径前缀，保留 basename（适合用户明确不在意暴露项目名时）
 */
export function applyPrivacy(
  breakdowns: IngestBreakdown[],
  visibility: ProjectVisibility | undefined,
): IngestBreakdown[] {
  return applyProjectPrivacy(breakdowns, visibility);
}

export function applyProjectPrivacy<T extends ProjectPrivacyFields>(
  items: T[],
  visibility: ProjectVisibility | undefined,
): T[] {
  const mode = visibility ?? DEFAULT_VISIBILITY;
  return items.map(item => transformOne(item, mode));
}

function transformOne<T extends ProjectPrivacyFields>(b: T, mode: ProjectVisibility): T {
  const original = b.project ?? '';
  const display = b.projectDisplay ?? deriveBasename(original);

  if (mode === 'hidden') {
    return { ...b, project: '_redacted_', projectDisplay: '_redacted_', projectAlias: undefined };
  }

  if (mode === 'masked') {
    const base = deriveBasename(original);
    const hash = shortHash(original);
    return {
      ...b,
      project: `${base}-${hash}`,
      projectDisplay: base,
      projectAlias: undefined,
    };
  }

  // plain：去掉绝对路径，仅保留 basename
  const base = deriveBasename(original);
  return {
    ...b,
    project: base,
    projectDisplay: display,
    projectAlias: b.projectAlias,
  };
}

function deriveBasename(p: string): string {
  if (!p) return 'unknown';
  // 跨平台 basename：手动按 / 与 \\ 都切一遍，避免依赖 path.basename 的 OS-specific 行为
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || 'unknown';
}

function shortHash(p: string): string {
  if (!p) return '00000000';
  return createHash('sha1').update(p).digest('hex').slice(0, 8);
}
