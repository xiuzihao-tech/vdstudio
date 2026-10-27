import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCopy, copyText, findBanned, replaceAllBanned, rewriteLocal, secs, trimToLen } from '../../src/shared/copy.ts';
import { genCost, genIssues, planShots, trimCopyToLen } from '../../src/shared/gen.ts';
import { columnOf, isPublishDay, pickNext, slotState, weekdayOf, windowDates } from '../../src/shared/schedule.ts';
import type { CopyDraft, GenSettings, Topic } from '../../src/shared/types.ts';

const draft = (o: Partial<CopyDraft> = {}): CopyDraft => ({
  id: 'd', topicId: 't', kind: '口播', len: 45, tone: '亲切', titles: ['标题'], title: '全网最好的玄关', hooks: ['钩子'], hook: '开场一句。',
  body: ['第一段内容，讲背景。', '第二段，保证好用。'], shots: [], cta: '私信我。', tags: [], live: 62, version: 1, assetIds: [], updatedAt: '', ...o,
});
const gen = (o: Partial<GenSettings> = {}): GenSettings => ({
  copy: '第一行\n第二行\n第三行', prompt: '', title: '', topicId: null, assetIds: ['a1'], model: 's25', len: 45, ratio: '9:16', res: '1080p',
  draft: true, voice: 'p1', speed: 1, bgm: '温暖钢琴', subs: true, ambience: true, cover: false, style: 'AI 推荐', ...o,
});

test('口播时长按每秒 4.5 字估算', () => {
  assert.equal(secs('一二三四五六七八九'), 2);
  assert.equal(secs(' \n'), 0);
});

test('违禁词能查出并全部替换（标题、正文都算）', () => {
  const d = draft();
  assert.deepEqual(findBanned(copyText(d) + d.title).map(x => x[0]).sort(), ['保证', '全网最', '最好'].sort());
  const fixed = replaceAllBanned(d);
  assert.equal(findBanned([fixed.title, ...fixed.body].join('')).length, 0);
  assert.match(fixed.title, /很多人都说/);
});

test('超时的文案能裁到目标时长，至少留两段', () => {
  const long = draft({ len: 30, body: Array(8).fill('这是一段比较长的口播文案，用来测试裁剪逻辑是否正确工作。') });
  assert.equal(checkCopy(long).fits, false);
  const t = trimToLen(long);
  assert.ok(t.body.length >= 2);
  assert.ok(checkCopy(t).fits || t.body.length === 2);
});

test('活人感改写只改偶数段，且分数上限 94', () => {
  const { draft: d, changed } = rewriteLocal(draft({ live: 90 }), 'live', '');
  assert.equal(changed, 1);
  assert.equal(d.live, 94);
  assert.equal(rewriteLocal(d, 'live', '').changed, 0);
});

test('分镜：镜数不少于文案行数，单镜时长不低于模型下限', () => {
  const shots = planShots(gen({ len: 90 }), ['a', 'b'], []);
  assert.ok(shots.length >= 6, '90 秒 / 15 秒上限 → 至少 6 镜');
  assert.ok(shots.every(s => s.dur >= 4));
  assert.equal(shots[0].k, 'a'); assert.equal(shots[1].k, 'b'); assert.equal(shots[2].k, 'a');
  const none = planShots(gen({ len: 10, copy: '' }), [], ['person', 'live']);
  assert.ok(none.every(s => s.generated && s.k === 'live'));
});

test('费用：样片按样片价，成片按正式价，封面接图像模型前不收费', () => {
  assert.equal(genCost(gen({ len: 45 })), Math.round(45 * 2.4));
  assert.equal(genCost(gen({ len: 45 }), true), Math.round(45 * 4.2));
  assert.equal(genCost(gen({ len: 45, model: 's20' })), Math.round(45 * 3.4));
  assert.equal(genCost(gen({ len: 10, cover: true })), 24);
});

test('冲突检查：清晰度超出、没文案、声音未克隆都会拦截', () => {
  const codes = (g: GenSettings, v: 'none' | 'busy' | 'ready' = 'ready') => genIssues(g, v).map(i => i.code);
  assert.deepEqual(codes(gen()), []);
  assert.ok(codes(gen({ model: 's20f', res: '4K' })).includes('res_unsupported'));
  assert.ok(codes(gen({ copy: '' })).includes('no_copy'));
  assert.ok(codes(gen({ voice: 'me' }), 'none').includes('voice_missing'));
  assert.ok(codes(gen({ voice: 'me' }), 'busy').includes('voice_busy'));
  const long = genIssues(gen({ len: 10, copy: '很长的文案'.repeat(30) }), 'ready').find(i => i.code === 'copy_too_long')!;
  assert.equal(long.blocking, false);
  assert.ok(long.fixes.some(f => f.id.startsWith('len:')));
  assert.ok(genIssues(gen({ model: 'kl3' }), 'ready').some(i => i.code === 'model_off' && i.blocking));
});

