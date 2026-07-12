import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanGrokBuildDates } from '../grok-build.js';

const day = '2026-07-10';
let root: string;

beforeEach(async () => { root = join(tmpdir(), `aiusage-grok-${Date.now()}`); await mkdir(root, { recursive: true }); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function session(files: Record<string, string>, cwd = '/work/demo', id = 'session-1'): Promise<void> {
  const dir = join(root, 'sessions', encodeURIComponent(cwd), id);
  await mkdir(dir, { recursive: true });
  await Promise.all(Object.entries(files).map(([name, value]) => writeFile(join(dir, name), value)));
}

describe('Grok Build scanner', () => {
  it('returns an empty result for an empty directory', async () => {
    expect((await scanGrokBuildDates([day], root)).get(day)).toEqual([]);
  });

  it('counts turn_started, sessions, recognizes model and project aliases', async () => {
    await session({
      'summary.json': JSON.stringify({ cwd: '/work/demo', current_model_id: 'grok-4.5' }),
      'events.jsonl': [
        JSON.stringify({ type: 'turn_started', timestamp: `${day}T12:00:00Z` }),
        JSON.stringify({ type: 'turn_started', timestamp: `${day}T12:05:00Z` }),
      ].join('\n'),
      'chat_history.jsonl': [
        JSON.stringify({ id: 'u1', role: 'user', content: 'hello Grok' }),
        JSON.stringify({ id: 'a1', role: 'assistant', content: 'hello back' }),
      ].join('\n'),
      'updates.jsonl': JSON.stringify({ id: 'a1', role: 'assistant', content: 'hello back' }),
      'signals.json': JSON.stringify({ contextTokensUsed: 999999 }),
      'auth.json': '{not read}',
    });
    const [result] = (await scanGrokBuildDates([day], root, { '/work/demo': 'Demo alias' })).get(day)!;
    expect(result).toMatchObject({ provider: 'xai', product: 'grok-build', channel: 'cli', model: 'grok-4.5', project: '/work/demo', projectAlias: 'Demo alias', eventCount: 2, sessionCount: 1 });
    // Text estimate is deliberately small and contextTokensUsed is not counted.
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.inputTokens).toBeLessThan(100);
    expect(result.outputTokens).toBeGreaterThan(0);
  });

  it('keeps event and session counts when no usage or text is available', async () => {
    await session({
      'summary.json': JSON.stringify({ model_id: 'grok-4.5' }),
      'events.jsonl': JSON.stringify({ event_type: 'turn_started', created_at: `${day}T12:00:00Z` }),
      'signals.json': JSON.stringify({ contextTokensUsed: 50000 }),
    }, '/work/no-tokens');
    const [result] = (await scanGrokBuildDates([day], root)).get(day)!;
    expect(result).toMatchObject({ eventCount: 1, sessionCount: 1, inputTokens: 0, outputTokens: 0 });
  });

  it('splits a multi-day session estimate by each day\'s turn count', async () => {
    await session({
      'summary.json': JSON.stringify({ model_id: 'grok-4.5' }),
      'events.jsonl': [
        JSON.stringify({ type: 'turn_started', ts: `${day}T12:00:00Z` }),
        JSON.stringify({ type: 'turn_started', ts: `${day}T12:01:00Z` }),
        JSON.stringify({ type: 'turn_started', ts: '2026-07-11T12:00:00Z' }),
      ].join('\n'),
      'chat_history.jsonl': [
        JSON.stringify({ id: 'u1', role: 'user', content: 'abcdefghijklmnopqrstuvwx' }),
        JSON.stringify({ id: 'a1', role: 'assistant', content: 'abcdefghijklmnopqrstuvwx' }),
      ].join('\n'),
    }, '/work/multi-day');

    const result = await scanGrokBuildDates([day, '2026-07-11'], root);
    const [firstDay] = result.get(day)!;
    const [secondDay] = result.get('2026-07-11')!;
    expect(firstDay).toMatchObject({ eventCount: 2, inputTokens: 4, outputTokens: 4 });
    expect(secondDay).toMatchObject({ eventCount: 1, inputTokens: 2, outputTokens: 2 });
  });

  it('does not treat token-shaped local fields as authoritative billing data', async () => {
    await session({
      'summary.json': JSON.stringify({ model_id: 'grok-4.5' }),
      'events.jsonl': JSON.stringify({ type: 'turn_started', timestamp: `${day}T12:00:00Z`, usage: { inputTokens: 100, outputTokens: 20 } }),
      'chat_history.jsonl': JSON.stringify({ role: 'user', content: 'this should not replace real usage' }),
    }, '/work/real-usage');
    const [result] = (await scanGrokBuildDates([day], root)).get(day)!;
    expect(result.inputTokens).toBe(Math.ceil([...'this should not replace real usage'].length / 4));
    expect(result.outputTokens).toBe(0);
  });

  it('reads real Grok Build event field `ts` and counts turns', async () => {
    await session({
      'summary.json': JSON.stringify({
        info: { cwd: 'C:\\Users\\sakur\\demo' },
        current_model_id: 'grok-4.5',
        created_at: `${day}T12:25:10.098894700Z`,
      }),
      'events.jsonl': [
        JSON.stringify({ ts: `${day}T12:25:30.055Z`, type: 'turn_started', model_id: 'grok-4.5', turn_number: 0 }),
        JSON.stringify({ ts: `${day}T12:41:35.755Z`, type: 'turn_started', model_id: 'grok-4.5', turn_number: 1 }),
        JSON.stringify({ ts: `${day}T12:25:31.411Z`, type: 'first_token' }),
      ].join('\n'),
      'chat_history.jsonl': [
        JSON.stringify({ type: 'system', content: 'You are Grok.' }),
        JSON.stringify({ type: 'user', content: [{ type: 'text', text: 'hello world' }] }),
        JSON.stringify({ type: 'assistant', content: 'hi there' }),
      ].join('\n'),
      'signals.json': JSON.stringify({ contextTokensUsed: 3881, primaryModelId: 'grok-4.5' }),
    }, 'C:\\Users\\sakur\\demo', 'real-schema');

    const [result] = (await scanGrokBuildDates([day], root)).get(day)!;
    expect(result).toMatchObject({
      model: 'grok-4.5',
      eventCount: 2,
      sessionCount: 1,
      projectDisplay: 'demo',
    });
    // system + user input, assistant output; contextTokensUsed must not appear
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.inputTokens).toBeLessThan(3881);
  });

  it('maps user home directory sessions to Other', async () => {
    await session({
      'summary.json': JSON.stringify({
        info: { cwd: 'C:\\Users\\sakur' },
        current_model_id: 'grok-4.5',
        created_at: `${day}T12:09:00Z`,
      }),
      'events.jsonl': JSON.stringify({ ts: `${day}T12:09:01Z`, type: 'turn_started', model_id: 'grok-4.5' }),
      'chat_history.jsonl': [
        JSON.stringify({ type: 'user', content: [{ type: 'text', text: 'hi' }] }),
        JSON.stringify({ type: 'assistant', content: 'hello' }),
      ].join('\n'),
    }, 'C:\\Users\\sakur', 'home-session');

    const [result] = (await scanGrokBuildDates([day], root)).get(day)!;
    expect(result).toMatchObject({
      project: 'other',
      projectDisplay: 'Other',
      model: 'grok-4.5',
    });
  });

  it('parses array content and type-as-role without double-counting updates chunks', async () => {
    const userText = 'please fix the scanner';
    const assistantText = 'done fixing';
    await session({
      'summary.json': JSON.stringify({ current_model_id: 'grok-4.5', created_at: `${day}T12:10:00Z` }),
      'events.jsonl': JSON.stringify({ ts: `${day}T12:10:01Z`, type: 'turn_started', model_id: 'grok-4.5' }),
      'chat_history.jsonl': [
        JSON.stringify({ type: 'user', content: [{ type: 'text', text: userText }] }),
        JSON.stringify({ type: 'assistant', content: assistantText }),
      ].join('\n'),
      // Streaming chunks of the same text — must not inflate counts when chat_history exists
      'updates.jsonl': [
        JSON.stringify({
          timestamp: Math.floor(new Date(`${day}T12:10:01Z`).getTime() / 1000),
          method: 'session/update',
          params: {
            update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: userText } },
            _meta: { eventId: 'e1' },
          },
        }),
        JSON.stringify({
          timestamp: Math.floor(new Date(`${day}T12:10:02Z`).getTime() / 1000),
          method: 'session/update',
          params: {
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: assistantText } },
            _meta: { eventId: 'e2', totalTokens: 99999 },
          },
        }),
      ].join('\n'),
    }, '/work/array-content');

    const [result] = (await scanGrokBuildDates([day], root)).get(day)!;
    const expectedIn = Math.ceil([...userText].length / 4);
    const expectedOut = Math.ceil([...assistantText].length / 4);
    expect(result.inputTokens).toBe(expectedIn);
    expect(result.outputTokens).toBe(expectedOut);
    expect(result.inputTokens).not.toBe(99999);
  });

  it('falls back to updates chunks when chat_history is missing', async () => {
    await session({
      'summary.json': JSON.stringify({ current_model_id: 'grok-4.5', created_at: `${day}T12:11:00Z` }),
      'events.jsonl': JSON.stringify({ ts: `${day}T12:11:01Z`, type: 'turn_started' }),
      'updates.jsonl': [
        JSON.stringify({
          timestamp: Math.floor(new Date(`${day}T12:11:01Z`).getTime() / 1000),
          method: 'session/update',
          params: {
            update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'only updates path' } },
            _meta: { eventId: 'u1' },
          },
        }),
        JSON.stringify({
          timestamp: Math.floor(new Date(`${day}T12:11:02Z`).getTime() / 1000),
          method: 'session/update',
          params: {
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'reply' } },
            _meta: { eventId: 'a1' },
          },
        }),
      ].join('\n'),
    }, '/work/updates-only');

    const [result] = (await scanGrokBuildDates([day], root)).get(day)!;
    expect(result.eventCount).toBe(1);
    expect(result.inputTokens).toBe(Math.ceil([...'only updates path'].length / 4));
    expect(result.outputTokens).toBe(Math.ceil([...'reply'].length / 4));
  });

  it('ignores untrusted cached token fields when no message estimate is available', async () => {
    await session({
      'summary.json': JSON.stringify({ model_id: 'grok-4.5' }),
      'events.jsonl': JSON.stringify({
        ts: `${day}T12:00:00Z`,
        type: 'turn_started',
        usage: { input_tokens: 80, output_tokens: 10, cached_input_tokens: 40 },
      }),
    }, '/work/cached');
    const [result] = (await scanGrokBuildDates([day], root)).get(day)!;
    expect(result).toMatchObject({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 });
  });

  it('counts assistant tool_calls as output even when content is empty', async () => {
    const args = JSON.stringify({ file_path: '/work/a.ts', content: 'export const x = 1;\n'.repeat(20) });
    await session({
      'summary.json': JSON.stringify({ current_model_id: 'grok-4.5', created_at: `${day}T12:13:00Z` }),
      'events.jsonl': JSON.stringify({ ts: `${day}T12:13:01Z`, type: 'turn_started' }),
      'chat_history.jsonl': [
        JSON.stringify({ type: 'user', content: [{ type: 'text', text: 'write a file' }] }),
        JSON.stringify({
          type: 'assistant',
          content: '',
          tool_calls: [{ id: 'c1', name: 'write', arguments: args }],
        }),
        JSON.stringify({ type: 'tool_result', tool_call_id: 'c1', content: 'ok wrote file' }),
      ].join('\n'),
    }, '/work/tool-calls');

    const [result] = (await scanGrokBuildDates([day], root)).get(day)!;
    const expectedOut = Math.ceil([...'write'].length / 4) + Math.ceil([...args].length / 4);
    const expectedIn =
      Math.ceil([...'write a file'].length / 4) +
      Math.ceil([...'ok wrote file'].length / 4);
    expect(result.outputTokens).toBe(expectedOut);
    expect(result.inputTokens).toBe(expectedIn);
    expect(result.outputTokens).toBeGreaterThan(result.inputTokens);
  });

  it('counts agent_thought_chunk as reasoning without double-counting message text', async () => {
    const thought = 'I should inspect the scanner and fix tool call accounting carefully.';
    const reply = 'fixed tool calls';
    await session({
      'summary.json': JSON.stringify({ current_model_id: 'grok-4.5', created_at: `${day}T12:14:00Z` }),
      'events.jsonl': JSON.stringify({ ts: `${day}T12:14:01Z`, type: 'turn_started' }),
      'chat_history.jsonl': [
        JSON.stringify({ type: 'user', content: [{ type: 'text', text: 'optimize please' }] }),
        JSON.stringify({ type: 'assistant', content: reply }),
      ].join('\n'),
      'updates.jsonl': [
        JSON.stringify({
          timestamp: Math.floor(new Date(`${day}T12:14:01Z`).getTime() / 1000),
          method: 'session/update',
          params: {
            update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: thought } },
            _meta: { eventId: 'th1' },
          },
        }),
        JSON.stringify({
          timestamp: Math.floor(new Date(`${day}T12:14:02Z`).getTime() / 1000),
          method: 'session/update',
          params: {
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: reply } },
            _meta: { eventId: 'm1' },
          },
        }),
      ].join('\n'),
    }, '/work/thoughts');

    const [result] = (await scanGrokBuildDates([day], root)).get(day)!;
    expect(result.outputTokens).toBe(Math.ceil([...reply].length / 4));
    expect(result.reasoningOutputTokens).toBe(Math.ceil([...thought].length / 4));
    // agent_message_chunk must not inflate output when chat_history already has the reply
    expect(result.outputTokens).toBeLessThan(Math.ceil([...reply].length / 4) * 2);
  });
});
