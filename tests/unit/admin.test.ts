// 后台（dazheip 后台同款）：技能中心（版本、回滚、试运行、导出）、成片价格、上游接口（密钥加密、测试连接、热切换）、
// 积分系统（手动调整、按类型统计）、邀请赠送（分享注册双方得点、同网限次、返点、首充、退款收回、整条收回）、
// 管理权限（角色、操作日志）、出片任务（人工退点只能一次）。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/server/app.ts';
import { openDb } from '../../src/server/db.ts';
import { makeSkills } from '../../src/server/skills/registry.ts';
import { makeGrowth, rulesText, type ReferralCfg } from '../../src/server/growth.ts';
import { secretBox, mask } from '../../src/server/upstreams.ts';
import { renderTemplate } from '../../src/shared/skills.ts';
process.env.MOCK_DELAY_MS = '0';

/* ---------- 假的大模型（OpenAI 兼容）：连接测试回 ok，出片建议回 tour ---------- */
const llmCalls: string[] = [];
const fakeLlm: Server = createServer((req, res) => {
  let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
    if (req.url?.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'fake-2' }, { id: 'fake-1' }] })); return; }
    const j = JSON.parse(b || '{}'), sys = String(j.messages?.[0]?.content ?? ''), user = String(j.messages?.[1]?.content ?? '');
    llmCalls.push(user);
    if (req.headers.authorization !== 'Bearer sk-test-123456') { res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'bad key' } })); return; }
    const content = /连接测试/.test(sys) ? '{"ok":true}' : /可选类型|类型/.test(user) ? '{"type":"tour","why":"假模型：照片多，做漫游"}' : '{"title":"假标题","lines":["一","二"]}';
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
});

