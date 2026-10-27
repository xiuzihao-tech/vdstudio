// 新链路：按句拆、按配音定时长、一句不丢、费用明细
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStoryboard, chars, costLines, costTotal, fitDur, splitSentences, suggestType, voiceSecs, AVATAR_PPS } from '../../src/shared/video.ts';
import { genIssues, planShots, shotsOf } from '../../src/shared/gen.ts';
import { MODELS } from '../../src/shared/catalog.ts';
import type { GenSettings } from '../../src/shared/types.ts';

const m = { ...MODELS[1], min: 4, max: 15 }; // seedance 2.0
const modelOf = () => m;

test('旧链路：12 行文案、30 秒、单镜最短 4 秒，一行都不丢（以前会丢 5 行，连结尾引导一起）', () => {
  const copy = Array.from({ length: 12 }, (_, i) => `第${i + 1}句话`).join('\n');
  const shots = planShots({ copy, model: 's20', len: 30 }, ['a'], ['b']);
  const all = shots.map(s => s.line).join('');
  for (let i = 1; i <= 12; i++) assert.ok(all.includes(`第${i}句话`), `第 ${i} 句丢了`);
  assert.equal(shots.reduce((a, s) => a + s.dur, 0), 30, '总时长等于目标时长');
});

test('拆句：按行和句号拆，碎句并到前一句', () => {
  assert.deepEqual(splitSentences('你家玄关乱吗？我只改了一处。\n好。\n想看私信我'), ['你家玄关乱吗？', '我只改了一处。好。', '想看私信我']);
});

test('分镜：每镜时长 = 配音 + 0.3 秒取整，落在模型范围内；短句合并、长句拆开，所有字都在', () => {
  const s = ['开场。', '这一句话稍微长一点，大概要说三四秒钟才能说完。', '这一句很长很长，'.repeat(12) + '结束。', '收尾，私信我。'];
  const shots = buildStoryboard(s, { type: 'tour', model: m, assets: [{ id: 'p1', type: '照片' }], avatar: false });
  assert.ok(shots.every(x => x.dur >= 4 && x.dur <= 15));
  assert.equal(shots.map(x => x.line).join('').replace(/\s/g, ''), s.join('').replace(/\s/g, ''), '一个字都不丢');
  assert.equal(fitDur(5.2, m), 6);
  assert.equal(fitDur(1, m), 4);
  assert.ok(Math.abs(voiceSecs('一二三四五六七八九') - 2) < 0.01);
});

test('真人口播：数字人全程出镜，首尾是数字人，中间插画面；没形象时冲突检查会拦', () => {
  const s = Array.from({ length: 6 }, (_, i) => `这是第${i + 1}句，说的是一个完整的观点。`);
  const shots = buildStoryboard(s, { type: 'talk', model: m, assets: [{ id: 'p1', type: '照片' }], avatar: true });
  assert.equal(shots[0].source, 'avatar');
  assert.equal(shots[shots.length - 1].source, 'avatar');
  assert.ok(shots.some(x => x.source === 'frame'));
  const g = { copy: s.join('\n'), shots, avatar: 'clone', model: 's20', voice: 'p1', assetIds: ['p1'], ratio: '9:16', res: '720p', len: 45, draft: false } as unknown as GenSettings;
  assert.ok(genIssues(g, 'ready', { avatars: { clone: 'none', photo: 'none' } }).some(i => i.code === 'avatar_missing' && i.blocking));
  assert.ok(!genIssues(g, 'ready', { avatars: { clone: 'ready', photo: 'none' } }).some(i => i.code.startsWith('avatar')));
  // 费用：数字人按整条时长计，插入画面按镜计，配音按字数
  const total = shots.reduce((a, x) => a + x.dur, 0);
  const lines = costLines(shots, { model: modelOf, base: 's20', draft: false, type: 'talk', voice: true });
  assert.equal(lines.find(l => l.k === 'avatar')!.pts, total * AVATAR_PPS);
  assert.ok(lines.find(l => l.k === 'voice')!.pts >= 1);
  // 复用的镜头不收费
  const reused = costLines(shots, { model: modelOf, base: 's20', draft: false, type: 'talk', voice: true, reuse: shots.map(() => true) });
  assert.equal(costTotal(reused), lines.find(l => l.k === 'voice')!.pts);
  // 逐镜参数原样落到要生成的镜头里
  const planned = shotsOf(g, [{ id: 'p1', k: 'live' }], ['kit']);
  assert.equal(planned.length, shots.length);
  assert.deepEqual(planned.map(p => p.dur), shots.map(x => x.dur));
  assert.equal(planned.find(p => p.source === 'frame')!.k, 'live');
});

test('类型推荐和字数', () => {
  assert.equal(suggestType('老房翻新前后对比'), 'house');
  assert.equal(suggestType('今天验水电'), 'site');
  assert.equal(suggestType('我想说一个观点'), 'talk');
  assert.equal(chars('你好，世界！ ab'), 6);
});
