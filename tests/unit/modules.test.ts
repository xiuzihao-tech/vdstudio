// 模块开关、专家版、内测名单、面诊传资料、知识库导入、保存期限和容量。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { MODULES, closedParents, defaultConfig, moduleForApi, normalizeConfig, presetStates, viewFor } from '../../src/shared/modules.ts';

process.env.MOCK_DELAY_MS = '0';
process.env.AI_PROVIDER = 'mock';
const { createApp } = await import('../../src/server/app.ts');

test('模块清单：50 个，一期 28 / 二期 15 / 三期 7，先做 6 个，依赖都存在', () => {
  assert.equal(MODULES.length, 50);
  assert.deepEqual([1, 2, 3].map(p => MODULES.filter(m => m.phase === p).length), [28, 15, 7]);
  assert.equal(MODULES.filter(m => m.first).length, 6);
  const ids = new Set(MODULES.map(m => m.id));
  assert.equal(ids.size, 50);
  for (const m of MODULES) if (m.parent) assert.ok(ids.has(m.parent), `${m.id} 的父模块 ${m.parent} 不存在`);
});

test('算状态：一期隐藏二三期；父模块关了或是预告，子模块看不到；内测只给名单里的人', () => {
  const c = defaultConfig('phase1');
  const v = viewFor(c, null);
  assert.equal(v.real, 'on'); assert.equal(v.cover, 'off'); assert.equal(v.voiceClone, 'off'); assert.equal(v.avatarShot, 'off');
  const c2 = { ...c, states: { ...c.states, diag: 'off' as const } };
  assert.equal(viewFor(c2, null).diagLinks, 'off', '父模块关了');
  assert.equal(viewFor(c2, null).plan, 'off', '依赖链一路关掉');
  const c3 = { ...c, states: { ...c.states, shotEdit: 'soon' as const, extend: 'on' as const } };
  assert.equal(viewFor(c3, null).shotEdit, 'soon'); assert.equal(viewFor(c3, null).extend, 'off');
  const c4 = { ...c, states: { ...c.states, kbImport: 'beta' as const }, beta: ['vip@x.com'] };
  assert.equal(viewFor(c4, null).kbImport, 'off'); assert.equal(viewFor(c4, 'VIP@x.com').kbImport, 'on');
  assert.deepEqual(closedParents({ ...c, states: presetStates('phase1') }, 'xhsCollect'), [], 'kbImport 一期是开着的');
  assert.deepEqual(closedParents({ ...c, states: { ...presetStates('phase1'), kb: 'off' } }, 'xhsCollect'), ['kb']);
});

test('配置：未知模块丢掉，缺的按套用补；接口归属', () => {
  const c = normalizeConfig({ preset: 'phase2', states: { nope: 'on', real: 'off' }, pro: ['diag', 'nope'], price: 99 }, 'all', 300);
  assert.equal(c.states.real, 'off'); assert.equal(c.states.voiceClone, 'on'); assert.equal(c.states.avatars, 'off');
  assert.ok(!('nope' in c.states)); assert.deepEqual(c.pro, ['diag']); assert.equal(c.price, 99);
  assert.equal(moduleForApi('PUT', '/api/diagnosis/report'), 'report');
  assert.equal(moduleForApi('POST', '/api/diagnosis/report'), 'diag');
  assert.equal(moduleForApi('POST', '/api/kb/import'), 'kbImport');
  assert.equal(moduleForApi('GET', '/api/kb'), 'kb');
  assert.equal(moduleForApi('GET', '/api/session'), null);
});

