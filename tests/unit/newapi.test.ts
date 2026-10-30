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
  if (q.method === 'POST' && q.url === '/v1/videos/generations') {
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

test('土豆视频：按档位选模型、带首帧（按土豆文档的字段）、尺寸与时长正确、三种返回都能拿到地址', async () => {
  reqs.length = 0;
  const v = makeNewApiVideo({ baseUrl: base, apiKey: 'k-tudou', models: { s25: 'seedance-2.5' }, pollMs: 5 });
  const steps: number[] = [];
  const shots = [1, 2, 3].map(i => ({ dur: 5, line: `第${i}镜`, k: 'a', generated: false }));
  const out = await v.run({ settings: g, final: true, frames: ['https://x/a.png', null, 'https://x/f.png'], shots }, s => steps.push(s));
  const creates = reqs.filter(r => r.method === 'POST');
  assert.equal(creates.length, 3);
  assert.equal(creates[0].auth, 'Bearer k-tudou');
  assert.equal(creates[0].body.model, 'seedance-2.5');
  assert.equal(creates[0].body.duration, 5);
  assert.deepEqual([creates[0].body.width, creates[0].body.height], [1080, 1920]);
  assert.equal(creates[0].body.metadata.resolution, '1080p');
  assert.equal(creates[0].body.metadata.ratio, '9:16');
  assert.equal(creates[0].body.input_reference, 'https://x/a.png', '土豆文档：单张首帧用 input_reference 或 images');
  assert.deepEqual(creates[0].body.images, ['https://x/a.png']);
  assert.deepEqual(creates[0].body.extra, { aspect_ratio: '9:16', resolution: '1080p', images: ['https://x/a.png'] }, '比例和清晰度也放进 extra');
  assert.equal(creates[1].body.input_reference, undefined);
  assert.deepEqual(creates[1].body.extra, { aspect_ratio: '9:16', resolution: '1080p' });
  assert.ok(out && out.shotVideos!.every(u => u?.startsWith('https://cdn.tudou.example/')));
  assert.equal(steps.at(-1), 5);
});

test('土豆视频：一镜失败（重试一次仍失败）不拖累其他镜，并说明原因；全失败才报错；没配模型给出可操作的提示', async () => {
  const v = makeNewApiVideo({ baseUrl: base, apiKey: 'k', models: { s25: 'seedance-2.5' }, pollMs: 5, concurrency: 1 });
  const before = reqs.filter(r => r.method === 'POST').length;
  const r = await v.run({ settings: g, final: true, frames: [null, null], shots: [{ dur: 5, line: '好', k: 'a', generated: true }, { dur: 5, line: '坏镜头', k: 'b', generated: true }] }, () => {});
  assert.ok(r && r.shotVideos?.[0]?.startsWith('https://'));
  assert.equal(r!.shotVideos?.[1], null);
  assert.match(r!.errors![1]!, /生成失败：内容审核未通过/);
  assert.equal(reqs.filter(q => q.method === 'POST').length - before, 3, '坏镜头自动重交了一次');
  await assert.rejects(v.run({ settings: g, final: true, frames: [null], shots: [{ dur: 5, line: '坏镜头', k: 'b', generated: true }] }, () => {}), /第 1 镜生成失败：内容审核未通过/);
  // 沿用上一版的镜头不重新提交
  const before2 = reqs.filter(q => q.method === 'POST').length;
  const r2 = await v.run({ settings: g, final: true, frames: [null, null], shots: [{ dur: 5, line: '好', k: 'a', generated: true, reused: true, videoUrl: '/files/x.mp4' }, { dur: 5, line: '新', k: 'b', generated: true }] }, () => {});
  assert.equal(reqs.filter(q => q.method === 'POST').length - before2, 1);
  assert.equal(r2!.shotVideos![0], '/files/x.mp4');
  await assert.rejects(makeNewApiVideo({ baseUrl: base, apiKey: 'k', models: {}, pollMs: 5 }).run({ settings: { ...g, model: 'wan' }, final: true, frames: [], shots: [] }, () => {}), /AI 服务/);
});

test('供应方选择：配了 VIDEO_* 走土豆，档位映射可在运行时改', () => {
  let saved: string | undefined;
  const a = loadProviders({ VIDEO_BASE_URL: base, VIDEO_API_KEY: 'k', LLM_BASE_URL: base, LLM_API_KEY: 'k', LLM_MODEL: 'gpt-5.6-terra' }, { get: k => (k === 'video_models' ? saved : k === 'llm_model' ? 'deepseek-v4' : undefined) });
  assert.deepEqual(a.info, { copy: 'llm', video: 'newapi', tts: 'none', vision: 'none' });
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
    const sess = (await call('GET', '/api/session')).json;
    assert.equal(sess.ai.video, 'newapi');
    assert.equal(sess.ai.firstFrame, false, '本机没有公网地址、土豆又不收 base64：首帧用不了');
    await call('POST', '/api/assets/samples');
    const as = (await call('GET', '/api/assets')).json.assets.filter((a: any) => a.type !== '人物').slice(0, 1).map((a: any) => a.id);
    const chk = await call('POST', '/api/gen/check', { ...g, ratio: '3:4', res: '720p', assetIds: as });
    const codes = chk.json.issues.map((i: any) => i.code);
    assert.ok(codes.includes('ratio_unsupported'), '土豆档位不支持 3:4');
    assert.ok(codes.includes('frame_unusable'));
    assert.equal((await call('POST', '/api/gen', { settings: { ...g, ratio: '3:4', res: '720p' } })).status, 422);
  } finally { app.server.close(); }
});