test('AI 缩短保留首尾两行', () => {
  const out = trimCopyToLen(['开头', ...Array(10).fill('中间很长很长的一段口播内容'), '结尾'].join('\n'), 10);
  const L = out.split('\n');
  assert.equal(L[0], '开头'); assert.equal(L[L.length - 1], '结尾');
});

test('排期窗口从周一开始共 14 天', () => {
  const w = windowDates('2026-10-21');
  assert.equal(w.length, 14);
  assert.equal(w[0], '2026-10-19');
  assert.equal(weekdayOf(w[0]), 0);
  assert.equal(weekdayOf('2026-10-25'), 6);
});

test('发布日：固定星期 + 额外加的 - 跳过的', () => {
  const p = { weekdays: [1, 3], added: ['2026-10-24'], skipped: ['2026-10-22'] };
  assert.equal(isPublishDay(p, '2026-10-20'), true);
  assert.equal(isPublishDay(p, '2026-10-22'), false);
  assert.equal(isPublishDay(p, '2026-10-24'), true);
  assert.equal(isPublishDay(p, '2026-10-21'), false);
});

test('预选题顺序：收藏 > 自己策划 > 本品类热度高的', () => {
  const t = (id: string, o: Partial<Topic>): Topic => ({ id, cat: 1, title: id, hook: '', why: '', dir: '知识科普', type: 0, heat: 1, k: 'x', ageMonths: 1, source: 'hot', fav: false, createdAt: '', ...o });
  const L = [t('hot3', { cat: 0, heat: 3 }), t('other', { cat: 1, heat: 3 }), t('mine', { source: 'case', cat: 0 }), t('fav', { fav: true })];
  const used = new Set<string>();
  const order = [0, 1, 2, 3].map(() => { const x = pickNext(L, used, 0)!; used.add(x.id); return x.id; });
  assert.deepEqual(order, ['fav', 'mine', 'hot3', 'other']);
  assert.equal(pickNext(L, used, 0), null);
});

test('栏目按配比轮换；格子状态随日期和设置变化', () => {
  const mix = [{ n: 'A', v: 0.5 }, { n: 'B', v: 0.25 }];
  assert.deepEqual([0, 1, 2].map(i => columnOf({ mix }, i)), ['A', 'A', 'B']);
  const p = { running: true, needOk: true };
  assert.equal(slotState('2026-10-20', '2026-10-21', p, 'fixed', true), 'done');
  assert.equal(slotState('2026-10-21', '2026-10-21', p, 'fixed', true), 'review');
  assert.equal(slotState('2026-10-23', '2026-10-21', p, 'cand', true), 'cand');
  assert.equal(slotState('2026-10-23', '2026-10-21', p, 'fixed', false), 'gap');
  assert.equal(slotState('2026-10-28', '2026-10-21', p, 'fixed', true), 'plan');
  assert.equal(slotState('2026-10-28', '2026-10-21', { ...p, running: false }, 'fixed', true), 'paused');
});

test('序数“第一段/第一次”不算违禁词，宣传用语“第一品牌”算', () => {
  assert.equal(findBanned('第一段先讲背景，第一次来').length, 0);
  assert.deepEqual(findBanned('行业第一品牌').map(x => x[0]), ['第一']);
});

test('冲突检查：档位不支持的比例要拦；首帧用不了时提醒但不拦', async () => {
  const { setVideoModels } = await import('../../src/shared/gen.ts');
  const { MODELS, TUDOU_CAPS, withCaps } = await import('../../src/shared/catalog.ts');
  setVideoModels(withCaps(MODELS, TUDOU_CAPS));
  try {
    const r = genIssues(gen({ model: 's20f', res: '720p', ratio: '3:4' }), 'ready').find(i => i.code === 'ratio_unsupported')!;
    assert.equal(r.blocking, true);
    assert.deepEqual(r.fixes.map(f => f.id), ['ratio:9:16', 'ratio:16:9']);
    assert.equal(genIssues(gen({ model: 's20f', res: '720p', ratio: '9:16' }), 'ready').length, 0);
    const f = genIssues(gen({ model: 's20f', res: '720p' }), 'ready', { firstFrame: false }).find(i => i.code === 'frame_unusable')!;
    assert.equal(f.blocking, false);
    assert.equal(genIssues(gen({ model: 's20f', res: '720p', assetIds: [] }), 'ready', { firstFrame: false }).some(i => i.code === 'frame_unusable'), false, '没放素材就不提醒');
  } finally { setVideoModels(MODELS); }
});
