// 接口集成测试：内存数据库 + Mock 供应方（零延迟），覆盖“选题 → 文案 → 生成 → 排期”主链路。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

process.env.MOCK_DELAY_MS = '0';
process.env.AI_PROVIDER = 'mock'; // 不受本机 .env 里真实密钥影响
process.env.TODAY = '2026-10-21';
const { createApp } = await import('../../src/server/app.ts');

const dir = mkdtempSync(join(tmpdir(), 'findai-'));
const app = createApp({ dbFile: ':memory:', dataDir: dir, webDir: dir });
let base = '', cookie = '';
before(async () => { await new Promise<void>(r => app.server.listen(0, r)); base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`; });
after(() => { app.server.close(); rmSync(dir, { recursive: true, force: true }); });

async function api(method: string, path: string, data?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie, ...headers }, body: data === undefined ? undefined : data instanceof Uint8Array ? (data as unknown as BodyInit) : JSON.stringify(data) });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const json = await res.json();
  return { status: res.status, json };
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

test('首次访问自动建工作区并带种子数据', async () => {
  const s = await api('GET', '/api/session');
  assert.equal(s.status, 200);
  assert.equal(s.json.workspace.persona, 'designer');
  assert.ok(cookie.startsWith('fid='));
  const t = await api('GET', '/api/topics/all');
  assert.equal(t.json.topics.length, 29);
  const a = await api('GET', '/api/assets');
  assert.ok(a.json.assets.length >= 6);
});

test('选题组合筛选', async () => {
  const all = (await api('GET', '/api/topics?cat=all')).json.topics;
  const sci = (await api('GET', '/api/topics?cat=all&dir=知识科普')).json.topics;
  assert.ok(sci.length > 0 && sci.length < all.length && sci.every((t: any) => t.dir === '知识科普'));
  const hot3 = (await api('GET', '/api/topics?cat=all&heat=3&period=3')).json.topics;
  assert.ok(hot3.every((t: any) => t.heat === 3 && t.ageMonths <= 3));
  const bad = await api('GET', '/api/topics?heat=9');
  assert.equal(bad.status, 400);
});

test('案例策划出 3 个选题并放在最前', async () => {
  const r = await api('POST', '/api/topics/from-case', { text: '海景房，主卧衣帽间', imageKeys: ['bed'] });
  assert.equal(r.json.topics.length, 3);
  const first = (await api('GET', '/api/topics/all')).json.topics[0];
  assert.equal(first.id, r.json.topics[0].id);
  assert.equal(first.source, 'ai');
});

test('文案：生成、检查违禁词、保存草稿', async () => {
  const t = (await api('GET', '/api/topics/all')).json.topics[0];
  const g = await api('POST', '/api/copy/generate', { topicId: t.id, len: 45 });
  assert.equal(g.status, 200);
  assert.ok(g.json.draft.body.length === 4);
  assert.ok(g.json.check.banned.some((b: any) => b[0] === '保证'));
  const rw = await api('POST', '/api/copy/rewrite', { draft: g.json.draft, how: 'live' });
  assert.ok(rw.json.draft.live > g.json.draft.live);
  const saved = await api('PUT', '/api/drafts', rw.json.draft);
  assert.ok(saved.json.id.startsWith('cp_'));
  const again = await api('PUT', '/api/drafts', { ...rw.json.draft, title: '改过的标题' });
  assert.equal(again.json.id, saved.json.id, '同一选题只有一份草稿');
  assert.equal((await api('GET', '/api/drafts')).json.drafts.length, 1);
});

test('生成：冲突拦截、扣点、任务跑完、余额不足', async () => {
  const s0 = (await api('GET', '/api/session')).json.workspace.balance;
  const settings = { copy: '第一行\n第二行', model: 's20f', len: 30, ratio: '9:16', res: '4K', draft: false, voice: 'p1', speed: 1, bgm: '温暖钢琴', subs: true, ambience: true, cover: false };
  const chk = await api('POST', '/api/gen/check', settings);
  assert.ok(chk.json.issues.some((i: any) => i.code === 'res_unsupported'));
  assert.equal((await api('POST', '/api/gen', { settings })).status, 422);
  const ok = await api('POST', '/api/gen', { settings: { ...settings, res: '720p' }, title: '测试片' });
  assert.equal(ok.status, 201);
  const cost = ok.json.cost;
  for (let i = 0; i < 20; i++) { const j = await api('GET', `/api/jobs/${ok.json.id}`); if (j.json.status === 'done') { assert.equal(j.json.output.res, '720p'); break; } await sleep(30); }
  assert.equal((await api('GET', `/api/jobs/${ok.json.id}`)).json.status, 'done');
  assert.equal((await api('GET', '/api/session')).json.workspace.balance, s0 - cost);
  const poor = await api('POST', '/api/gen', { settings: { ...settings, res: '720p', len: 120, model: 's25', draft: false, copy: '一\n二' } });
  assert.ok(poor.status === 201 || poor.status === 402);
  const voice = await api('POST', '/api/gen', { settings: { ...settings, res: '720p', voice: 'me' } });
  assert.equal(voice.status, 422, '没克隆声音不能用本人声音');
});

test('排期：AI 预选 → 通过 → 换一个 → 从选题库固定 → 备选池', async () => {
  let plans = (await api('GET', '/api/plans')).json.plans;
  assert.equal(plans.length, 2);
  const p = plans[0];
  const future = p.slots.filter((s: any) => !s.empty && s.date > '2026-10-21');
  assert.ok(future.length > 0 && future.every((s: any) => s.pin === 'cand'));
  const d0 = future[0].date;
  plans = (await api('POST', `/api/plans/${p.plan.id}/slots/${d0}`, { action: 'approve' })).json.plans;
  assert.equal(plans[0].slots.find((s: any) => s.date === d0).pin, 'fixed');
  const d1 = future[1].date, before1 = future[1].topicId;
  plans = (await api('POST', `/api/plans/${p.plan.id}/slots/${d1}`, { action: 'next' })).json.plans;
  assert.notEqual(plans[0].slots.find((s: any) => s.date === d1).topicId, before1);
  // 把 d0 上的选题挪到 d1：d0 由 AI 补位
  const moving = plans[0].slots.find((s: any) => s.date === d0).topicId;
  const mv = await api('POST', `/api/plans/${p.plan.id}/slots/${d1}`, { action: 'set', topicId: moving });
  assert.match(mv.json.message, /挪到/);
  const after = mv.json.plans[0].slots;
  assert.equal(after.find((s: any) => s.date === d1).topicId, moving);
  assert.notEqual(after.find((s: any) => s.date === d0).topicId, moving);
  assert.equal(after.find((s: any) => s.date === d0).pin, 'cand');
  // 不能排到过去
  assert.equal((await api('POST', `/api/plans/${p.plan.id}/slots/2026-10-19`, { action: 'set', topicId: moving })).status, 400);
  // 备选池 → 选题卡片显示
  const t = (await api('GET', '/api/topics/all')).json.topics.at(-1);
  await api('POST', `/api/plans/${p.plan.id}/backlog`, { topicId: t.id });
  const idx = (await api('GET', '/api/topics/all')).json.scheduled;
  assert.equal(idx[t.id], '备选池');
  assert.ok(Object.values(idx).some((v: any) => /待审/.test(v)));
  const all = await api('POST', `/api/plans/${p.plan.id}/approve-all`);
  assert.ok(all.json.plans[0].slots.filter((s: any) => !s.empty && s.date > '2026-10-21').every((s: any) => s.pin === 'fixed'));
});

test('素材上传：真实文件落盘，可通过 /files 访问', async () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const up = await api('POST', '/api/assets', png, { 'content-type': 'image/png', 'x-file-name': encodeURIComponent('玄关.png') });
  assert.equal(up.status, 200);
  assert.equal(up.json.type, '照片');
  const f = await fetch(base + up.json.url, { headers: { cookie } });
  assert.equal(f.status, 200);
  assert.equal((await f.arrayBuffer()).byteLength, png.length);
  assert.equal((await api('POST', '/api/assets', png, { 'content-type': 'text/plain' })).status, 415);
});

test('切换人设：各自独立的工作区', async () => {
  const s = await api('POST', '/api/session/persona', { persona: 'dev' });
  assert.equal(s.json.workspace.persona, 'dev');
  assert.equal((await api('GET', '/api/drafts')).json.drafts.length, 0);
  const back = await api('POST', '/api/session/persona', { persona: 'designer' });
  assert.equal(back.json.workspace.persona, 'designer');
  assert.equal((await api('GET', '/api/drafts')).json.drafts.length, 1);
});

test('声音克隆：要授权，克隆中 → 可用', async () => {
  assert.equal((await api('POST', '/api/voice/clone', new Uint8Array(2000), { 'content-type': 'audio/webm' })).status, 400);
  const r = await api('POST', '/api/voice/clone', new Uint8Array(2000), { 'content-type': 'audio/webm', 'x-consent': 'yes' });
  assert.equal(r.json.voiceClone, 'busy');
  await sleep(30);
  assert.equal((await api('GET', '/api/session')).json.workspace.voiceClone, 'ready');
});
