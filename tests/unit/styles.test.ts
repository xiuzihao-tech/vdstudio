// 视频风格：选了风格，文案、画外音、画面提示词、字幕都跟着变；「AI 推荐」按类型挑
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VIDEO_STYLES, effectiveStyle, styleOf, styleVisual, stylesFor } from '../../src/shared/styles.ts';
process.env.MOCK_DELAY_MS = '0';
const { mockProviders } = await import('../../src/server/providers/mock.ts').catch(() => ({ mockProviders: null as any }));

test('风格清单：一条、大哲是招牌；名字和 id 都能找到；旧数据里的名字还认', () => {
  assert.deepEqual(VIDEO_STYLES.filter(s => s.hot).map(s => s.id), ['yitiao', 'dazhe']);
  assert.equal(styleOf('“一条”式人物纪实')?.id, 'yitiao');
  assert.equal(styleOf('dazhe')?.n, '大哲式观点口播');
  assert.equal(styleOf('AI 推荐'), null);
  assert.equal(effectiveStyle({ style: 'AI 推荐', type: 'talk' }).id, 'dazhe', '口播默认大哲式');
  assert.equal(stylesFor('house')[0].id, 'compare');
  assert.match(styleVisual({ style: '“一条”式人物纪实', type: 'real' }), /自然光/);
});

test('模拟文案：大哲式先给判断、分三点；一条式第一人称', async () => {
  if (!mockProviders) return;
  const p = mockProviders;
  const ctx = { persona: (await import('../../src/shared/catalog.ts')).PERSONAS[0], positioning: { ...(await import('../../src/server/services.ts')).defaultPositioning((await import('../../src/shared/catalog.ts')).PERSONAS[0]), goal: '私信发户型图' } } as any;
  const t = { id: 't', title: '玄关为什么总是乱', hook: '', dir: '知识科普' } as any;
  const dz = await p.copy.generate(ctx, t, { kind: '口播', len: 45, tone: '亲切', version: 1, style: styleOf('dazhe') });
  assert.match(dz.body[0], /^说个判断/); assert.match(dz.body[1], /^第一/);
  const yt = await p.copy.generate(ctx, t, { kind: '口播', len: 45, tone: '亲切', version: 1, style: styleOf('yitiao') });
  assert.match(yt.body[0], /^我一直觉得/);
  const f = await p.copy.footage(ctx, [{ type: '视频', note: '一段视频（门口）' }, { type: '视频', note: '一段视频（客厅）' }], '', [], styleOf('yitiao'));
  assert.match(f.lines[0], /主人/);
});
