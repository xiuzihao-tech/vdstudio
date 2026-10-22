// 接口入参校验（zod）。服务端每个写接口都先过这里。
import { z } from 'zod';

export const toneSchema = z.enum(['亲切', '专业', '犀利', '幽默']);
export const personaSchema = z.enum(['designer', 'deco', 'custom', 'material', 'soft', 'agent', 'dev', 'stay']);

export const positioningSchema = z.object({
  name: z.string().trim().min(1).max(40),
  line: z.string().trim().min(1).max(80),
  aud: z.array(z.string().max(40)).min(1).max(6),
  pillars: z.array(z.string().max(20)).max(8),
  tone: toneSchema,
  tags: z.array(z.string().trim().min(1).max(12)).max(5),
});

export const topicFilterSchema = z.object({
  cat: z.union([z.literal('all'), z.coerce.number().int().min(0).max(7)]).default('all'),
  dir: z.string().default('不限'),
  type: z.union([z.literal('不限'), z.coerce.number().int().min(0).max(2)]).default('不限'),
  heat: z.union([z.literal('不限'), z.coerce.number().int().min(1).max(3)]).default('不限'),
  period: z.union([z.literal('不限'), z.coerce.number().int().min(1).max(24)]).default('不限'),
  fav: z.coerce.boolean().optional(),
});

export const caseGenSchema = z.object({ text: z.string().max(500).default(''), imageKeys: z.array(z.string()).max(5).default([]) });
export const benchSchema = z.object({ url: z.string().max(500), learn: z.array(z.string()).max(6).default([]) });
export const matGenSchema = z.object({ assetIds: z.array(z.string()).min(1).max(30), note: z.string().max(100).default('') });
export const newTopicSchema = z.object({
  title: z.string().trim().min(1).max(60), hook: z.string().max(120).default(''), why: z.string().max(80).default(''),
  dir: z.string().default('项目案例'), type: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0), heat: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  k: z.string().optional(), source: z.enum(['hot', 'case', 'ai', 'bench', 'mat', 'plan', 'angle', 'tool']).default('ai'),
});

export const copyGenSchema = z.object({
  topicId: z.string(),
  kind: z.enum(['口播', '图文笔记', '分镜脚本']).default('口播'),
  len: z.union([z.literal(30), z.literal(45), z.literal(60), z.literal(90)]).default(45),
  tone: toneSchema.optional(),
  version: z.number().int().min(1).default(1),
});
export const copyDraftSchema = z.object({
  topicId: z.string(), kind: z.enum(['口播', '图文笔记', '分镜脚本']),
  len: z.union([z.literal(30), z.literal(45), z.literal(60), z.literal(90)]), tone: toneSchema,
  titles: z.array(z.string().max(80)).max(6), title: z.string().max(80),
  hooks: z.array(z.string().max(200)).max(6), hook: z.string().max(200),
  body: z.array(z.string().max(400)).max(20), shots: z.array(z.string().max(80)).max(20),
  cta: z.string().max(200), tags: z.array(z.string().max(30)).max(12),
  live: z.number().min(0).max(100), version: z.number().int(), assetIds: z.array(z.string()).max(30),
});

export const genSettingsSchema = z.object({
  copy: z.string().max(3000), prompt: z.string().max(1000).default(''), title: z.string().max(80).default(''),
  topicId: z.string().nullable().default(null), assetIds: z.array(z.string()).max(30).default([]),
  model: z.string(), len: z.number().int().min(10).max(120), ratio: z.enum(['9:16', '16:9', '1:1', '3:4']),
  res: z.enum(['480p', '720p', '1080p', '4K']), draft: z.boolean(),
  voice: z.enum(['me', 'p1', 'p2', 'p3', 'none']), speed: z.number().min(0.8).max(1.3),
  bgm: z.string(), subs: z.boolean(), ambience: z.boolean(), cover: z.boolean(), style: z.string().default('AI 推荐'),
});

export const planPatchSchema = z.object({
  account: z.string().trim().min(1).max(40).optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  hour: z.number().min(6).max(23.5).multipleOf(0.5).optional(),
  needOk: z.boolean().optional(), budget: z.number().int().min(0).max(100000).optional(), running: z.boolean().optional(),
  mix: z.array(z.object({ n: z.string(), v: z.number().min(0.05).max(1) })).max(8).optional(),
});
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const slotActionSchema = z.object({
  action: z.enum(['approve', 'next', 'unpin', 'set', 'skip', 'add']),
  topicId: z.string().optional(),
});
