import { createCipheriv, createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  decodeTraeIntlAuthInfo,
  decryptTraeIntlAuthBlob,
  mergeTraeIntlSessions,
  syncTraeIntlUsage,
} from '../trae-intl-sync.js';

let rootDir: string;
let previousToken: string | undefined;

beforeEach(async () => {
  rootDir = join(tmpdir(), `aiusage-trae-intl-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(rootDir, { recursive: true });
  previousToken = process.env.AIUSAGE_TRAE_INTL_TOKEN;
});

afterEach(async () => {
  if (previousToken == null) delete process.env.AIUSAGE_TRAE_INTL_TOKEN;
  else process.env.AIUSAGE_TRAE_INTL_TOKEN = previousToken;
  await rm(rootDir, { recursive: true, force: true });
});

describe('Trae international sync', () => {
  it('decrypts the desktop SafeStorage blob used by Trae', () => {
    const plaintext = JSON.stringify({ token: 'test-token', host: 'https://api-sg-central.trae.ai' });
    const encoded = encryptAuthBlobForTest(plaintext);

    expect(decryptTraeIntlAuthBlob(encoded)).toBe(plaintext);
    expect(decodeTraeIntlAuthInfo(encoded)).toBe(plaintext);
  });

  it('accepts the plain JSON auth format used by older Trae releases', () => {
    const plaintext = JSON.stringify({ token: 'old-format-token', refreshToken: 'refresh' });

    expect(decodeTraeIntlAuthInfo(plaintext)).toBe(plaintext);
  });

  it('keeps the newest snapshot for each account session', () => {
    const merged = mergeTraeIntlSessions(
      [{ session_id: 'one', usage_time: 100, extra_info: { input_token: 10 } }],
      [
        { session_id: 'one', usage_time: 100, extra_info: { input_token: 20 } },
        { session_id: 'two', usage_time: 200, extra_info: { output_token: 5 } },
      ],
    );

    expect(merged).toEqual([
      expect.objectContaining({ session_id: 'one', extra_info: { input_token: 20 } }),
      expect.objectContaining({ session_id: 'two', extra_info: { output_token: 5 } }),
    ]);
  });

  it('queries the official account API and writes a private canonical cache', async () => {
    process.env.AIUSAGE_TRAE_INTL_TOKEN = 'Cloud-IDE-JWT test-access-token';
    const cacheDir = join(rootDir, 'sessions');
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({
        total: 1,
        user_usage_group_by_sessions: [{
          model_name: 'GPT-5.4',
          session_id: 'account-session',
          usage_time: 1_784_289_600,
          dollar_float: 0.25,
          extra_info: {
            input_token: 100,
            output_token: 20,
            cache_read_token: 200,
            cache_write_token: 30,
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const result = await syncTraeIntlUsage({
      cacheDir,
      sinceDays: 180,
      now: new Date('2026-07-19T00:00:00Z'),
      fetchImpl,
    });

    expect(result).toEqual(expect.objectContaining({
      edition: 'intl',
      scope: 'account',
      credentialVariant: 'environment',
      fetchedSessions: 1,
      storedSessions: 1,
      totals: {
        inputTokens: 100,
        cachedInputTokens: 200,
        cacheWriteTokens: 30,
        outputTokens: 20,
        totalTokens: 350,
        costUSD: 0.25,
      },
    }));
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain('/trae/api/v1/pay/query_user_usage_group_by_session');
    expect(new Headers(requests[0].init?.headers).get('authorization')).toBe('Cloud-IDE-JWT test-access-token');
    expect(JSON.parse(String(requests[0].init?.body))).toEqual(expect.objectContaining({
      page_size: 20,
      page_num: 1,
      usage_type: [5, 6],
    }));
    expect(JSON.parse(await readFile(join(cacheDir, 'usage.json'), 'utf8'))).toHaveLength(1);
    expect((await stat(join(cacheDir, 'usage.json'))).mode & 0o777).toBe(0o600);
  });

  it('refreshes Trae IDE credentials with the IDE-specific client id', async () => {
    delete process.env.AIUSAGE_TRAE_INTL_TOKEN;
    const cacheDir = join(rootDir, 'sessions');
    await writeFile(join(rootDir, 'credentials-ide.json'), JSON.stringify({
      variant: 'ide',
      token: 'expired-access',
      refreshToken: 'valid-refresh',
      expiredAt: '2020-01-01T00:00:00Z',
      refreshExpiredAt: '2999-01-01T00:00:00Z',
      host: 'https://api.example.test',
      clientId: 'ono9krqynydwx5',
    }));
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      if (String(input).includes('/ExchangeToken')) {
        return new Response(JSON.stringify({
          Result: {
            Token: 'fresh-access',
            RefreshToken: 'fresh-refresh',
            TokenExpireAt: Date.parse('2998-01-01T00:00:00Z'),
            RefreshExpireAt: Date.parse('2999-01-01T00:00:00Z'),
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ total: 0, user_usage_group_by_sessions: [] }), { status: 200 });
    }) as typeof fetch;

    await syncTraeIntlUsage({ cacheDir, fetchImpl });

    expect(requests).toHaveLength(2);
    expect(JSON.parse(String(requests[0].init?.body))).toEqual(expect.objectContaining({
      ClientID: 'ono9krqynydwx5',
      RefreshToken: 'valid-refresh',
    }));
    expect(new Headers(requests[1].init?.headers).get('authorization')).toBe('Cloud-IDE-JWT fresh-access');
  });
});

function encryptAuthBlobForTest(plaintext: string): string {
  const salt = Buffer.alloc(32, 0xaa);
  const password = Buffer.from([
    77, 212, 194, 230, 184, 49, 98, 9, 14, 82, 179, 199, 166, 115, 59, 164,
    28, 178, 70, 43, 130, 154, 181, 138, 25, 107, 57, 219, 87, 23, 117, 36,
    244, 155, 175, 127, 8, 232, 214, 141, 38, 167, 46, 55, 193, 169, 90, 47,
    31, 5, 165, 24, 146, 174, 242, 148, 151, 50, 182, 42, 56, 170, 221, 88,
  ]);
  const derived = createHash('sha512').update(Buffer.concat([
    createHash('sha512').update(salt).digest(),
    password,
  ])).digest();
  const data = Buffer.from(plaintext);
  const cipher = createCipheriv('aes-128-cbc', derived.subarray(0, 16), derived.subarray(16, 32));
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.concat([createHash('sha512').update(data).digest(), data])),
    cipher.final(),
  ]);
  return Buffer.concat([
    Buffer.from([0x74, 0x63, 0x05, 0x10, 0x00, 0x00]),
    salt,
    ciphertext,
  ]).toString('base64');
}
