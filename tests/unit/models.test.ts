// 模型选择：中转站实际能力（土豆 Seedance 最高 720p）、样片低价模型、文案「精写」与备用模型自动切换。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MODELS, TUDOU_CAPS, withCaps, PERSONAS } from '../../src/shared/catalog.ts';
import { clampRes, genIssues, modelOf, setVideoModels } from '../../src/shared/gen.ts';
import { makeNewApiVideo, TUDOU_DEFAULT_MODELS } from '../../src/server/providers/newapi-video.ts';
import { makeLlm } from '../../src/server/providers/llm.ts';
import type { GenSettings, Topic } from '../../src/shared/types.ts';

// 假网关：chat 按模型名决定成败；视频只记请求、立刻完成
const seen: { path: string; body: any }[] = [];
const read = (r: IncomingMessage) => new Promise<any>(ok => { let s = ''; r.on('data', c => (s += c)); r.on('end', () => ok(s ? JSON.parse(s) : null)); });
const COPY = JSON.stringify({ titles: ['标题'], hooks: ['钩子'], body: ['一', '二'], cta: '私信', tags: ['#装修'] });
const gw = createServer(async (q, s) => {
  const body = await read(q); seen.push({ path: q.url!, body });
  const send = (code: number, j: unknown) => { s.writeHead(code, { 'content-type': 'application/json' }); s.end(JSON.stringify(j)); };
  if (q.url === '/v1/chat/completions') {
    if (body.model === 'down-model') return send(503, { error: { message: 'upstream channel unavailable' } });
    if (body.model === 'gone-model') return send(400, { error: { message: 'model gone-model does not exist' } });
    if (body.model === 'bad-key-model') return send(401, { error: { message: 'invalid token' } });
    if (body.model === 'garbage-model') return send(200, { choices: [{ message: { content: '我不会输出 JSON' } }] });
    return send(200, { choices: [{ message: { content: COPY } }] });
  }
  if (q.method === 'POST' && q.url === '/v1/videos/generations') return send(200, { code: 200, data: { id: `task_${seen.length}`, status: 'submitted' } });
  const m = q.url!.match(/\/v1\/videos\/generations\/(task_\d+)$/);
  // 土豆实测返回形态：status=completed，视频地址在 metadata.url
  if (m) return send(200, { id: m[1], object: 'video', status: 'completed', progress: 100, metadata: { url: `https://seedance.ai-tudou.net/generated/${m[1]}.mp4` } });
  send(404, {});
});
await new Promise<void>(r => gw.listen(0, r));
const base = `http://127.0.0.1:${(gw.address() as AddressInfo).port}/v1`;
after(() => { gw.close(); setVideoModels(MODELS); });

const ctx = { persona: PERSONAS[0], positioning: { name: '林设计师', line: '把钱花对', aud: ['业主'], pillars: ['完工案例'], tone: '亲切' as const, tags: ['说真话'] } };
const topic: Topic = { id: 't1', cat: 0, title: '三年不乱的玄关', hook: '开场拍回家', why: '', dir: '项目案例', type: 0, heat: 2, k: 'entry', ageMonths: 1, source: 'hot', fav: false, createdAt: '' };
const g: GenSettings = { copy: '一\n二', prompt: '', title: 't', topicId: null, assetIds: ['a'], model: 's25', len: 10, ratio: '9:16', res: '720p', draft: true, voice: 'p1', speed: 1, bgm: '', subs: true, ambience: true, cover: false, style: 'AI 推荐' };

test('接土豆时：Seedance 档位最高 720p，1080p 会被拦下；万相可以 1080p；清晰度自动退档', () => {
  setVideoModels(withCaps(MODELS, TUDOU_CAPS));
  assert.deepEqual(modelOf('s25').res, ['480p', '720p']);
  assert.equal(modelOf('s25').max, 30);
  assert.ok(genIssues({ ...g, res: '1080p' }, 'ready').some(i => i.code === 'res_unsupported' && i.blocking));
  assert.deepEqual(genIssues({ ...g, model: 'wan', res: '1080p', draft: false }, 'ready'), []);
  assert.equal(clampRes('s20', '4K'), '720p');
  assert.equal(clampRes('wan', '4K'), '1080p');
  setVideoModels(MODELS);
  assert.ok(modelOf('s20').res.includes('4K'), '没接中转站时用通用目录');
});

