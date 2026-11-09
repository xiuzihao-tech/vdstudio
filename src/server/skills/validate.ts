// 技能保存前的检查：格式不对就拒绝保存（并说清楚哪里不对），免得后台一改把前台改坏。
import { z } from 'zod';
import type { SkillData, SkillFile } from '../../shared/skills.ts';

const TYPE_IDS = ['tour', 'explain', 'talk', 'before', 'case', 'product', 'site', 'vlog'] as const;
const vt = z.enum(TYPE_IDS);
const str = (max = 2000) => z.string().max(max);
const strs = (max = 200) => z.array(str(max));
const int = (min = 0, max = 1e9) => z.number().int().min(min).max(max);
const column = z.object({ n: str(20).min(1), d: str(200), eg: str(80), freq: int(1, 7), src: str(60), type: vt, ask: str(80), unit: str(6) });
const diagResult = z.object({ who: str(20), tags: z.object({ personal: strs(30), pro: strs(40), brand: strs(60) }), columns: z.array(column).min(1).max(8) });
const pkg = z.object({ id: str(20).min(1), n: str(12).min(1), price: int(1, 1e8), points: int(1, 1e8), bonus: int(0, 1e8), tag: str(6).optional() });

/** 每个技能 config 的格式（passthrough：允许多出来的字段，留给以后用） */
const CONFIG: Record<string, z.ZodTypeAny> = {
  'diag-agent': z.object({
    useLlm: z.boolean(), minAnswers: int(1, 50), maxQuestions: int(3, 200), stages: z.array(str(12).min(1)).length(4), welcome: str(600),
    questions: z.array(z.object({ stage: int(0, 3), q: str(200).min(1) })).min(1).max(200), more: strs(200).min(1), acks: strs(40),
    demoName: str(40), demoAnswers: strs(400),
  }).passthrough(),
  'diag-report': z.object({ useLlm: z.boolean(), columns: int(1, 8), sampleKeyword: str(20), personal: strs(20), sample: diagResult }).passthrough(),
  'diag-topics': z.object({
    useLlm: z.boolean(), total: int(1, 60), weekdays: z.array(int(0, 6)).min(1).max(7), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '时间要写成 19:00 这样'),
    templates: z.record(strs(80)), generic: strs(80).min(1),
  }).passthrough(),
  'video-advise': z.object({
    useLlm: z.boolean(), keywords: z.array(z.object({ type: vt, words: strs(20) })), copyOnly: vt, mediaOnly: vt, both: vt, copyOnlyAllow: z.array(vt),
    needMedia: z.array(vt), thinMin: int(0, 50),
    msg: z.object({ copyOnly: str(200), mediaOnlyTour: str(200), mediaOnly: str(200), both: str(200), none: str(200), ok: str(80), thin: str(120) }),
  }).passthrough(),
  storyboard: z.object({
    useLlm: z.boolean(), charsPerSec: z.number().min(1).max(12), minShots: int(1, 20), maxShots: int(1, 20),
    scenes: z.record(vt, z.array(z.tuple([str(40), str(20), str(80)])).min(1)), lines: z.record(vt, strs(200).min(1)),
  }).passthrough().refine(c => c.minShots <= c.maxShots, '最少镜头数不能大于最多镜头数'),
  'publish-pack': z.object({
    useLlm: z.boolean(), city: str(10), titleMax: int(10, 60), cta: str(120), groups: z.array(z.object({ name: str(10), tags: strs(30) })).min(1),
    pick: z.array(int(0, 99)), tagMin: int(0, 10), tagMax: int(1, 20), banned: strs(20),
  }).passthrough().refine(c => c.tagMin <= c.tagMax, '话题最少数不能大于最多数'),
  copywriter: z.object({ charsPerSec: z.number().min(1).max(12) }).passthrough(),
  'video-types': z.object({
    types: z.array(z.object({
      id: vt, n: str(12).min(1), pts: int(1, 100000), secs: int(3, 600), d: str(120), need: str(60), face: z.enum(['avatar', 'voice', 'none']),
      parts: z.array(z.tuple([z.enum(['avatar', 'scene', 'pair', 'macro']), str(12)])).min(1).max(8), bgm: str(12), tag: str(8).optional(), enabled: z.boolean().optional(),
    }).passthrough()).min(1).refine(l => new Set(l.map(t => t.id)).size === l.length, '类型 id 不能重复').refine(l => l.some(t => t.enabled !== false), '至少留一类启用'),
    sampleCats: strs(12), samples: z.array(z.object({ id: str(20), cat: str(12), type: vt, t: str(40), d: str(60), dur: str(8), scenes: strs(20) }).passthrough()),
  }).passthrough(),
  points: z.object({
    pointName: str(4).min(1), secondsPerPoint: z.number().min(0.1).max(100), sampleRate: z.number().min(0.05).max(1), sampleMin: int(0, 10000), minCost: int(0, 10000),
    initialPoints: int(0, 1e6).nullable(), signupBonus: int(0, 1e6), lowBalance: int(0, 1e6), diagPrice: int(1, 1e8), orderTtlMin: int(1, 1440),
    packages: z.array(pkg).min(1).max(8).refine(l => new Set(l.map(p => p.id)).size === l.length, '套餐 id 不能重复'),
  }).passthrough(),
  referral: z.object({
    enabled: z.boolean(),
    invite: z.object({ inviterPoints: int(0, 1e5), inviteePoints: int(0, 1e5), rewardOn: z.enum(['register', 'first_gen', 'first_pay']), dailyCap: int(0, 1000), monthlyCap: int(0, 10000), ipDailyLimit: int(0, 1000) }),
    rebate: z.object({ rate: z.number().min(0).max(1), scope: z.enum(['first', 'all']), days: int(0, 3650), capPerInvitee: int(0, 1e7) }),
    firstRecharge: z.object({ fixed: int(0, 1e6), rate: z.number().min(0).max(2) }),
    shareDaily: int(0, 10000), shareTitle: str(60), shareText: str(200), rules: strs(120),
  }).passthrough(),
  avatars: z.object({
    avatars: z.array(z.object({ id: str(20).min(1), n: str(12).min(1), d: str(60), skin: str(20), hair: str(20), top: str(20), bg: str(20), bg2: str(20), hairStyle: z.enum(['short', 'bob', 'long', 'crop']), glasses: z.boolean().optional(), mine: z.boolean().optional() }).passthrough()).min(1),
    voices: strs(30).min(1),
  }).passthrough(),
};
const UPSTREAM = z.object({ enabled: z.boolean() }).passthrough();

