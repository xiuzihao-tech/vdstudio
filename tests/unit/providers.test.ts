// 真实供应方适配器：用本地假服务器模拟“OpenAI 兼容接口”和“方舟视频任务”，验证请求格式、解析与出错处理。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { makeLlm, extractJson } from '../../src/server/providers/llm.ts';
import { makeSeedance } from '../../src/server/providers/seedance.ts';
import { loadProviders } from '../../src/server/providers/index.ts';
import { PERSONAS } from '../../src/shared/catalog.ts';
import type { GenSettings, Topic } from '../../src/shared/types.ts';

const reqs: { path: string; body: any; auth?: string }[] = [];
let llmReply = '';
let failNext = 0;
const tasks = new Map<string, { polls: number; fail?: boolean }>();
const readBody = (r: IncomingMessage) => new Promise<any>(ok => { let s = ''; r.on('data', c => (s += c)); r.on('end', () => ok(s ? JSON.parse(s) : null)); });
const srv = createServer(async (q, s) => {
  const body = await readBody(q);
  reqs.push({ path: `${q.method} ${q.url}`, body, auth: q.headers.authorization });
  if (failNext) { failNext--; s.writeHead(500).end('{}'); return; }
  if (q.url === '/v1/chat/completions') { s.end(JSON.stringify({ choices: [{ message: { content: llmReply } }] })); return; }
  if (q.method === 'POST' && q.url === '/api/v3/contents/generations/tasks') {
    const id = `cgt-${tasks.size + 1}`; tasks.set(id, { polls: 0, fail: body.content[0].text.includes('坏镜头') }); s.end(JSON.stringify({ id })); return;
  }
  const m = q.url?.match(/tasks\/(cgt-\d+)$/);
  if (m) { const t = tasks.get(m[1])!; t.polls++; s.end(JSON.stringify(t.polls < 2 ? { id: m[1], status: 'running' } : t.fail ? { id: m[1], status: 'failed', error: { message: '内容不合规' } } : { id: m[1], status: 'succeeded', content: { video_url: `https://cdn.example/${m[1]}.mp4` } })); return; }
  s.writeHead(404).end('{}');
});
await new Promise<void>(r => srv.listen(0, r));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
after(() => srv.close());

const ctx = { persona: PERSONAS[0], positioning: { name: '林设计师', line: '把钱花对', aud: ['业主'], pillars: ['完工案例'], tone: '亲切' as const, tags: ['说真话'] } };
const topic: Topic = { id: 't1', cat: 0, title: '三年不乱的玄关', hook: '开场拍回家', why: '', dir: '项目案例', type: 0, heat: 2, k: 'entry', ageMonths: 1, source: 'hot', fav: false, createdAt: '' };

test('extractJson 能处理 ```json 包裹和前后多余文字', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('好的：{"a":2} 以上'), { a: 2 });
  assert.throws(() => extractJson('没有'));
});

test('文案模型：请求带人设与要求，解析成草稿', async () => {
  const llm = makeLlm({ baseUrl: `${base}/v1`, apiKey: 'k-llm', model: 'doubao-test' });
  llmReply = JSON.stringify({ titles: ['标题一', '标题二', '标题三'], hooks: ['钩子一', '钩子二'], body: ['一', '二', '三', '四'], cta: '私信', tags: ['#装修'] });
  const d = await llm.copy.generate(ctx, topic, { kind: '口播', len: 45, tone: '犀利', version: 2 });
  const r = reqs.at(-1)!;
  assert.equal(r.auth, 'Bearer k-llm');
  assert.equal(r.body.model, 'doubao-test');
  assert.equal(r.body.response_format.type, 'json_object');
  assert.match(r.body.messages[0].content, /林设计师/);
  assert.match(r.body.messages[0].content, /广告法/);
  assert.match(r.body.messages[1].content, /犀利/);
  assert.equal(d.title, '标题一'); assert.equal(d.body.length, 4); assert.equal(d.shots.length, 4); assert.equal(d.version, 2);
});

