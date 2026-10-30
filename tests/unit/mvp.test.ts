// MVP 后端：部分镜头失败只退那几镜、沿用的镜头不收费、兑换码、AI 运营自动写文案
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.MOCK_DELAY_MS = '0';
process.env.TODAY = '2026-10-21';
const { openDb } = await import('../../src/server/db.ts');
const { makeRepo } = await import('../../src/server/repo.ts');
const { JobRunner, seedWorkspace, opsTick } = await import('../../src/server/services.ts');
const { mockProviders } = await import('../../src/server/providers/mock.ts');
const { buildStoryboard, splitSentences } = await import('../../src/shared/video.ts');
const { modelOf } = await import('../../src/shared/gen.ts');
import type { GenSettings } from '../../src/shared/types.ts';

const until = async (f: () => boolean) => { for (let i = 0; i < 200 && !f(); i++) await new Promise(r => setTimeout(r, 10)); };

function setup(video = mockProviders.video) {
  const db = openDb(':memory:'), repo = makeRepo(db);
  const owner = repo.createOwner(1000);
  const ws = seedWorkspace(db, repo, owner, 'designer');
  const runner = new JobRunner(repo, { ...mockProviders, video }, { compose: 'off' });
  return { db, repo, ws, runner };
}
const settings = (copy: string): GenSettings => {
  const shots = buildStoryboard(splitSentences(copy), { type: 'tour', model: modelOf('s20'), assets: [], avatar: false });
  return { copy, prompt: '', title: 't', topicId: null, assetIds: [], model: 's20', len: 30, ratio: '9:16', res: '720p', draft: false, voice: 'p1', speed: 1, bgm: '', subs: true, ambience: true, cover: false, style: 'AI 推荐', type: 'tour', shots };
};
const COPY = '第一句话说的是玄关为什么总是乱成一团。\n第二句讲这个项目只解决了收纳这一件事。\n第三句讲鞋外套快递三样东西三个高度。';

test('部分镜头失败：其余照常出片，只退失败那一镜的点数', async () => {
  const { repo, ws, runner } = setup({ ...mockProviders.video, async run({ shots }) { return { shotVideos: shots.map((_, i) => (i === 1 ? null : `https://x/${i}.mp4`)), errors: shots.map((_, i) => (i === 1 ? '内容审核未通过' : null)) }; } });
  const g = settings(COPY);
  const before = repo.ws(ws.id)!.balance;
  const r = runner.startVideo(ws, g, false, 't'); assert.ok(r.ok);
  const id = r.ok ? r.job.id : '';
  await until(() => repo.job(ws.id, id)!.status !== 'running');
  const j = repo.job(ws.id, id)!;
  assert.equal(j.status, 'done');
  const o = j.output as any;
  assert.equal(o.partial, true);
  assert.match(o.shots[1].failed, /审核/);
  const per = g.shots![1].dur * modelOf('s20').pf;
  assert.equal(Math.round(before - repo.ws(ws.id)!.balance), Math.round(j.cost - Math.round(per)));
});

test('全部失败：整条失败、全额退点；沿用的镜头不收画面费', async () => {
  const bad = setup({ ...mockProviders.video, async run() { throw new Error('所有镜头都没生成成功'); } });
  const before = bad.repo.ws(bad.ws.id)!.balance;
  const r = bad.runner.startVideo(bad.ws, settings(COPY), false, 't'); assert.ok(r.ok);
  await until(() => bad.repo.job(bad.ws.id, r.ok ? r.job.id : '')!.status !== 'running');
  assert.equal(bad.repo.ws(bad.ws.id)!.balance, before);
  const ok = setup();
  const g = settings(COPY);
  const reuse = g.shots!.map((_, i) => (i === 0 ? null : `/files/old${i}.mp4`));
  const r2 = ok.runner.startVideo(ok.ws, { ...g, reuse }, false, 't'); assert.ok(r2.ok);
  const one = Math.round(g.shots![0].dur * modelOf('s20').pf) + 1; // 一镜画面 + 配音
  assert.equal(r2.ok && r2.job.cost, one);
});

test('兑换码：一码一人一次，用完为止，记流水', () => {
  const { repo, ws } = setup();
  repo.createRedeem('ABCD1234', 300, 1, 'test');
  const b = repo.ws(ws.id)!.balance;
  assert.deepEqual(repo.redeem(ws.id, 'ABCD1234'), { ok: true, points: 300 });
  assert.equal(repo.ws(ws.id)!.balance, b + 300);
  assert.equal(repo.redeem(ws.id, 'ABCD1234').ok, false);
  assert.equal(repo.redeem(ws.id, 'NOPE').ok, false);
  assert.ok(repo.ledger(ws.id).some(l => l.reason.includes('ABCD1234')));
});

test('AI 运营：自动写文案只处理已固定、3 天内要发的；选题待审的不动', async () => {
  const { repo, ws, runner } = setup();
  const plan = repo.plans(ws.id)[0];
  await opsTick(repo, mockProviders, runner, ws); // 先把两周排出来
  const future = repo.slots(plan.id).filter(s => s.date > '2026-10-21').sort((a, b) => a.date.localeCompare(b.date));
  const near = future.find(s => s.date <= '2026-10-24')!, far = future[future.length - 1];
  repo.upsertSlot({ ...near, pin: 'fixed' }); repo.upsertSlot({ ...far, pin: 'fixed' });
  const did = await opsTick(repo, mockProviders, runner, ws);
  assert.ok(repo.draftByTopic(ws.id, near.topicId), '近的那条写好了文案');
  assert.equal(repo.draftByTopic(ws.id, far.topicId), null, '远的不提前写');
  assert.ok(did.some(x => x.includes('写好了')));
  const cand = future.find(s => s.pin === 'cand' && s.date <= '2026-10-24' && s.date !== near.date);
  if (cand) assert.equal(repo.draftByTopic(ws.id, cand.topicId), null);
});
