// 视频 IP 新版（苗苗原型）的共用规则：AI 推荐类型、分镜、扣点、诊断结果、选题排期、发布计划统计。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTO, SHENG, DEMO_ANSWERS, advise, buildShots, costOf, defaultStudio, diagResult, makeTopics, schedule, shotReady, splitLines, totalSecs, weekStats, whenLabel, VTYPES, type Mat } from '../../src/shared/studio.ts';

const photo = (i: number): Mat => ({ id: `a${i}`, name: `照片${i}`, kind: 'photo', k: 'live' });

test('只有文案 → 真人口播（数字人照着念）', () => {
  const a = advise({ mats: [], copy: '岩板背景墙到底值不值？我说三点。', pick: AUTO });
  assert.equal(a.type, 'talk');
  assert.match(a.why, /只给了文案/);
});
test('只有照片 → 空间漫游；自己定了类型就用自己的', () => {
  assert.equal(advise({ mats: [1, 2, 3, 4].map(photo), copy: '', pick: AUTO }).type, 'tour');
  assert.equal(advise({ mats: [1, 2].map(photo), copy: '', pick: 'vlog' }).type, 'vlog');
});
test('要素材的类型素材太少会提醒', () => {
  assert.equal(advise({ mats: [], copy: '', pick: 'tour' }).fit, 'thin');
  assert.equal(advise({ mats: [1, 2, 3].map(photo), copy: '', pick: 'tour' }).fit, 'ok');
});
test('价格表和原型一致，改时长按秒折算', () => {
  const p = Object.fromEntries(VTYPES.map(t => [t.n, t.pts]));
  assert.deepEqual(p, { 空间漫游: 80, 空间讲解: 70, 真人口播: 60, 改造前后: 90, 案例故事: 100, 产品种草: 65, 工地记录: 55, Vlog: 70 });
  assert.equal(costOf('talk', 'AI 推荐'), 60);
  assert.ok(costOf('talk', '60 秒') > 60);
});
test('分镜：一句一镜，素材按顺序配上，口播最后一镜数字人出镜，总时长贴近目标', () => {
  const copy = '这套140㎡意式极简，我最想让你看两个细节。整面岩板没有做复杂造型，靠体块穿插撑住气场。开放式餐厨把动线缩短了4米，做饭不再绕圈。床头这面洞石，是整套房子最贵也最值的一笔。想看你家能做成什么样，评论区扣1，发你清单。';
  assert.equal(splitLines(copy).length, 5);
  const s = buildShots({ mats: [photo(1)], copy, type: 'talk', face: 'avatar' }, 38);
  assert.equal(s.length, 5);
  assert.equal(s[0].mat?.id, 'a1');
  assert.ok(s[4].avatar);
  assert.equal(s.filter(shotReady).length, 2);
  assert.ok(Math.abs(totalSecs(s) - 38) <= 3);
  const none = buildShots({ mats: [], copy, type: 'talk', face: 'none' });
  assert.ok(!none.some(x => x.avatar), '不露脸就没有数字人镜头');
});
test('没文案也能排分镜（按类型给旁白）', () => {
  assert.ok(buildShots({ mats: [], copy: '', type: 'tour', face: 'none' }).length >= 3);
});
test('诊断：盛哥演示出原型里的标签和四档栏目；别人的回答按规则出', () => {
  assert.deepEqual(diagResult(DEMO_ANSWERS), SHENG);
  const r = diagResult(['我叫老周，做全案设计，在大连。', '8 年', '大连的改善型', '细致、耐心', '', '常去工地', '擅长老房改造'], '我');
  assert.equal(r.who, '老周');
  assert.equal(r.columns.length, 4);
  assert.ok(r.tags.personal.includes('细致'));
});
test('第二轮：按能拍几套排出 15 条选题，栏目轮着来，一周 3 条', () => {
  const t = makeTopics(SHENG.columns, [3, 2, 2, 3]);
  assert.equal(t.length, 15);
  assert.equal(new Set(t.map(x => x.title)).size, 15, '选题不重复');
  assert.notEqual(t[0].column, t[1].column);
  const items = schedule(t, '2026-11-04', '盛哥本人号');
  assert.ok(items.every(i => i.status === '待确认' && i.from === 'diag'));
  const days = items.map(i => new Date(`${i.when.slice(0, 10)}T00:00:00Z`).getUTCDay());
  assert.ok(days.every(d => [2, 4, 6].includes(d)));
  assert.ok(items[0].when > '2026-11-04');
});
test('发布计划：示例这一周 12 条、5 已排期、4 待确认、3 个账号', () => {
  const s = weekStats(defaultStudio('2026-11-04').plan, '2026-11-04');
  assert.deepEqual(s, { total: 12, done: 5, confirm: 4, gen: 3, accounts: 3 });
  assert.equal(whenLabel('2026-11-05T19:00', '2026-11-04'), '明天19:00');
  assert.equal(whenLabel('2026-11-07T10:00', '2026-11-04'), '周六10:00');
  assert.equal(whenLabel('2026-11-11T20:00', '2026-11-04'), '下周三20:00');
});