const dir = mkdtempSync(join(tmpdir(), 'findai-admin-'));
const app = createApp({ dbFile: ':memory:', dataDir: dir, webDir: dir, modulesPreset: 'all', initialPoints: 100, adminEmails: ['boss@x.com'], env: { PAY_MOCK: '1', SECRETS_KEY: 'test-secret-key-0123456789' } });
let base = '', llmBase = '';
before(async () => {
  await new Promise<void>(r => app.server.listen(0, r)); base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  await new Promise<void>(r => fakeLlm.listen(0, r)); llmBase = `http://127.0.0.1:${(fakeLlm.address() as AddressInfo).port}/v1`;
});
after(() => { app.server.close(); fakeLlm.close(); rmSync(dir, { recursive: true, force: true }); });
function client() {
  let cookie = '';
  return async (method: string, path: string, data?: unknown) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: data === undefined ? undefined : JSON.stringify(data) });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* 不是 JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  };
}
const reg = async (c: ReturnType<typeof client>, email: string, ref?: string) => {
  await c('GET', '/api/session');
  const r = await c('POST', '/api/auth/register', { email, password: 'pass1234', name: email.split('@')[0], ...(ref ? { ref } : {}) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
};
const balance = async (c: ReturnType<typeof client>) => (await c('GET', '/api/billing')).json.balance as number;
const boss = client();

test('技能包：仓库里的 bundle 是最新的（改了 skills/ 要跑 npm run skills）', () => {
  const r = spawnSync(process.execPath, ['scripts/build-skills.mjs', '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('权限：超级管理员看得到全部菜单；普通用户进不了后台', async () => {
  await reg(boss, 'boss@x.com');
  const me = await boss('GET', '/api/admin/me');
  assert.equal(me.json.me.role, 'super');
  assert.ok(me.json.me.perms.includes('skills') && me.json.me.perms.includes('admins'));
  assert.equal(me.json.dazheip.menu.length, 10, 'dazheip 原有的 10 个菜单带着外链');
  assert.match(me.json.dazheip.menu[0].url, /^https:\/\/www\.dazheip\.com\/admin\//);
  assert.equal((await boss('GET', '/api/session')).json.admin.role, 'super');
  const u = client(); await reg(u, 'plain@x.com');
  assert.equal((await u('GET', '/api/admin/me')).status, 403);
  assert.equal((await u('GET', '/api/admin/skills')).status, 403);
  assert.equal((await u('GET', '/api/session')).json.admin, null);
  const dash = await boss('GET', '/api/admin/dashboard');
  assert.equal(dash.status, 200);
  assert.ok(dash.json.tiles.users >= 2);
  assert.equal(dash.json.trend.length, 14);
  assert.equal(dash.json.tiles.skills, 18);
});

test('技能中心：改参数存成新版本马上生效；格式不对拒绝；能回滚、恢复默认；试运行和导出', async () => {
  const list = await boss('GET', '/api/admin/skills');
  assert.equal(list.json.skills.length, 18);
  assert.ok(list.json.skills.every((s: any) => s.name && s.category && typeof s.order === 'number'));
  const pk = (await boss('GET', '/api/admin/skills/publish-pack')).json.skill;
  assert.equal(pk.activeVersion, 0); assert.equal(pk.data.config.tagMax, 5);
  assert.ok(pk.doc.length > 50, '带维护说明');

  const bad = await boss('PUT', '/api/admin/skills/publish-pack', { data: { ...pk.data, config: { ...pk.data.config, tagMin: 9, tagMax: 3 } } });
  assert.equal(bad.status, 400); assert.match(bad.json.error, /话题最少数不能大于最多数/);
  const badPrompt = await boss('PUT', '/api/admin/skills/publish-pack', { data: { ...pk.data, prompts: { ...pk.data.prompts, nope: 'x' } } });
  assert.equal(badPrompt.status, 400);

  const ok = await boss('PUT', '/api/admin/skills/publish-pack', { data: { ...pk.data, config: { ...pk.data.config, banned: [...pk.data.config.banned, '必火'] } }, note: '加禁词' });
  assert.equal(ok.status, 200); assert.equal(ok.json.version, 1);
  assert.ok((await boss('GET', '/api/catalog')).json.pack.banned.includes('必火'), '前台目录马上带上');
  const packed = await boss('POST', '/api/studio/pack', { type: 'tour', lines: ['这套房必火', '客厅很大'] });
  assert.ok(packed.json.banned.includes('必火'));

  assert.equal((await boss('POST', '/api/admin/skills/publish-pack/activate', { version: 0 })).status, 200);
  assert.ok(!(await boss('GET', '/api/catalog')).json.pack.banned.includes('必火'), '恢复默认');
  await boss('POST', '/api/admin/skills/publish-pack/activate', { version: 1 });
  assert.ok((await boss('GET', '/api/catalog')).json.pack.banned.includes('必火'), '切回第 1 版');
  assert.equal((await boss('POST', '/api/admin/skills/publish-pack/activate', { version: 9 })).status, 400);
  const v1 = await boss('GET', '/api/admin/skills/publish-pack/versions/1');
  assert.ok(v1.json.data.config.banned.includes('必火'));

  const off = await boss('POST', '/api/admin/skills/storyboard/enabled', { enabled: false });
  assert.equal(off.json.skill.data.enabled, false);
  const copy = '先看这个客厅的整面岩板墙\n再看开放式厨房的动线设计\n最后看主卧床头那面洞石墙';
  const run = await boss('POST', '/api/admin/skills/storyboard/test', { input: { copy, type: 'tour' }, force: 'rule' });
  assert.equal(run.json.path, 'rule'); assert.equal(run.json.out.shots.length, 3);
  assert.ok(run.json.prompt.user.includes('洞石'), '试运行能看到拼好的提示词');
  const draft = { ...(await boss('GET', '/api/admin/skills/storyboard')).json.skill.data };
  draft.config = { ...draft.config, minShots: 1, maxShots: 2 };
  const run2 = await boss('POST', '/api/admin/skills/storyboard/test', { input: { copy, type: 'tour' }, data: draft, force: 'rule' });
  assert.equal(run2.json.out.shots.length, 2, '试运行用没保存的草稿');
  assert.equal((await boss('GET', '/api/admin/skills/storyboard')).json.skill.data.config.maxShots, 8, '草稿没存');
  const prev = await boss('POST', '/api/admin/skills/referral/test', {});
  assert.ok(Array.isArray(prev.json.out['规则文案']));

  const exp = await boss('GET', '/api/admin/skills/points/export');
  assert.match(exp.headers.get('content-disposition') ?? '', /attachment; filename="points-v\d+\.json"/);
  assert.equal(JSON.parse(exp.text).id, 'points');
  assert.equal((await boss('PUT', '/api/admin/skills/up-llm', { data: { enabled: true, prompts: {}, config: { enabled: true } } })).status, 400, '上游接口不在技能页改');
});

test('成片价格：后台改价、停用一类，前台目录跟着变；不能全停', async () => {
  const r = await boss('PUT', '/api/admin/points/types', { types: [{ id: 'tour', pts: 120, secs: 45, enabled: true }, { id: 'vlog', pts: 70, secs: 45, enabled: false }] });
  assert.equal(r.status, 200);
  const cat = (await boss('GET', '/api/catalog')).json;
  assert.equal(cat.types.find((t: any) => t.id === 'tour').pts, 120);
  assert.equal(cat.types.find((t: any) => t.id === 'vlog').enabled, false);
  const all = cat.types.map((t: any) => ({ id: t.id, pts: t.pts, secs: t.secs, enabled: false }));
  assert.equal((await boss('PUT', '/api/admin/points/types', { types: all })).status, 400);
  const pts = await boss('GET', '/api/admin/points');
  assert.equal(pts.json.types.find((t: any) => t.id === 'tour').sample, 50, '样片价 = 成片 × 0.4 取整到 5');
});

test('上游接口：密钥加密存、打码显示；测试连接；保存后马上切到真实模型；停用退回模拟；日志不记密钥', async () => {
  const st0 = await boss('GET', '/api/admin/upstreams');
  assert.equal(st0.json.ai.copy, 'mock');
  assert.equal(st0.json.upstreams.length, 7);
  const values = { baseUrl: llmBase, apiKey: 'sk-test-123456', model: 'fake-1' };
  const t1 = await boss('POST', '/api/admin/upstreams/up-llm/test', { values });
  assert.equal(t1.json.ok, true, t1.json.message);
  const t2 = await boss('POST', '/api/admin/upstreams/up-llm/test', { values: { ...values, apiKey: 'sk-wrong-000000' } });
  assert.equal(t2.json.ok, false);
  assert.equal((await boss('PUT', '/api/admin/upstreams/up-llm', { values: { baseUrl: 'ftp://x' } })).status, 400);

  const saved = await boss('PUT', '/api/admin/upstreams/up-llm', { values });
  assert.equal(saved.json.ai.copy, 'llm', '不用重启就换成真实模型');
  const up = saved.json.upstreams.find((u: any) => u.id === 'up-llm');
  assert.equal(up.status.configured, true);
  assert.equal(up.status.values.apiKey.value, mask('sk-test-123456'));
  assert.equal(up.status.values.apiKey.source, 'admin');
  const row = app.db.prepare("SELECT v FROM settings WHERE k='upstream:up-llm'").get() as { v: string };
  assert.ok(!row.v.includes('sk-test-123456'), '数据库里不是明文'); assert.match(row.v, /"v1:/);
  // 密钥不传 = 不改
  await boss('PUT', '/api/admin/upstreams/up-llm', { values: { apiKey: '', fineModel: 'fake-2' } });
  assert.equal((await boss('POST', '/api/admin/upstreams/up-llm/test', {})).json.ok, true, '还是原来的密钥');
  assert.deepEqual((await boss('POST', '/api/admin/upstreams/up-llm/models', {})).json.models, ['fake-1', 'fake-2']);

  const adv = await boss('POST', '/api/studio/advise', { mats: [{ kind: 'photo', name: '客厅' }, { kind: 'photo', name: '卧室' }, { kind: 'photo', name: '厨房' }], copy: '', pick: 'auto' });
  assert.equal(adv.json.path, 'llm'); assert.equal(adv.json.advice.type, 'tour'); assert.match(adv.json.advice.why, /假模型/);
  const upList = (await boss('GET', '/api/admin/upstreams')).json.upstreams;
  assert.ok(upList.find((u: any) => u.id === 'up-llm').stats.calls >= 1, '调用记到上游接口上');

  const offr = await boss('PUT', '/api/admin/upstreams/up-llm', { enabled: false });
  assert.equal(offr.json.ai.copy, 'mock', '停用后退回模拟');
  const adv2 = await boss('POST', '/api/studio/advise', { mats: [{ kind: 'photo', name: '客厅' }], copy: '', pick: 'auto' });
  assert.equal(adv2.json.path, 'rule');
  await boss('PUT', '/api/admin/upstreams/up-llm', { enabled: true });
  assert.equal((await boss('PUT', '/api/admin/upstreams/video-provider', { provider: 'mock' })).json.videoProvider, 'mock');

  const audit = (await boss('GET', '/api/admin/audit')).json.items;
  const logs = audit.filter((x: any) => x.action === '修改上游接口');
  assert.ok(logs.length >= 3);
  assert.ok(logs.every((x: any) => !String(x.detail).includes('sk-test')), '日志里没有密钥');
});

test('邀请赠送：分享链接注册双方得点；同一网络限次；好友充值返点、首充奖励；退款收回；后台整条收回', async () => {
  const cur = (await boss('GET', '/api/admin/referral')).json.config as ReferralCfg;
  const set = await boss('PUT', '/api/admin/referral', { config: { invite: { ...cur.invite, ipDailyLimit: 2 }, firstRecharge: { fixed: 50, rate: 0 } }, note: '测试' });
  assert.equal(set.status, 200); assert.ok(set.json.rules.length >= 3);

  const inv = client(); await reg(inv, 'inviter@x.com');
  const mine = (await inv('GET', '/api/referral')).json;
  assert.match(mine.code, /^[A-Z0-9]{6,}$/); assert.equal(mine.invited, 0);
  assert.equal((await inv('POST', '/api/referral/click', { code: mine.code })).json.ok, true);
  assert.equal((await inv('POST', '/api/referral/click', { code: 'NOPE00' })).json.ok, false);
  const pv = (await inv('GET', `/api/referral/preview?code=${mine.code}`)).json.preview;
  assert.equal(pv.name, 'inviter'); assert.equal(pv.bonus, 100);
  const inv0 = await balance(inv);

  const f1 = client(), r1 = await reg(f1, 'f1@x.com', mine.code);
  assert.equal(r1.gift, 100); assert.match(r1.message, /送你 100 点/);
  assert.equal(await balance(f1), 200, '试用 100 + 受邀 100');
  assert.equal(await balance(inv), inv0 + 100);
  const f2 = client(); assert.equal((await reg(f2, 'f2@x.com', mine.code)).gift, 100);
  const f3 = client(); assert.equal((await reg(f3, 'f3@x.com', mine.code)).gift, 0, '同一网络 24 小时第 3 个不发');
  assert.equal(await balance(inv), inv0 + 200);
  const m2 = (await inv('GET', '/api/referral')).json;
  assert.equal(m2.invited, 3); assert.equal(m2.rewarded, 2); assert.equal(m2.earned, 200); assert.equal(m2.clicks, 1);
  assert.ok(m2.records.some((r: any) => r.status === 'blocked'));
  assert.ok(m2.records.every((r: any) => !/f1@x\.com/.test(r.email)), '邮箱打码');

  // 好友充值：好友首充 +50，邀请人返 10%
  const od = (await f1('POST', '/api/billing/orders', { product: 'points', packageId: 'p99', channel: 'mock' })).json.order;
  await f1('POST', `/api/billing/orders/${od.id}/mock-pay`);
  assert.equal(await balance(f1), 200 + 1100 + 50);
  assert.equal(await balance(inv), inv0 + 200 + 110);
  await f1('POST', `/api/billing/orders/${od.id}/mock-pay`);
  assert.equal(await balance(inv), inv0 + 200 + 110, '重复回调不重复返');
  const kinds = (await inv('GET', '/api/ledger')).json.items.map((x: any) => x.kind);
  assert.ok(kinds.includes('gift_invite') && kinds.includes('gift_rebate'));

  // 退款：点数扣回，首充和返点一起收回
  const rf = await boss('POST', `/api/admin/billing/orders/${od.id}/refund`);
  assert.equal(rf.status, 200); assert.match(rf.json.note, /2 笔奖励/);
  assert.equal(await balance(f1), 200);
  assert.equal(await balance(inv), inv0 + 200);

  // 后台收回 f2 那条邀请
  const adm = (await boss('GET', '/api/admin/referral')).json;
  assert.equal(adm.stats.registrations, 3);
  const row2 = adm.list.find((x: any) => x.invitee === 'f2@x.com');
  assert.equal((await boss('POST', `/api/admin/referral/${row2.id}/revoke`, { note: 'x' })).status, 400, '要写原因');
  const back = await boss('POST', `/api/admin/referral/${row2.id}/revoke`, { note: '刷号' });
  assert.equal(back.json.back, 200);
  assert.equal(await balance(inv), inv0 + 100); assert.equal(await balance(f2), 100);
  assert.equal((await boss('GET', '/api/admin/referral?status=revoked')).json.list.length, 1);
  // 分享奖励默认 0 = 不发
  assert.equal((await inv('POST', '/api/referral/share')).json.points, 0);
});

test('积分系统：手动调整要写原因、扣不成负数；按类型统计；流水能搜', async () => {
  assert.equal((await boss('POST', '/api/admin/points/adjust', { email: 'f2@x.com', delta: 300, reason: '' })).status, 400);
  assert.equal((await boss('POST', '/api/admin/points/adjust', { email: 'nobody@x.com', delta: 300, reason: '补偿' })).status, 404);
  const a = await boss('POST', '/api/admin/points/adjust', { email: 'f2@x.com', delta: 300, reason: '活动补偿' });
  assert.equal(a.json.delta, 300); assert.equal(a.json.balance, 400);
  const b = await boss('POST', '/api/admin/points/adjust', { email: 'f2@x.com', delta: -100000, reason: '清零' });
  assert.equal(b.json.delta, -400); assert.equal(b.json.balance, 0);
  const p = (await boss('GET', '/api/admin/points?q=f2@x.com')).json;
  assert.ok(p.byKind.some((k: any) => k.kind === 'admin' && k.name));
  assert.ok(p.byKind.some((k: any) => k.kind === 'gift_invited'));
  assert.ok(p.ledger.length >= 3 && p.ledger.every((x: any) => x.email === 'f2@x.com'));
  assert.ok((await boss('GET', '/api/admin/points?kind=revoke')).json.ledger.every((x: any) => x.kind === 'revoke'));
  const cfg = p.config;
  const s = await boss('PUT', '/api/admin/points', { config: { signupBonus: 30, packages: cfg.packages.slice(0, 2) } });
  assert.equal(s.json.config.signupBonus, 30);
  assert.equal((await boss('GET', '/api/billing')).json.packages.length, 2, '充值页套餐跟着变');
  const g = client(); assert.equal((await reg(g, 'g@x.com')).gift, 30, '注册赠送');
  assert.equal((await boss('PUT', '/api/admin/points', { config: { sampleRate: 5 } })).status, 400);
});

test('管理权限：客服看得到订单和任务，改不了技能、退不了款；删掉就进不了；操作日志都记着', async () => {
  assert.equal((await boss('POST', '/api/admin/admins', { email: 'boss@x.com', role: 'cs' })).status, 400, '超级管理员不用加');
  assert.equal((await boss('POST', '/api/admin/admins', { email: 'cs@x.com', role: 'cs', note: '小王' })).status, 200);
  const cs = client(); await reg(cs, 'cs@x.com');
  const me = (await cs('GET', '/api/admin/me')).json.me;
  assert.equal(me.role, 'cs'); assert.equal(me.roleName, '客服');
  assert.equal((await cs('GET', '/api/admin/skills')).status, 403);
  assert.equal((await cs('GET', '/api/admin/upstreams')).status, 403);
  assert.equal((await cs('GET', '/api/admin/jobs')).status, 200);
  const orders = (await cs('GET', '/api/admin/billing')).json.orders;
  assert.ok(orders.length >= 1);
  const deny = await cs('POST', `/api/admin/billing/orders/${orders[0].id}/refund`);
  assert.equal(deny.status, 403); assert.match(deny.json.error, /客服/);
  const list = (await boss('GET', '/api/admin/admins')).json;
  assert.deepEqual(list.supers, ['boss@x.com']); assert.equal(list.admins[0].email, 'cs@x.com');
  assert.equal((await boss('DELETE', '/api/admin/admins/boss@x.com')).status, 400, '不能删自己');
  await boss('DELETE', '/api/admin/admins/cs@x.com');
  assert.equal((await cs('GET', '/api/admin/me')).status, 403);
  const acts = (await boss('GET', '/api/admin/audit')).json.items.map((x: any) => x.action);
  for (const a of ['保存技能', '技能恢复默认', '修改成片价格', '修改上游接口', '修改邀请赠送规则', '订单退款', '收回邀请奖励', '调整积分', '修改积分规则', '设置后台账号', '删除后台账号']) assert.ok(acts.includes(a), `日志里有「${a}」`);
  assert.ok((await boss('GET', '/api/admin/audit?q=后台账号')).json.items.every((x: any) => /后台账号/.test(x.action)));
});

test('出片任务：全站任务能看、能搜；人工退点只能退一次，失败的任务不让退', async () => {
  const u = client(); await reg(u, 'maker@x.com');
  const ws = (await u('GET', '/api/session')).json.workspace.id as string;
  const j = app.repo.insertJob(ws, { kind: 'video', steps: ['a'], cost: 30, title: '测试成片', input: { studio: 'tour', type: 'tour', model: 'seedance-2.5', draft: true, len: 20 } as any });
  app.repo.updateJob(j.id, { status: 'done' });
  const f = app.repo.insertJob(ws, { kind: 'video', steps: ['a'], cost: 30, title: '失败的', input: { type: 'talk' } as any });
  app.repo.updateJob(f.id, { status: 'failed', error: '超时' });
  const jobs = (await boss('GET', '/api/admin/jobs?q=maker')).json;
  assert.equal(jobs.jobs.length, 2);
  const row = jobs.jobs.find((x: any) => x.id === j.id);
  assert.equal(row.type, '空间漫游'); assert.equal(row.email, 'maker@x.com'); assert.equal(row.draft, true);
  assert.equal(jobs.jobs.find((x: any) => x.id === f.id).type, '真人口播');
  const before0 = await balance(u);
  assert.equal((await boss('POST', `/api/admin/jobs/${j.id}/refund`, { reason: '画面糊了' })).json.points, 30);
  assert.equal(await balance(u), before0 + 30);
  assert.equal((await boss('POST', `/api/admin/jobs/${j.id}/refund`, { reason: '画面糊了' })).status, 400);
  assert.equal((await boss('POST', `/api/admin/jobs/${f.id}/refund`, { reason: '再退' })).status, 400);
  assert.equal((await boss('GET', '/api/admin/jobs')).json.jobs.find((x: any) => x.id === j.id).manualRefund, true);
  const dash = (await boss('GET', '/api/admin/dashboard')).json;
  assert.ok(dash.coverage.some((c: any) => c.name === '空间漫游' && c.n >= 1), '成片类型覆盖');
});

/* ---------- 不经过接口，直接测发奖规则 ---------- */
test('邀请规则：等好友出片 / 充值才发；每天上限；注册和分享奖励只发一次', () => {
  const db = openDb(':memory:'), skills = makeSkills(db), g = makeGrowth(db, skills);
  const mk = (n: string) => {
    db.prepare('INSERT INTO owners (id, created_at, balance) VALUES (?,?,0)').run(`o_${n}`, new Date().toISOString());
    db.prepare('INSERT INTO users (id, email, name, pass_hash, owner_id, created_at) VALUES (?,?,?,?,?,?)').run(`u_${n}`, `${n}@x.com`, n, 'x', `o_${n}`, new Date().toISOString());
    return { userId: `u_${n}`, ownerId: `o_${n}` };
  };
  const bal = (o: string) => (db.prepare('SELECT balance FROM owners WHERE id=?').get(o) as { balance: number }).balance;
  const ref = skills.data('referral');
  const cfg = ref.config as unknown as ReferralCfg;
  skills.save('referral', { ...ref, config: { ...cfg, invite: { ...cfg.invite, rewardOn: 'first_gen', dailyCap: 1 }, shareDaily: 5 } as any }, 't', 't');
  const pts = skills.data('points');
  skills.save('points', { ...pts, config: { ...pts.config, signupBonus: 20 } }, 't', 't');

  const a = mk('a'), code = g.codeOf(a.userId);
  assert.equal(g.codeOf(a.userId), code, '邀请码固定');
  const b = mk('b');
  const r1 = g.onRegister({ ...b, ip: '1.1.1.1', code });
  assert.equal(r1.referral, 'pending'); assert.equal(r1.signup, 20);
  assert.equal(g.onRegister({ ...b, ip: '1.1.1.1', code }).signup, 0, '注册奖励只发一次');
  assert.equal(bal(a.ownerId), 0, '好友还没出片，不发');
  g.onFirstGen(b.ownerId);
  assert.equal(bal(a.ownerId), 100); assert.equal(bal(b.ownerId), 120);
  g.onFirstGen(b.ownerId);
  assert.equal(bal(a.ownerId), 100, '只发一次');
  const c = mk('c');
  assert.equal(g.onRegister({ ...c, ip: '2.2.2.2', code }).referral, 'pending');
  g.onFirstGen(c.ownerId);
  assert.equal(bal(a.ownerId), 100, '超过每天上限，邀请人不发'); assert.equal(bal(c.ownerId), 120, '好友照样拿');
  const self = g.onRegister({ ...a, ip: null, code });
  assert.equal(self.referral, null, '不能邀请自己');
  assert.equal(g.onShare(a.ownerId), 5); assert.equal(g.onShare(a.ownerId), 0, '每天一次');
  assert.equal(g.grant(c.ownerId, -1000, 'admin', 'x'), -120, '扣到 0 为止');

  skills.save('referral', { ...ref, config: { ...cfg, invite: { ...cfg.invite, rewardOn: 'first_pay', dailyCap: 0 } } as any }, 't', 't');
  const d = mk('d');
  assert.equal(g.onRegister({ ...d, ip: '3.3.3.3', code }).referral, 'pending');
  db.prepare(`INSERT INTO orders (id, owner_id, ws, product, title, amount, points, channel, status, created_at) VALUES ('od1', ?, 'w', 'points', 't', 9900, 1100, 'mock', 'paid', ?)`).run(d.ownerId, new Date().toISOString());
  const before0 = bal(a.ownerId);
  const paid = g.onPaid({ id: 'od1', ownerId: d.ownerId, product: 'points', points: 1100 });
  assert.equal(paid.rebate, 110);
  assert.equal(bal(a.ownerId), before0 + 100 + 110, '首充后发邀请奖励 + 返点');
  assert.equal(g.onPaid({ id: 'od1', ownerId: d.ownerId, product: 'points', points: 1100 }).rebate, 0, '同一单不重复返');
  const rules = rulesText(skills.config<ReferralCfg>('referral'));
  assert.ok(rules.every(r => !/\{\w+\}/.test(r)), '规则文案里的变量都换掉了');
});

test('密钥加密：换了 SECRETS_KEY 解不开；打码不露全文；模板变量缺了会报出来', () => {
  const a = secretBox('k1'), b = secretBox('k2');
  const s = a.seal('sk-abcdef123456');
  assert.match(s, /^v1:/); assert.equal(a.open(s), 'sk-abcdef123456'); assert.equal(b.open(s), null);
  assert.equal(mask('sk-abcdef123456'), 'sk-••••3456');
  assert.match(mask('-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----'), /PEM，3 行/);
  const t = renderTemplate('你好 {{name}}，今天 {{day}}', { name: '苗苗' });
  assert.equal(t.text, '你好 苗苗，今天 '); assert.deepEqual(t.missing, ['day']);
});

test('后台登录：后台不在前台显示，/api/auth/admin-login 只放后台账号进来；普通账号不给会话', async () => {
  const u = client(); await reg(u, 'normal@x.com');
  const out = client();
  const bad = await out('POST', '/api/auth/admin-login', { email: 'normal@x.com', password: 'pass1234' });
  assert.equal(bad.status, 403); assert.match(bad.json.error, /没有后台权限/);
  assert.equal((await out('GET', '/api/admin/me')).status, 403, '没拿到后台会话');
  assert.equal((await out('POST', '/api/auth/admin-login', { email: 'boss@x.com', password: 'wrong-pass' })).status, 401);
  const ok = await out('POST', '/api/auth/admin-login', { email: 'boss@x.com', password: 'pass1234' });
  assert.equal(ok.status, 200); assert.equal(ok.json.me.role, 'super');
  assert.equal((await out('GET', '/api/admin/me')).json.me.email, 'boss@x.com');
  assert.equal((await out('GET', '/api/auth/config')).json.demoLogin, undefined, '正式环境不提示演示账号');
});
