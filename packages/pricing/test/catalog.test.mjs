import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('catalog.json exposes the public pricing catalog', async () => {
  const raw = await readFile(new URL('../catalog.json', import.meta.url), 'utf-8');
  const catalog = JSON.parse(raw);

  assert.match(catalog.version, /^\d{4}-\d{2}-\d{2}/);
  assert.ok(catalog.providers?.openai?.codex);
  assert.ok(catalog.providers?.anthropic?.['claude-code']);
  assert.equal(catalog.aliases?.['gpt-5.6'], 'gpt-5.6-sol');
  assert.equal(catalog.providers.openai.codex.models['gpt-5.6-sol']?.input_per_million, 5);
  assert.equal(catalog.providers.openai.codex.models['gpt-5.6-terra']?.input_per_million, 2.5);
  assert.equal(catalog.providers.openai.codex.models['gpt-5.6-luna']?.input_per_million, 1);
  assert.equal(catalog.providers.openai.codex.models['gpt-5.5']?.tiers?.[1]?.input_per_million, 10);
  assert.equal(catalog.providers.openai.codex.models['gpt-5.5-pro']?.tiers?.[1]?.output_per_million, 270);
  assert.equal(catalog.providers.openai.codex.models['gpt-5.4']?.tiers?.[1]?.output_per_million, 22.5);
  assert.equal(catalog.providers.openai.codex.models['gpt-5.4-pro']?.tiers?.[1]?.input_per_million, 60);
});
