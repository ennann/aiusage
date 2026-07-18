import assert from 'node:assert/strict';
import test from 'node:test';

const localStorageStub = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
};

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageStub,
  configurable: true,
});

test('formatTokens shows compact and exact token counts for large values', async () => {
  const { formatTokens } = await import('./format');
  assert.equal(formatTokens(8_621_971_144), '8.6B (8,621,971,144)');
});

test('formatTokens keeps small values uncluttered', async () => {
  const { formatTokens } = await import('./format');
  assert.equal(formatTokens(42), '42');
});