/** 检查一份要保存的技能数据；不对就抛错，错误信息给后台看 */
export function validateSkill(f: SkillFile, d: SkillData): SkillData {
  if (typeof d.enabled !== 'boolean') throw new Error('enabled 要是 true / false');
  if (!d.prompts || typeof d.prompts !== 'object') throw new Error('提示词格式不对');
  for (const k of Object.keys(f.prompts)) {
    if (typeof d.prompts[k] !== 'string' || !d.prompts[k].trim()) throw new Error(`提示词「${k}」不能为空`);
    if (d.prompts[k].length > 20000) throw new Error(`提示词「${k}」太长了（最多 2 万字）`);
  }
  for (const k of Object.keys(d.prompts)) if (!(k in f.prompts)) throw new Error(`没有「${k}」这段提示词（只能改已有的几段）`);
  const schema = f.category === 'upstream' ? UPSTREAM : CONFIG[f.id];
  if (schema) {
    const r = schema.safeParse(d.config);
    if (!r.success) {
      const i = r.error.issues[0];
      throw new Error(`参数不对：${i.path.length ? `「${i.path.join('.')}」` : ''}${i.message}`);
    }
  } else if (!d.config || typeof d.config !== 'object' || Array.isArray(d.config)) throw new Error('参数要是一个 JSON 对象');
  if (JSON.stringify(d).length > 400_000) throw new Error('内容太多了');
  return d;
}