/* ---------- 接口 ---------- */
const dir = mkdtempSync(join(tmpdir(), 'findai-mod-'));
const app = createApp({ dbFile: ':memory:', dataDir: dir, webDir: dir, modulesPreset: 'phase1', adminEmails: ['boss@x.com'] });
let base = '';
before(async () => { await new Promise<void>(r => app.server.listen(0, r)); base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`; });
after(() => { app.server.close(); rmSync(dir, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  return async (method: string, path: string, data?: unknown, headers: Record<string, string> = {}) => {
    const raw = data instanceof Uint8Array;
    const res = await fetch(base + path, { method, headers: { ...(raw ? {} : { 'content-type': 'application/json' }), cookie, ...headers }, body: data === undefined ? undefined : raw ? (data as unknown as BodyInit) : JSON.stringify(data) });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: res.status, json: await res.json() as any };
  };
}
const stu = client(), boss = client(), vip = client();

test('只开一期：二三期的接口被拒，一期的照常', async () => {
  const s = await stu('GET', '/api/session');
  assert.equal(s.json.modules.today, 'on'); assert.equal(s.json.modules.voiceClone, 'off');
  assert.equal((await stu('POST', '/api/voice/clone', {})).status, 403);
  assert.equal((await stu('GET', '/api/covers')).status, 403);
  assert.match((await stu('GET', '/api/covers')).json.error, /还没开放/);
  assert.equal((await stu('GET', '/api/kb')).status, 200);
  assert.equal((await stu('GET', '/api/plans')).status, 200);
});

test('后台：改状态立刻生效；管理员不受开关限制；内测名单', async () => {
  assert.equal((await stu('GET', '/api/admin/modules')).status, 403);
  await boss('POST', '/api/auth/register', { email: 'boss@x.com', password: 'secret123', name: '老板' });
  const m = await boss('GET', '/api/admin/modules');
  assert.equal(m.status, 200); assert.equal(m.json.modules.length, 50); assert.equal(m.json.config.preset, 'phase1');
  assert.equal((await boss('GET', '/api/covers')).status, 200, '管理员能预览隐藏的模块');
  // 打开子模块，带上父模块
  const r = await boss('PUT', '/api/admin/modules', { states: { extend: 'soon' } });
  assert.equal(r.json.config.states.extend, 'soon');
  await boss('PUT', '/api/admin/modules', { states: { voiceClone: 'on', kbImport: 'beta' }, beta: ['vip@x.com'] });
  assert.equal((await stu('GET', '/api/session')).json.modules.voiceClone, 'on');
  assert.equal((await stu('GET', '/api/session')).json.modules.kbImport, 'off');
  assert.equal((await stu('POST', '/api/kb/import', { url: 'https://example.com/a' })).status, 403);
  await vip('POST', '/api/auth/register', { email: 'vip@x.com', password: 'secret123', name: '内测' });
  assert.equal((await vip('GET', '/api/session')).json.modules.kbImport, 'on');
  assert.equal((await vip('POST', '/api/kb/import', { url: 'https://example.com/a' })).status, 200);
  // 套用「全部打开」
  await boss('PUT', '/api/admin/modules', { preset: 'all' });
  assert.equal((await stu('GET', '/api/session')).json.modules.avatars, 'on');
  await boss('PUT', '/api/admin/modules', { preset: 'phase1' });
  // 打开记次数
  await stu('POST', '/api/events', { name: 'module_open', props: { id: 'real' } });
  assert.equal((await boss('GET', '/api/admin/modules')).json.usage.real.opens, 1);
});

test('专家版和价格：后台改价格；面诊不标专家版就不用解锁', async () => {
  await boss('PUT', '/api/admin/modules', { price: 50 });
  assert.equal((await stu('GET', '/api/diagnosis')).json.price, 50);
  const before = (await stu('GET', '/api/session')).json.workspace.balance;
  await stu('POST', '/api/diagnosis/unlock');
  assert.equal((await stu('GET', '/api/session')).json.workspace.balance, before - 50);
  const c = (await boss('GET', '/api/admin/modules')).json.config;
  await boss('PUT', '/api/admin/modules', { pro: c.pro.filter((x: string) => x !== 'diag') });
  assert.equal((await vip('GET', '/api/diagnosis')).json.diagnosis.unlocked, true, '不是专家版：不用解锁');
  assert.equal((await vip('PUT', '/api/diagnosis/answer', { qid: 'p1', text: '原来在装修公司做设计，2018 年出来单干' })).status, 200);
  await boss('PUT', '/api/admin/modules', { pro: c.pro });
});

test('面诊传资料：链接和截图进知识库；出报告会带上；知识库改了提示可重新提取', async () => {
  const a = await stu('POST', '/api/diagnosis/attach', { url: 'https://v.douyin.com/abc123/' });
  assert.equal(a.status, 200);
  assert.equal(a.json.items[0].media, 'link'); assert.match(a.json.items[0].text, /抖音/);
  assert.equal((await stu('POST', '/api/diagnosis/attach', { url: 'javascript:alert(1)' })).status, 400);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  const f = await stu('POST', '/api/diagnosis/attach', png, { 'content-type': 'image/png', 'x-file-name': encodeURIComponent('主页截图.png') });
  assert.equal(f.status, 200); assert.equal(f.json.items.length, 2);
  assert.ok(f.json.items.some((i: any) => i.media === 'file' && i.url.startsWith('/files/')));
  for (const [q, t] of [['p1', '原来在装修公司做设计，后来自己出来做'], ['r1', '做了十二年，三百多个项目'], ['b1', '主做意式极简，木作定制']]) await stu('PUT', '/api/diagnosis/answer', { qid: q, text: t });
  const r = await stu('POST', '/api/diagnosis/report');
  assert.equal(r.status, 200);
  assert.ok(!r.json.diagnosis.kbChangedAt || r.json.diagnosis.kbChangedAt <= r.json.diagnosis.report.createdAt, '刚出报告不算过期');
  await new Promise(x => setTimeout(x, 5));
  const kb = (await stu('GET', '/api/kb')).json.items;
  await stu('PUT', `/api/kb/${kb[0].id}`, { text: kb[0].text + '（改过）' });
  const d = (await stu('GET', '/api/diagnosis')).json.diagnosis;
  assert.ok(d.kbChangedAt > d.report.createdAt, '改了知识库，标签可重新提取');
});

test('资料导入：文字文件按段拆成几条，其他文件存成一条', async () => {
  await boss('PUT', '/api/admin/modules', { states: { kbImport: 'on' } });
  const txt = new TextEncoder().encode('我们做的是意式极简全屋定制。\n\n去年在滨江做了一个 600 平的大平层，业主是做外贸的。\n\nok');
  const r = await stu('POST', '/api/kb/import', txt, { 'content-type': 'text/plain', 'x-file-name': encodeURIComponent('介绍.txt'), 'x-section': 'brand' });
  assert.equal(r.status, 200); assert.equal(r.json.added, 2, '太短的段落不要');
  assert.equal(r.json.items.filter((i: any) => i.source === '导入:文件' && i.section === 'brand').length, 2);
  const bad = await stu('POST', '/api/kb/import', new Uint8Array([1, 2]), { 'content-type': 'application/zip', 'x-file-name': 'a.zip' });
  assert.equal(bad.status, 415);
});

test('保存期限和容量：超容量拒绝上传；7 天内到期提醒；到期删文件', async () => {
  await boss('PUT', '/api/admin/modules', { capacityMb: 1, retentionDays: 30 });
  const big = new Uint8Array(1.2 * 1024 * 1024);
  const up = await stu('POST', '/api/assets', big, { 'content-type': 'image/jpeg', 'x-file-name': 'big.jpg' });
  assert.equal(up.status, 413); assert.match(up.json.error, /空间满了/);
  const ok = await stu('POST', '/api/assets', new Uint8Array(1000), { 'content-type': 'image/jpeg', 'x-file-name': 'small.jpg' });
  assert.equal(ok.status, 200);
  // 把这张改成 25 天前传的：还剩 5 天
  app.db.prepare('UPDATE assets SET created_at=? WHERE id=?').run(new Date(Date.now() - 25 * 86400e3).toISOString(), ok.json.id);
  const st = await stu('GET', '/api/storage');
  assert.equal(st.json.capacityMb, 1);
  const e = st.json.expiring.find((x: any) => x.id === ok.json.id);
  assert.ok(e && e.daysLeft === 5, JSON.stringify(st.json.expiring));
  app.db.prepare('UPDATE assets SET created_at=? WHERE id=?').run(new Date(Date.now() - 31 * 86400e3).toISOString(), ok.json.id);
  const n = await app.retention.purge(app.policy());
  assert.ok(n >= 1);
  assert.ok(!(await stu('GET', '/api/assets')).json.assets.some((a: any) => a.id === ok.json.id));
  await boss('PUT', '/api/admin/modules', { capacityMb: 0, retentionDays: 0 });
});
