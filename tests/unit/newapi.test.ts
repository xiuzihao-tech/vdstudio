// 土豆 API（new-api 异步视频端点）适配器 + 后台 AI 服务接口：用本地假网关验证请求格式、字段兼容、失败处理、运行时切换模型。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { makeNewApiVideo, pickVideoUrl, pickTaskId } from '../../src/server/providers/newapi-video.ts';
import { loadProviders } from '../../src/server/providers/index.ts';
import type { GenSettings } from '../../src/shared/types.ts';

process.env.MOCK_DELAY_MS = '0';
process.env.TODAY = '2026-10-21';
const { createApp } = await import('../../src/server/app.ts');

const reqs: { method: string; path: string; body: any; auth?: string }[] = [];
const tasks = new Map<string, { polls: number; bad: boolean; style: number }>();
let n = 0;
const read = (r: IncomingMessage) => new Promise<any>(ok => { let s = ''; r.on('data', c => (s += c)); r.on('end', () => ok(s ? JSON.parse(s) : null)); });
const gw = createServer(async (q, s) => {
  const body = await read(q);
  reqs.push({ method: q.method!, path: q.url!, body, auth: q.headers.authorization });
  const send = (code: number, j: unknown) => { s.writeHead(code, { 'content-type': 'application/json' }); s.end(JSON.stringify(j)); };
  if (q.url === '/v1/models') return send(200, { data: [{ id: 'seedance-2.5' }, { id: 'gpt-5.6-terra' }, { id: 'deepseek-v4' }] });
  if (q.url === '/v1/chat/completions') return send(200, { choices: [{ message: { content: body.model === 'deepseek-v4' ? '我是测试模型' : 'hi' } }] });
  if (q.method === 'POST' && q.url === '/v1/video/generations') {
    if (!body.model) return send(400, { error: { message: 'model required' } });
    const id = `t${++n}`; tasks.set(id, { polls: 0, bad: String(body.prompt).includes('坏镜头'), style: n % 3 });
    return send(200, n % 2 ? { task_id: id, status: 'queued' } : { id, object: 'video' });
  }
  const m = q.url!.match(/^\/v1\/video\/generations\/(t\d+)$/);
  if (m) {
    const t = tasks.get(m[1])!; t.polls++;
    if (t.polls < 2) return send(200, { task_id: m[1], status: 'in_progress' });
    if (t.bad) return send(200, { task_id: m[1], status: 'failed', error: { code: 1, message: '内容审核未通过' } });
    const url = `https://cdn.tudou.example/${m[1]}.mp4`;
    // 三种常见返回形态
    return send(200, t.style === 0 ? { task_id: m[1], status: 'completed', url } : t.style === 1 ? { data: { status: 'SUCCESS', data: { video_url: url } } } : { status: 'succeeded', content: { video_url: url } });
  }
  send(404, { error: { message: 'not found' } });
});
await new Promise<void>(r => gw.listen(0, r));
const base = `http://127.0.0.1:${(gw.address() as AddressInfo).port}/v1`;
const dirs: string[] = [];
after(() => { gw.close(); dirs.forEach(d => rmSync(d, { recursive: true, force: true })); });

const g: GenSettings = { copy: '一\n二', prompt: '暖光', title: 't', topicId: null, assetIds: [], model: 's25', len: 10, ratio: '9:16', res: '1080p', draft: false, voice: 'p1', speed: 1, bgm: '', subs: true, ambience: true, cover: false, style: 'AI 推荐' };

test('兼容解析：任务 ID 与视频地址的各种返回形态', () => {
  assert.equal(pickTaskId({ task_id: 'a' }), 'a');
  assert.equal(pickTaskId({ id: 'b' }), 'b');
  assert.equal(pickTaskId({ data: { task_id: 'c' } }), 'c');
  assert.equal(pickVideoUrl({ url: 'https://x/a.mp4' }), 'https://x/a.mp4');
  assert.equal(pickVideoUrl({ data: { data: { video_url: 'https://x/b.mp4' } } }), 'https://x/b.mp4');
  assert.equal(pickVideoUrl({ deep: [{ any: 'https://x/c.mp4?sig=1' }] }), 'https://x/c.mp4?sig=1');
  assert.equal(pickVideoUrl({ url: 'not-a-url' }), null);
});

