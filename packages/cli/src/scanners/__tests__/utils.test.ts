import { describe, it, expect } from 'vitest';
import { parseTs, dateKey, inferProviderFromModel, projectFromPath, resolveProjectFields } from '../utils.js';

describe('parseTs', () => {
  it('treats 10-digit numeric values as Unix seconds (not milliseconds)', () => {
    // Kimi wire.jsonl 用秒级时间戳，按毫秒解析会落到 1970-01-21。
    const ts = parseTs(1775196391.26428);
    expect(ts).not.toBeNull();
    expect(ts!.getUTCFullYear()).toBe(2026);
  });

  it('treats 13-digit numeric values as milliseconds', () => {
    const ms = Date.UTC(2026, 0, 15, 12, 0, 0);
    const ts = parseTs(ms);
    expect(ts).not.toBeNull();
    expect(ts!.getTime()).toBe(ms);
  });

  it('parses ISO strings', () => {
    const ts = parseTs('2026-06-01T08:40:27.667Z');
    expect(ts).not.toBeNull();
    expect(ts!.getUTCFullYear()).toBe(2026);
  });

  it('parses numeric strings as seconds when sub-1e12', () => {
    const ts = parseTs('1775196391');
    expect(ts).not.toBeNull();
    expect(ts!.getUTCFullYear()).toBe(2026);
  });

  it('rejects values before the validity floor (2015)', () => {
    expect(parseTs(0)).toBeNull(); // epoch
    expect(parseTs(1)).toBeNull(); // 1 秒，仍是 1970
    expect(parseTs('2010-01-01T00:00:00Z')).toBeNull();
  });

  it('rejects null/empty/invalid', () => {
    expect(parseTs(undefined)).toBeNull();
    expect(parseTs(null as unknown as undefined)).toBeNull();
    expect(parseTs('')).toBeNull();
    expect(parseTs('not-a-date')).toBeNull();
  });
});

describe('dateKey', () => {
  it('formats local date as YYYY-MM-DD', () => {
    const d = new Date(2026, 5, 2); // 本地 6/2
    expect(dateKey(d)).toBe('2026-06-02');
  });
});

describe('inferProviderFromModel', () => {
  it('识别常见跨工具模型供应商，并保留未知模型的 fallback', () => {
    expect(inferProviderFromModel('claude-sonnet-4-6', 'pi')).toBe('anthropic');
    expect(inferProviderFromModel('gpt-5.6', 'pi')).toBe('openai');
    expect(inferProviderFromModel('gemini-3.1-pro-preview', 'pi')).toBe('google');
    expect(inferProviderFromModel('custom-model', 'pi')).toBe('pi');
  });
});

describe('project path parsing', () => {
  it('兼容 Windows 与 POSIX 路径分隔符', () => {
    expect(projectFromPath('C:\\Users\\test\\project')).toBe('project');
    expect(resolveProjectFields('/Users/test/project').projectDisplay).toBe('project');
  });
});
