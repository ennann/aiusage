import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverProjects } from '../project.js';

/** 向指定目录写入 JSONL 文件 */
async function writeJsonl(dir: string, filename: string, lines: object[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  const content = lines.map((l) => JSON.stringify(l)).join('\n');
  await writeFile(join(dir, filename), content);
}

let tmpDir: string;
let origEnv: string | undefined;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `aiusage-project-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  origEnv = process.env.CLAUDE_CONFIG_DIR;
});

afterEach(async () => {
  // 恢复环境变量
  if (origEnv === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR;
  } else {
    process.env.CLAUDE_CONFIG_DIR = origEnv;
  }
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── Claude 项目发现 ───

describe('Claude 项目发现', () => {
  it('从 jsonl 的 cwd 字段提取项目名', async () => {
    // 设置 CLAUDE_CONFIG_DIR 指向临时目录，discoverClaudeProjects 会读 {dir}/projects/
    process.env.CLAUDE_CONFIG_DIR = tmpDir;
    const projectDir = join(tmpDir, 'projects', 'Users-test-MyProject');
    // jsonl 含 cwd 字段
    await writeJsonl(projectDir, 'session.jsonl', [
      { cwd: '/Users/test/MyProject', type: 'summary', model: 'claude-sonnet' },
    ]);

    const results = await discoverProjects();
    const found = results.find((p) => p.name === 'MyProject');
    expect(found).toBeDefined();
    expect(found!.sources).toContain('claude');
  });

  it('发现多个不同项目', async () => {
    process.env.CLAUDE_CONFIG_DIR = tmpDir;

    const projA = join(tmpDir, 'projects', 'Users-test-ProjectA');
    const projB = join(tmpDir, 'projects', 'Users-test-ProjectB');

    await writeJsonl(projA, 'session.jsonl', [
      { cwd: '/Users/test/ProjectA' },
    ]);
    await writeJsonl(projB, 'session.jsonl', [
      { cwd: '/home/dev/ProjectB' },
    ]);

    const results = await discoverProjects();
    const names = results.map((p) => p.name);
    expect(names).toContain('ProjectA');
    expect(names).toContain('ProjectB');
  });
});

// ─── 别名 ───

describe('别名应用', () => {
  it('projectAliases 正确映射到 alias 字段', async () => {
    process.env.CLAUDE_CONFIG_DIR = tmpDir;
    const projectDir = join(tmpDir, 'projects', 'encoded-path');
    await writeJsonl(projectDir, 'session.jsonl', [
      { cwd: '/Users/test/my-long-project-name' },
    ]);

    const aliases: Record<string, string> = {
      'my-long-project-name': '简称',
    };

    const results = await discoverProjects(aliases);
    const found = results.find((p) => p.name === 'my-long-project-name');
    expect(found).toBeDefined();
    expect(found!.alias).toBe('简称');
  });

  it('无别名时 alias 为 undefined', async () => {
    process.env.CLAUDE_CONFIG_DIR = tmpDir;
    const projectDir = join(tmpDir, 'projects', 'some-dir');
    await writeJsonl(projectDir, 'session.jsonl', [
      { cwd: '/Users/test/NoAlias' },
    ]);

    const results = await discoverProjects();
    const found = results.find((p) => p.name === 'NoAlias');
    expect(found).toBeDefined();
    expect(found!.alias).toBeUndefined();
  });
});

// ─── 空目录 ───

describe('空目录处理', () => {
  it('空 projects 目录返回结果中不含 Claude 项目', async () => {
    process.env.CLAUDE_CONFIG_DIR = tmpDir;
    // 创建空的 projects 目录
    await mkdir(join(tmpDir, 'projects'), { recursive: true });

    const results = await discoverProjects();
    const claudeProjects = results.filter((p) => p.sources.includes('claude'));
    expect(claudeProjects).toHaveLength(0);
  });

  it('projects 目录不存在时不报错', async () => {
    process.env.CLAUDE_CONFIG_DIR = join(tmpDir, 'nonexistent');
    // 不创建任何目录，调用不应抛异常
    const results = await discoverProjects();
    // 不一定是空（其他工具可能有项目），但至少不报错
    expect(Array.isArray(results)).toBe(true);
  });
});

// ─── 隐藏目录跳过 ───

describe('跳过隐藏目录', () => {
  it('跳过 . 开头的项目目录', async () => {
    process.env.CLAUDE_CONFIG_DIR = tmpDir;

    // 正常项目
    const normal = join(tmpDir, 'projects', 'VisibleProject');
    await writeJsonl(normal, 'session.jsonl', [
      { cwd: '/Users/test/VisibleProject' },
    ]);

    // 隐藏目录
    const hidden = join(tmpDir, 'projects', '.hidden-project');
    await writeJsonl(hidden, 'session.jsonl', [
      { cwd: '/Users/test/.hidden-project' },
    ]);

    const results = await discoverProjects();
    const names = results.map((p) => p.name);
    expect(names).toContain('VisibleProject');
    expect(names).not.toContain('.hidden-project');
  });
});