test('土豆视频：按档位选模型、带首帧（Base64 也行）、尺寸与时长正确、三种返回都能拿到地址', async () => {
  reqs.length = 0;
  const v = makeNewApiVideo({ baseUrl: base, apiKey: 'k-tudou', models: { s25: 'seedance-2.5' }, pollMs: 5 });
  const steps: number[] = [];
  const shots = [1, 2, 3].map(i => ({ dur: 5, line: `第${i}镜`, k: 'a', generated: false }));
  const out = await v.run({ settings: g, final: true, frames: ['data:image/png;base64,AAAA', null, 'https://x/f.png'], shots }, s => steps.push(s));
  const creates = reqs.filter(r => r.method === 'POST');
  assert.equal(creates.length, 3);
  assert.equal(creates[0].auth, 'Bearer k-tudou');
  assert.equal(creates[0].body.model, 'seedance-2.5');
  assert.equal(creates[0].body.duration, 5);
  assert.deepEqual([creates[0].body.width, creates[0].body.height], [1080, 1920]);
  assert.equal(creates[0].body.metadata.resolution, '1080p');
  assert.equal(creates[0].body.metadata.ratio, '9:16');
  assert.equal(creates[0].body.image, 'data:image/png;base64,AAAA');
  assert.equal(creates[1].body.image, undefined);
  assert.ok(out && out.shotVideos!.every(u => u?.startsWith('https://cdn.tudou.example/')));
  assert.equal(steps.at(-1), 5);
});

test('土豆视频：失败说明是哪一镜；没配模型给出可操作的提示', async () => {
  const v = makeNewApiVideo({ baseUrl: base, apiKey: 'k', models: { s25: 'seedance-2.5' }, pollMs: 5, concurrency: 1 });
  await assert.rejects(v.run({ settings: g, final: true, frames: [null, null], shots: [{ dur: 5, line: '好', k: 'a', generated: true }, { dur: 5, line: '坏镜头', k: 'b', generated: true }] }, () => {}), /第 2 镜生成失败：内容审核未通过/);
  await assert.rejects(makeNewApiVideo({ baseUrl: base, apiKey: 'k', models: {}, pollMs: 5 }).run({ settings: { ...g, model: 'wan' }, final: true, frames: [], shots: [] }, () => {}), /AI 服务/);
});

test('供应方选择：配了 VIDEO_* 走土豆，档位映射可在运行时改', () => {
  let saved: string | undefined;
  const a = loadProviders({ VIDEO_BASE_URL: base, VIDEO_API_KEY: 'k', LLM_BASE_URL: base, LLM_API_KEY: 'k', LLM_MODEL: 'gpt-5.6-terra' }, { get: k => (k === 'video_models' ? saved : k === 'llm_model' ? 'deepseek-v4' : undefined) });
  assert.deepEqual(a.info, { copy: 'llm', video: 'newapi' });
  assert.equal(a.status().copy.model, 'deepseek-v4', '后台选的模型优先于 .env');
  assert.equal(a.status().video.models!.s25, 'seedance-2.5');
  saved = JSON.stringify({ s25: 'seedance-2.5-c' });
  assert.equal(a.status().video.models!.s25, 'seedance-2.5-c');
});

test('后台 AI 服务：拉模型列表、切换文案模型、连通测试', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'findai-ai-')); dirs.push(dir);
  const app = createApp({ dbFile: ':memory:', dataDir: dir, webDir: dir, adminEmails: ['boss@x.com'], env: { LLM_BASE_URL: base, LLM_API_KEY: 'k', LLM_MODEL: 'gpt-5.6-terra', VIDEO_BASE_URL: base, VIDEO_API_KEY: 'k2' } });
  await new Promise<void>(r => app.server.listen(0, r));
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  let cookie = '';
  const call = async (method: string, path: string, data?: unknown) => {
    const r = await fetch(url + path, { method, headers: { 'content-type': 'application/json', cookie }, body: data === undefined ? undefined : JSON.stringify(data) });
    const sc = r.headers.getSetCookie().find(c => c.startsWith('sid=')); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, json: await r.json() as any };
  };
  try {
    await call('POST', '/api/auth/register', { email: 'boss@x.com', password: 'secret123', name: 'B' });
    const st = await call('GET', '/api/admin/ai');
    assert.equal(st.json.status.copy.kind, 'llm');
    assert.equal(st.json.status.video.kind, 'newapi');
    assert.ok(st.json.tiers.some((t: any) => t.id === 'wan'));
    const ms = await call('POST', '/api/admin/ai/models');
    assert.deepEqual(ms.json.llm.models, ['deepseek-v4', 'gpt-5.6-terra', 'seedance-2.5']);
    await call('PUT', '/api/admin/ai', { llmModel: 'deepseek-v4', videoModels: { s25: 'seedance-2.5', wan: 'wan3.0-fast' } });
    const t = await call('POST', '/api/admin/ai/test');
    assert.equal(t.json.ok, true);
    assert.equal(t.json.reply, '我是测试模型');
    assert.equal((await call('GET', '/api/admin/ai')).json.status.video.models.wan, 'wan3.0-fast');
    assert.equal((await call('GET', '/api/session')).json.ai.video, 'newapi');
  } finally { app.server.close(); }
});
