import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { basename, join } from 'node:path';

export interface AIUsageConfig {
  apiBaseUrl?: string;
  siteId?: string;
  deviceId?: string;
  deviceAlias?: string;
  deviceToken?: string;
  lookbackDays?: number;
  projectAliases?: Record<string, string>;
  lastSuccessfulUploadAt?: string;
  privacy?: {
    projectVisibility?: 'hidden' | 'masked' | 'plain';
  };
}

const CONFIG_DIR = join(homedir(), '.aiusage');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export async function readConfig(): Promise<AIUsageConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as AIUsageConfig;
  } catch {
    return {};
  }
}

export async function writeConfig(config: AIUsageConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export function normalizeServerUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function detectDeviceId(): string {
  return hostname()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'unknown-device';
}

export function getLocalTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function getProjectAlias(rawProject: string, aliases?: Record<string, string>): string {
  if (!aliases) return basename(rawProject) || rawProject || 'unknown';
  return aliases[rawProject] ?? aliases[basename(rawProject)] ?? basename(rawProject) ?? rawProject ?? 'unknown';
}

export function setConfigValue(
  config: AIUsageConfig,
  keyPath: string,
  values: string[],
): AIUsageConfig {
  const next = structuredClone(config);

  if (keyPath === 'server' || keyPath === 'apiBaseUrl') {
    next.apiBaseUrl = normalizeServerUrl(requireSingleValue(keyPath, values));
    return next;
  }

  if (keyPath === 'siteId') {
    next.siteId = requireSingleValue(keyPath, values);
    return next;
  }

  if (keyPath === 'device.id') {
    next.deviceId = requireSingleValue(keyPath, values);
    return next;
  }

  if (keyPath === 'device.alias') {
    next.deviceAlias = requireSingleValue(keyPath, values);
    return next;
  }

  if (keyPath === 'device.token') {
    next.deviceToken = requireSingleValue(keyPath, values);
    return next;
  }

  if (keyPath === 'lookbackDays') {
    next.lookbackDays = parsePositiveInt(requireSingleValue(keyPath, values), keyPath);
    return next;
  }

  if (keyPath === 'privacy.projectVisibility') {
    const value = requireSingleValue(keyPath, values);
    if (value !== 'hidden' && value !== 'masked' && value !== 'plain') {
      throw new Error('privacy.projectVisibility 仅支持 hidden、masked、plain');
    }
    next.privacy = { ...(next.privacy ?? {}), projectVisibility: value };
    return next;
  }

  if (keyPath === 'project.alias') {
    if (values.length < 2) {
      throw new Error('project.alias 需要两个参数：原始路径/名称 与 别名');
    }
    const [from, ...rest] = values;
    const alias = rest.join(' ').trim();
    if (!alias) throw new Error('project.alias 别名不能为空');
    next.projectAliases = { ...(next.projectAliases ?? {}), [from]: alias };
    return next;
  }

  throw new Error(`不支持的配置项: ${keyPath}`);
}

function requireSingleValue(keyPath: string, values: string[]): string {
  const value = values.join(' ').trim();
  if (!value) throw new Error(`${keyPath} 缺少值`);
  return value;
}

function parsePositiveInt(value: string, keyPath: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${keyPath} 必须是正整数`);
  }
  return parsed;
}