test('样片模式统一走最便宜的 seedance-2.0-mini、480p；成片用所选档位的模型', async () => {
  setVideoModels(withCaps(MODELS, TUDOU_CAPS));
  const v = makeNewApiVideo({ baseUrl: base, apiKey: 'k', models: TUDOU_DEFAULT_MODELS, pollMs: 2 });
  const shots = [{ dur: 5, line: '一', k: 'a', generated: true }];
  seen.length = 0;
  const draft = await v.run({ settings: g, shots, frames: [null], final: false }, () => {});
  const c1 = seen.find(r => r.path === '/v1/videos/generations')!;
  assert.equal(c1.body.model, 'seedance-2.0-mini'); assert.equal(c1.body.resolution, '480p');
  assert.match(String(draft && draft.shotVideos![0]), /^https:\/\/seedance\.ai-tudou\.net\/generated\//, '能从 metadata.url 取到地址');
  seen.length = 0;
  await v.run({ settings: g, shots, frames: [null], final: true }, () => {});
  const c2 = seen.find(r => r.path === '/v1/videos/generations')!;
  assert.equal(c2.body.model, 'seedance-2.5'); assert.equal(c2.body.resolution, '720p');
  seen.length = 0;
  await v.run({ settings: { ...g, draft: false, model: 'wan', res: '1080p' }, shots, frames: [null], final: false }, () => {});
  assert.equal(seen.find(r => r.path === '/v1/videos/generations')!.body.model, 'wan3.0', '万相没有样片模式，直接出');
  setVideoModels(MODELS);
});

test('文案：主模型挂了自动换备用；模型不存在也换；密钥错误不乱换直接报错', async () => {
  const mk = (model: string, fallbacks: string[]) => makeLlm({ baseUrl: base, apiKey: 'k', model: () => model, fallbacks: () => fallbacks });
  seen.length = 0;
  const a = mk('down-model', ['gone-model', 'deepseek-v4-flash']);
  const d = await a.copy.generate(ctx, topic, { kind: '口播', len: 30, tone: '亲切', version: 1 });
  assert.equal(d.title, '标题');
  assert.deepEqual(seen.filter(r => r.path === '/v1/chat/completions').map(r => r.body.model).filter((x, i, l) => l.indexOf(x) === i), ['down-model', 'gone-model', 'deepseek-v4-flash']);
  assert.equal(a.lastUsed(), 'deepseek-v4-flash');
  await assert.rejects(mk('bad-key-model', ['deepseek-v4-flash']).copy.generate(ctx, topic, { kind: '口播', len: 30, tone: '亲切', version: 1 }), /401/);
  await assert.rejects(mk('down-model', []).copy.generate(ctx, topic, { kind: '口播', len: 30, tone: '亲切', version: 1 }), /503/, '没有备用就把错误告诉用户');
  const b = mk('garbage-model', ['deepseek-v4-flash']);
  assert.equal((await b.copy.generate(ctx, topic, { kind: '口播', len: 30, tone: '亲切', version: 1 })).title, '标题', '格式不对也换模型');
});

test('精写：用精写模型，提示词更讲究；没设精写模型就用默认模型', async () => {
  const llm = makeLlm({ baseUrl: base, apiKey: 'k', model: () => 'deepseek-v4.1-flash', fineModel: () => 'deepseek-v4-pro', fallbacks: () => ['deepseek-v4-flash'] });
  seen.length = 0;
  await llm.copy.generate(ctx, topic, { kind: '口播', len: 45, tone: '犀利', version: 2, quality: 'fine' });
  const r = seen.find(x => x.path === '/v1/chat/completions')!;
  assert.equal(r.body.model, 'deepseek-v4-pro');
  assert.match(r.body.messages[1].content, /精写/);
  assert.deepEqual(llm.chain('fine'), ['deepseek-v4-pro', 'deepseek-v4.1-flash', 'deepseek-v4-flash'], '精写模型不行就退回默认，再退备用');
  seen.length = 0;
  await llm.copy.generate(ctx, topic, { kind: '口播', len: 45, tone: '犀利', version: 2 });
  assert.equal(seen.find(x => x.path === '/v1/chat/completions')!.body.model, 'deepseek-v4.1-flash');
  const plain = makeLlm({ baseUrl: base, apiKey: 'k', model: () => 'deepseek-v4.1-flash' });
  assert.deepEqual(plain.chain('fine'), ['deepseek-v4.1-flash']);
});
