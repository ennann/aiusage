import { describe, it, expect } from 'vitest';
import type { IngestBreakdown } from '@aiusage/shared';
import { applyPrivacy } from '../privacy.js';

function makeBreakdown(project: string, projectDisplay?: string): IngestBreakdown {
  return {
    provider: 'anthropic',
    product: 'claude-code',
    channel: 'cli',
    model: 'claude-opus-4-7',
    project,
    projectDisplay,
    projectAlias: 'my-alias',
    eventCount: 1,
    inputTokens: 100,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 50,
    reasoningOutputTokens: 0,
  };
}

const ABS = '/Users/Ethan/Projects/secret-thing';

describe('applyPrivacy', () => {
  it('默认（undefined）走 masked 模式', () => {
    const [r] = applyPrivacy([makeBreakdown(ABS)], undefined);
    expect(r.project).not.toContain('/Users/');
    expect(r.project).not.toContain('Ethan');
    expect(r.projectDisplay).toBe('secret-thing');
    expect(r.projectAlias).toBeUndefined();
  });

  it('hidden 模式完全擦除', () => {
    const [r] = applyPrivacy([makeBreakdown(ABS)], 'hidden');
    expect(r.project).toBe('_redacted_');
    expect(r.projectDisplay).toBe('_redacted_');
    expect(r.projectAlias).toBeUndefined();
  });

  it('masked 模式保留 basename + 短哈希', () => {
    const [r] = applyPrivacy([makeBreakdown(ABS)], 'masked');
    expect(r.project).toMatch(/^secret-thing-[0-9a-f]{8}$/);
    expect(r.projectDisplay).toBe('secret-thing');
    expect(r.projectAlias).toBeUndefined();
  });

  it('masked 哈希稳定可复算（同输入同输出）', () => {
    const [a] = applyPrivacy([makeBreakdown(ABS)], 'masked');
    const [b] = applyPrivacy([makeBreakdown(ABS)], 'masked');
    expect(a.project).toBe(b.project);
  });

  it('masked 不同路径哈希不同', () => {
    const [a] = applyPrivacy([makeBreakdown('/Users/Ethan/Projects/proj-a')], 'masked');
    const [b] = applyPrivacy([makeBreakdown('/Users/Ethan/Projects/proj-b')], 'masked');
    expect(a.project).not.toBe(b.project);
  });

  it('plain 模式只去绝对路径', () => {
    const [r] = applyPrivacy([makeBreakdown(ABS)], 'plain');
    expect(r.project).toBe('secret-thing');
    expect(r.projectAlias).toBe('my-alias');
  });

  it('Windows 路径同样处理', () => {
    const [r] = applyPrivacy([makeBreakdown('C:\\Users\\Ethan\\Projects\\winproj')], 'masked');
    expect(r.project).toMatch(/^winproj-[0-9a-f]{8}$/);
    expect(r.project).not.toContain('Ethan');
  });

  it('空 project 不会崩', () => {
    const [r] = applyPrivacy([makeBreakdown('')], 'masked');
    expect(r.project).toMatch(/^unknown-/);
  });

  it('已经是相对名的不再重复 basename', () => {
    const [r] = applyPrivacy([makeBreakdown('demo-project')], 'plain');
    expect(r.project).toBe('demo-project');
  });
});