test('土豆文档的返回形态：按 /v1/tasks/{id} 查询，data.result.video_url 取地址；不支持的清晰度按可选值重交', async () => {
  const seen: { method: string; path: string; body: any }[] = [];
  let polls = 0;
  const doc = createServer(async (q, s) => {
    const body = await read(q); seen.push({ method: q.method!, path: q.url!, body });
    const send = (code: number, j: unknown) => { s.writeHead(code, { 'content-type': 'application/json' }); s.end(JSON.stringify(j)); };
    if (q.method === 'POST' && q.url === '/v1/videos/generations') {
      if (body.resolution === '480p') return send(400, { error: { message: '没有分辨率 480p，可选：720p, 1080p' } });
      return send(200, { code: 200, message: 'ok', data: { id: 'task_abc', task_id: 'task_abc', status: 'submitted', estimated_time: 120 } });
    }
    if (q.url === '/v1/tasks/task_abc') {
      polls++;
      return send(200, polls < 2 ? { code: 200, data: { id: 'task_abc', status: 'processing', progress: 30 } }
        : { code: 200, data: { id: 'task_abc', status: 'completed', progress: 100, result: { video_url: 'https://videos-2.ai-tudou.net/generated/task_abc_0.mp4', videos: [{ url: ['https://videos-2.ai-tudou.net/generated/task_abc_0.mp4'] }] } } });
    }
    send(404, { error: { message: 'not found' } });
  });
  await new Promise<void>(r => doc.listen(0, r));
  try {
    const v = makeNewApiVideo({ baseUrl: `http://127.0.0.1:${(doc.address() as AddressInfo).port}/v1`, apiKey: 'k', models: { s20f: 'seedance-2.0-fast' }, pollMs: 5 });
    const out = await v.run({ settings: { ...g, model: 's20f', res: '480p' }, final: true, frames: [null], shots: [{ dur: 5, line: '一', k: 'a', generated: true }] }, () => {});
    assert.deepEqual(out && out.shotVideos, ['https://videos-2.ai-tudou.net/generated/task_abc_0.mp4']);
    const creates = seen.filter(r => r.method === 'POST');
    assert.equal(creates.length, 2);
    assert.equal(creates[1].body.resolution, '720p');
    assert.equal(creates[1].body.extra.resolution, '720p', '重交时 extra 里的清晰度也要改');
    assert.ok(seen.filter(r => r.method === 'GET').every(r => r.path === '/v1/tasks/task_abc'), '直接用文档里的查询路径');
  } finally { doc.close(); }
});
