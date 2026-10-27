// 知识库 → 文案：系统挑素材、履历限频、轮换；AI 面诊回答进知识库、报告同步栏目
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.MOCK_DELAY_MS = '0';
process.env.TODAY = '2026-10-21';
const { openDb } = await import('../../src/server/db.ts');
const { makeRepo } = await import('../../src/server/repo.ts');
const { seedWorkspace, writeCopy, saveAnswer, runDiagnosis } = await import('../../src/server/services.ts');
const { mockProviders } = await import('../../src/server/providers/mock.ts');
const { pickMaterials, cliches } = await import('../../src/shared/kb.ts');
import type { KbItem } from '../../src/shared/kb.ts';

const item = (id: string, kind: KbItem['kind'], text: string, extra: Partial<KbItem> = {}): KbItem => ({ id, section: 'pro', kind, text, tags: [], source: '手动', used: 0, lastUsed: null, createdAt: '', ...extra });

test('挑素材：越相关越靠前；说话习惯和不说的话不当素材；履历最多 1 条', () => {
  const items = [item('a', 'story', '玄关收纳改造：鞋柜做到顶，业主再没乱过'), item('b', 'story', '厨房动线的案例'), item('c', 'resume', '做设计十年'), item('d', 'resume', '拿过金堂奖'), item('e', 'habit', '说白了'), item('f', 'avoid', '别提价格')];
  const p = pickMaterials(items, '玄关为什么总是乱', { n: 4 });
  assert.equal(p[0].id, 'a');
  assert.ok(!p.some(i => i.kind === 'habit' || i.kind === 'avoid'));
  assert.equal(p.filter(i => i.kind === 'resume').length, 1);
  assert.equal(pickMaterials(items, '玄关', { n: 4, recentResume: true }).filter(i => i.kind === 'resume').length, 0);
});

test('轮换：用过多次的素材往后排', () => {
  const items = [item('a', 'story', '一个玄关案例', { used: 6 }), item('b', 'story', '一个玄关案例')];
  assert.equal(pickMaterials(items, '玄关', { n: 1 })[0].id, 'b');
});

test('AI 腔自检', () => { assert.deepEqual(cliches('这不仅是收纳，更是品质生活'), ['不仅', '更是', '品质生活']); });

test('写文案：用了知识库素材并记次数；最近用过履历，下一条就不再用', async () => {
  const db = openDb(':memory:'), repo = makeRepo(db);
  const ws = seedWorkspace(db, repo, repo.createOwner(1000), 'designer');
  repo.addKb(ws.id, { section: 'pro', kind: 'resume', text: '做室内设计十年，三百多个项目' });
  repo.addKb(ws.id, { section: 'pro', kind: 'story', text: '给一对双职工做玄关，鞋、外套、快递分三个高度' });
  const t = repo.topics(ws.id)[0];
  const r1 = await writeCopy(repo, mockProviders, ws, t);
  assert.ok(r1.used.length >= 1);
  assert.ok(repo.kb(ws.id).some(i => i.used > 0));
  if (r1.used.some(i => i.kind === 'resume')) {
    const r2 = await writeCopy(repo, mockProviders, ws, t);
    assert.ok(!r2.used.some(i => i.kind === 'resume'));
  }
});

test('面诊：回答存进知识库（重答覆盖），出报告后栏目同步到排期配比', async () => {
  const db = openDb(':memory:'), repo = makeRepo(db);
  const ws = seedWorkspace(db, repo, repo.createOwner(1000), 'designer');
  saveAnswer(repo, ws, 'p1', '原来在大公司做设计，后来出来单干');
  saveAnswer(repo, ws, 'p1', '原来在家装公司做了五年，后来自己开工作室');
  saveAnswer(repo, ws, 'r2', '一个 90 平的老房，预算二十万，业主说终于不想出门了');
  saveAnswer(repo, ws, 'b1', '主做意式极简，和别家的区别是只用真材');
  const fromDiag = repo.kb(ws.id).filter(i => i.source.startsWith('面诊'));
  assert.equal(fromDiag.length, 3);
  assert.match(fromDiag.find(i => i.source === '面诊:p1')!.text, /五年/);
  const rep = await runDiagnosis(repo, mockProviders, ws);
  assert.ok(rep.columns.length > 0);
  const plan = repo.plans(ws.id)[0];
  assert.equal(plan.mix[0].n, rep.columns[0].name);
});
