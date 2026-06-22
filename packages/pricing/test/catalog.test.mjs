import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('catalog.json exposes the public pricing catalog', async () => {
  const raw = await readFile(new URL('../catalog.json', import.meta.url), 'utf-8');
  const catalog = JSON.parse(raw);

  assert.match(catalog.version, /^\d{4}-\d{2}-\d{2}/);
  assert.ok(catalog.providers?.openai?.codex);
  assert.ok(catalog.providers?.anthropic?.['claude-code']);
});
