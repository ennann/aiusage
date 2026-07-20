import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQuery } from './data';

test('buildQuery encodes multi-select filters as repeated params', () => {
  const query = buildQuery({
    range: '30d',
    products: ['codex', 'claude-code'],
    models: ['gpt-5.5', 'gpt-5.4-mini'],
    projects: ['aiusage'],
    deviceIds: ['mbp-16', 'us1'],
  });

  const params = new URLSearchParams(query);
  assert.equal(params.get('range'), '30d');
  assert.deepEqual(params.getAll('product'), ['codex', 'claude-code']);
  assert.deepEqual(params.getAll('model'), ['gpt-5.5', 'gpt-5.4-mini']);
  assert.deepEqual(params.getAll('project'), ['aiusage']);
  assert.deepEqual(params.getAll('deviceId'), ['mbp-16', 'us1']);
});

test('buildQuery keeps month range for the API', () => {
  const query = buildQuery({ range: 'month', products: [] });
  assert.equal(new URLSearchParams(query).get('range'), 'month');
});