test('文案模型：格式不对、服务出错都给出可读的错误', async () => {
  const llm = makeLlm({ baseUrl: `${base}/v1`, apiKey: 'k', model: 'm' });
  llmReply = '我不知道';
  await assert.rejects(llm.copy.generate(ctx, topic, { kind: '口播', len: 30, tone: '亲切', version: 1 }), /格式不对/);
  failNext = 1;
  await assert.rejects(llm.topics.angles(ctx, topic), /文案模型出错（500）/);
  llmReply = JSON.stringify({ topics: [{ title: '甲', hook: 'h', dir: '项目案例', type: 2 }, { title: '乙', hook: 'h', dir: '行业观点', type: 1 }] });
  const t = await llm.topics.fromCase(ctx, { text: '海景房', imageKeys: ['bed'] });
  assert.deepEqual(t.map(x => x.title), ['甲', '乙']);
  assert.equal(t[0].k, 'bed');
});

const g: GenSettings = { copy: '一\n二', prompt: '暖光', title: 't', topicId: null, assetIds: [], model: 's25', len: 10, ratio: '9:16', res: '1080p', draft: true, voice: 'p1', speed: 1, bgm: '', subs: true, ambience: true, cover: false, style: 'AI 推荐' };

test('Seedance：每镜一个任务，带首帧、分辨率、比例、时长，轮询到成功', async () => {
  const v = makeSeedance({ apiKey: 'k-ark', baseUrl: `${base}/api/v3`, models: { s25: 'doubao-seedance-2-5-260628' }, pollMs: 5 });
  const steps: number[] = [];
  reqs.length = 0;
  const out = await v.run({ settings: g, final: false, frames: ['https://x/a.png', null], shots: [{ dur: 5, line: '一', k: 'a', generated: false }, { dur: 5, line: '二', k: 'b', generated: true }] }, s => steps.push(s));
  const creates = reqs.filter(r => r.path.startsWith('POST'));
  assert.equal(creates.length, 2);
  assert.equal(creates[0].auth, 'Bearer k-ark');
  assert.equal(creates[0].body.model, 'doubao-seedance-2-5-260628');
  assert.equal(creates[0].body.resolution, '480p', '样片模式走 480p');
  assert.equal(creates[0].body.ratio, '9:16');
  assert.equal(creates[0].body.duration, 5);
  assert.deepEqual(creates[0].body.content[1], { type: 'image_url', image_url: { url: 'https://x/a.png' }, role: 'first_frame' });
  assert.equal(creates[1].body.content.length, 1, '没有首帧就只发文字');
  assert.ok(out && out.shotVideos!.every(u => u?.startsWith('https://cdn.example/')));
  assert.equal(steps.at(-1), 5);
});

test('Seedance：某一镜失败，整条报错并说明是哪一镜', async () => {
  const v = makeSeedance({ apiKey: 'k', baseUrl: `${base}/api/v3`, models: { s25: 'm' }, pollMs: 5, concurrency: 1 });
  await assert.rejects(v.run({ settings: g, final: true, frames: [null, null], shots: [{ dur: 5, line: '好的', k: 'a', generated: true }, { dur: 5, line: '坏镜头', k: 'b', generated: true }] }, () => {}), /第 2 镜生成失败：内容不合规/);
  await assert.rejects(makeSeedance({ apiKey: 'k', baseUrl: `${base}/api/v3`, models: {}, pollMs: 5 }).run({ settings: g, final: false, frames: [], shots: [] }, () => {}), /没有为 Seedance 2.5 配置/);
});

test('按环境变量切换供应方', () => {
  assert.deepEqual(loadProviders({}).info, { copy: 'mock', video: 'mock' });
  assert.deepEqual(loadProviders({ LLM_API_KEY: 'a', LLM_BASE_URL: 'b', LLM_MODEL: 'c', ARK_API_KEY: 'd' }).info, { copy: 'llm', video: 'seedance' });
  assert.deepEqual(loadProviders({ AI_PROVIDER: 'mock', ARK_API_KEY: 'd' }).info, { copy: 'mock', video: 'mock' });
});
