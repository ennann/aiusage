import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AUTO_RESIZE_SCRIPT } from '../embed/host-script';
import { buildEmbedUrl, parseEmbedParams } from '../embed/parse-params';

test('legacy embed URLs without locale remain English', () => {
  const params = parseEmbedParams('?widget=stats-row1');
  assert.equal(params.locale, 'en');
  assert.equal(params.currency, 'auto');
});

test('legacy unknown locale values still fall back to English', () => {
  const params = parseEmbedParams('?widget=stats-row1&locale=fr');
  assert.equal(params.locale, 'en');
});

test('embed params accept explicit auto locale and CNY currency', () => {
  const params = parseEmbedParams('?widget=stats-row1&locale=auto&currency=cny');
  assert.equal(params.locale, 'auto');
  assert.equal(params.currency, 'CNY');
});

test('generated embed URL is absolute to the dashboard origin', () => {
  const params = new URLSearchParams({ widget: 'stats-row1', currency: 'CNY' });
  assert.equal(
    buildEmbedUrl('https://aiusage.example.com', params),
    'https://aiusage.example.com/embed?widget=stats-row1&currency=CNY',
  );
});

test('host resize script routes height messages by iframe window', () => {
  assert.match(AUTO_RESIZE_SCRIPT, /f\.contentWindow === e\.source/);
  assert.doesNotMatch(AUTO_RESIZE_SCRIPT, /searchParams\.get\('widget'\) === e\.data\.widget/);
});
