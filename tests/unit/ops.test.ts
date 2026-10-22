// 小规模验证需要的运营能力：邀请制、管理员、点数归账号、每日次数 / 全站预算 / 暂停开关、埋点漏斗、反馈、限流、健康检查。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

process.env.MOCK_DELAY_MS = '0';
process.env.AI_PROVIDER = 'mock';
process.env.TODAY = '2026-10-21';
const { createApp } = await import('../../src/server/app.ts');
type Opts = Parameters<typeof createApp>[0];

const cleanup: (() => void)[] = [];
after(() => cleanup.forEach(f => f()));
async function boot(extra: Partial<Opts>) {
  const dir = mkdtempSync(join(tmpdir(), 'findai-ops-'));
  const app = createApp({ dbFile: ':memory:', dataDir: dir, webDir: dir, ...extra });
  await new Promise<void>(r => app.server.listen(0, r));
  cleanup.push(() => { app.server.close(); rmSync(dir, { recursive: true, force: true }); });
  return { app, base: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}` };
}
function client(base: string) {
  const jar: Record<string, string> = {};
  return async (method: string, path: string, data?: unknown) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') }, body: data === undefined ? undefined : JSON.stringify(data) });
    for (const c of res.headers.getSetCookie()) { const [kv, ...a] = c.split(';'); const [k, v] = kv.split('='); if (a.some(x => /max-age=0/i.test(x.trim()))) delete jar[k]; else jar[k] = v; }
    return { status: res.status, json: await res.json().catch(() => null) };
  };
}
const gen = { copy: '第一行\n第二行', model: 's20f', len: 10, ratio: '9:16', res: '720p', draft: false, voice: 'p1', speed: 1, bgm: '温暖钢琴', subs: true, ambience: true, cover: false };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

test('邀请制：没有邀请码注册不了；管理员邮箱免邀请；邀请码次数用完失效', async () => {
  const { base } = await boot({ authRequired: true, inviteRequired: true, adminEmails: ['boss@x.com'] });
  const cfg = await (await fetch(base + '/api/auth/config')).json();
  assert.deepEqual(cfg, { authRequired: true, inviteRequired: true });
  const u = client(base);
  assert.match((await u('POST', '/api/auth/register', { email: 'a@x.com', password: 'secret123', name: 'A' })).json.error, /邀请码/);
  const boss = client(base);
  assert.equal((await boss('POST', '/api/auth/register', { email: 'boss@x.com', password: 'secret123', name: '老板' })).status, 200);
  assert.equal((await boss('GET', '/api/session')).json.isAdmin, true);
  const inv = await boss('POST', '/api/admin/invites', { count: 2, maxUses: 1, note: '第一批' });
  assert.equal(inv.json.codes.length, 2);
  const code = inv.json.codes[0];
  assert.equal((await u('POST', '/api/auth/register', { email: 'a@x.com', password: 'secret123', name: 'A', invite: code.toLowerCase() })).status, 200, '邀请码不区分大小写');
  const u2 = client(base);
  assert.match((await u2('POST', '/api/auth/register', { email: 'b@x.com', password: 'secret123', name: 'B', invite: code })).json.error, /无效或已用完/);
  assert.equal((await u('GET', '/api/admin/overview')).status, 403, '普通用户进不了后台');
  const list = (await boss('GET', '/api/admin/invites')).json.invites;
  assert.equal(list.find((x: any) => x.code === code).used, 1);
});

test('点数归账号：切换身份不会多出点数；新用户点数可配置；管理员可加点', async () => {
  const { base } = await boot({ initialPoints: 300, adminEmails: ['boss@x.com'] });
  const u = client(base);
  assert.equal((await u('GET', '/api/session')).json.workspace.balance, 300);
  const j = await u('POST', '/api/gen', { settings: gen });
  assert.equal(j.status, 201);
  const after1 = (await u('GET', '/api/session')).json.workspace.balance;
  assert.equal(after1, 300 - j.json.cost);
  assert.equal((await u('POST', '/api/session/persona', { persona: 'dev' })).json.workspace.balance, after1, '换身份点数不变');
  await u('POST', '/api/auth/register', { email: 'u@x.com', password: 'secret123', name: 'U' });
  const boss = client(base);
  await boss('POST', '/api/auth/register', { email: 'boss@x.com', password: 'secret123', name: 'B' });
  const users = (await boss('GET', '/api/admin/users')).json.users;
  const me = users.find((x: any) => x.email === 'u@x.com');
  assert.equal(me.jobs, 1);
  await boss('POST', `/api/admin/users/${me.id}/points`, { delta: 500 });
  assert.equal((await u('GET', '/api/session')).json.workspace.balance, after1 + 500);
});

test('每人每天次数、全站每日预算、暂停开关', async () => {
  const { base } = await boot({ dailyJobsPerUser: 2, adminEmails: ['boss@x.com'] });
  const u = client(base);
  assert.equal((await u('POST', '/api/gen', { settings: gen })).status, 201);
  assert.equal((await u('POST', '/api/gen', { settings: gen })).status, 201);
  const third = await u('POST', '/api/gen', { settings: gen });
  assert.equal(third.status, 429); assert.match(third.json.error, /每天 2 次/);
  assert.equal((await u('GET', '/api/session')).json.limits.jobsToday, 2);

  const b = await boot({ dailyBudget: 20 });
  const v = client(b.base);
  assert.equal((await v('POST', '/api/gen', { settings: gen })).status, 201); // 18 点
  assert.equal((await v('POST', '/api/gen', { settings: gen })).status, 201); // 已花 18 < 20，还能提交
  assert.equal((await v('POST', '/api/gen', { settings: gen })).status, 503);

  const c = await boot({ adminEmails: ['boss@x.com'] });
  const boss = client(c.base), w = client(c.base);
  await boss('POST', '/api/auth/register', { email: 'boss@x.com', password: 'secret123', name: 'B' });
  await boss('PUT', '/api/admin/settings', { genPaused: true });
  const paused = await w('POST', '/api/gen', { settings: gen });
  assert.equal(paused.status, 503); assert.match(paused.json.error, /暂时关闭/);
  assert.equal((await w('GET', '/api/session')).json.limits.genPaused, true);
  await boss('PUT', '/api/admin/settings', { genPaused: false });
  assert.equal((await w('POST', '/api/gen', { settings: gen })).status, 201);
});

test('埋点漏斗与反馈进后台', async () => {
  const { base } = await boot({ adminEmails: ['boss@x.com'] });
  const u = client(base);
  await u('GET', '/api/session');
  await u('POST', '/api/events', { name: 'page_view', props: { view: 'ip' } });
  assert.equal((await u('POST', '/api/events', { name: 'hack' })).status, 400, '只收白名单事件');
  const t = (await u('GET', '/api/topics/all')).json.topics[0];
  const d = (await u('POST', '/api/copy/generate', { topicId: t.id })).json.draft;
  await u('PUT', '/api/drafts', d);
  await u('POST', '/api/gen', { settings: gen });
  await wait(40);
  assert.equal((await u('POST', '/api/feedback', { text: '生成按钮太难找', page: 'gen' })).status, 200);
  const boss = client(base);
  await boss('POST', '/api/auth/register', { email: 'boss@x.com', password: 'secret123', name: 'B' });
  const ov = (await boss('GET', '/api/admin/overview?days=7')).json;
  const f = Object.fromEntries(ov.funnel.map((x: any) => [x.label, x.owners]));
  assert.equal(f['访问'], 1, '管理员只注册没打开页面，不算访问'); assert.equal(f['写文案'], 1); assert.equal(f['存草稿'], 1); assert.equal(f['提交生成'], 1); assert.equal(f['生成成功'], 1); assert.equal(f['排进排期'], 0);
  assert.equal(ov.totals.feedbackNew, 1);
  const fb = (await boss('GET', '/api/admin/feedback')).json.feedback;
  assert.equal(fb[0].text, '生成按钮太难找');
  assert.equal((await boss('POST', `/api/admin/feedback/${fb[0].id}`, { status: 'done' })).json.feedback[0].status, 'done');
});

test('健康检查与写请求限流', async () => {
  const { base } = await boot({ rateLimit: 3 });
  const h = await fetch(base + '/healthz');
  assert.equal(h.status, 200); assert.equal((await h.json()).ok, true);
  const u = client(base);
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await u('POST', '/api/events', { name: 'page_view' })).status);
  assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  assert.equal((await u('GET', '/api/session')).status, 200, '读请求不限');
});
